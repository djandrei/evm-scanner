const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against two fake JSON-RPC
// servers: the default one, whose contract has a balance of 100 wei, and one
// that reports a zero balance. --balance must drop the latter's match.

const matchReport = 'match ---';

async function scan(url, extraArgs)
{
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(match.blockNumber),
        '--delay', '0', '--query', '<<0xdead>>'].concat(extraArgs));

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    return result.stdout;
}

function withTempDirectory(fn)
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    return Promise.resolve(fn(directory)).finally(() =>
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    });
}

async function testZeroBalanceIsReportedWithoutTheFlag(zeroBalanceUrl)
{
    let stdout = await scan(zeroBalanceUrl, []);

    assert.ok(stdout.includes(matchReport), stdout);
    assert.ok(stdout.includes('contract balance'.padEnd(20, ' ') + '0\n'), stdout);
}

function testZeroBalanceIsFilteredWithTheFlag(zeroBalanceUrl)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(zeroBalanceUrl, ['--balance', '--output-file', outputFile]);

        assert.ok(stdout.includes('only contracts with non-zero balance'), stdout);
        assert.ok(!stdout.includes(matchReport), stdout);
        assert.ok(stdout.includes('done.'), stdout);
        assert.deepStrictEqual(JSON.parse(fileSystem.readFileSync(outputFile, 'utf8')), []);
    });
}

function testNonZeroBalanceIsReportedWithTheFlag(defaultUrl)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(defaultUrl, ['--balance', '--output-file', outputFile]);

        assert.ok(stdout.includes(matchReport), stdout);
        assert.ok(stdout.includes('contract balance'.padEnd(20, ' ') + match.contractBalance + '\n'), stdout);
        assert.deepStrictEqual(JSON.parse(fileSystem.readFileSync(outputFile, 'utf8')), [match]);
    });
}

async function testFilteredMatchDoesNotRunOnMatch(zeroBalanceUrl)
{
    let stdout = await scan(zeroBalanceUrl, ['--balance', '--on-match', 'echo on-match-ran {contractAddress}']);

    // the parameter summary echoes the command text with the token
    // unsubstituted, so look for the line the command itself would print
    assert.ok(!stdout.includes('on-match-ran ' + match.contractAddress), stdout);
}

async function main()
{
    let defaultServer = await startFakeRpcServer();
    let zeroBalanceServer = await startFakeRpcServer({ eth_getBalance: '0x0' });
    try
    {
        await testZeroBalanceIsReportedWithoutTheFlag(zeroBalanceServer.url);
        await testZeroBalanceIsFilteredWithTheFlag(zeroBalanceServer.url);
        await testNonZeroBalanceIsReportedWithTheFlag(defaultServer.url);
        await testFilteredMatchDoesNotRunOnMatch(zeroBalanceServer.url);
        console.log('balance tests passed');
    }
    finally
    {
        defaultServer.server.close();
        zeroBalanceServer.server.close();
    }
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
