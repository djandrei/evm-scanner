const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server, so the scan finds exactly one match and runs the --on-match
// command through /bin/sh.

async function scanWithOnMatch(url, onMatch)
{
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(match.blockNumber),
        '--delay', '0', '--query', '<<0xdead>>', '--on-match', onMatch]);

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.ok(result.stdout.includes('contract address'.padEnd(20, ' ') + match.contractAddress + '\n'), result.stdout);
    assert.ok(!result.stdout.includes('on-match error'), result.stdout);
    return result.stdout;
}

async function testEveryTokenIsSubstitutedAsOneArgument(url)
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    let argumentsFile = path.join(directory, 'arguments');
    try
    {
        // each {token} expands to one single-quoted argument, so printf
        // prints exactly one line per token; {nope} is not a known field
        await scanWithOnMatch(url, "printf '%s\\n' {blockNumber} {transactionHash} {contractAddress} {ownerAddress}"
            + " {transactionNonce} {transactionValue} {contractBalance} {transactionData} {contractBytecode} {nope} end"
            + " > '" + argumentsFile + "'");

        let lines = fileSystem.readFileSync(argumentsFile, 'utf8').split('\n');
        assert.deepStrictEqual(lines, [
            String(match.blockNumber),
            match.transactionHash,
            match.contractAddress,
            match.ownerAddress,
            String(match.transactionNonce),
            match.transactionValue,
            match.contractBalance,
            match.transactionData,
            match.contractBytecode,
            '',
            'end',
            ''
        ]);
    }
    finally
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    }
}

async function testQuotedValueJoinsAdjacentLiteralText(url)
{
    // the quotes added around the value must not split it from text that
    // touches the token, and a token may be used more than once
    let stdout = await scanWithOnMatch(url, 'echo prefix-{blockNumber}-suffix {blockNumber}');

    assert.ok(stdout.includes('prefix-5-suffix 5\n'), stdout);
}

async function testBracesWithoutKnownTokenShapeAreLeftAlone(url)
{
    // only {word} is a token; other brace text reaches the shell untouched
    let stdout = await scanWithOnMatch(url, "echo '{not a token}' {blockNumber}");

    assert.ok(stdout.includes('{not a token} 5\n'), stdout);
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testEveryTokenIsSubstitutedAsOneArgument(url);
        await testQuotedValueJoinsAdjacentLiteralText(url);
        await testBracesWithoutKnownTokenShapeAreLeftAlone(url);
        console.log('on-match tests passed');
    }
    finally
    {
        server.close();
    }
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
