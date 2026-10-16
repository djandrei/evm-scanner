const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server and check the JSON array written to --output-file. The fake server
// serves the same block for every block number, so a range of n blocks
// yields n identical matches.

async function scan(url, blockStart, blockEnd, query, outputFile)
{
    let result = await runEvmap(['--url', url, '--block-start', String(blockStart), '--block-end', String(blockEnd),
        '--delay', '0', '--query', query, '--output-file', outputFile]);

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    return result.stdout;
}

function readOutput(outputFile)
{
    return JSON.parse(fileSystem.readFileSync(outputFile, 'utf8'));
}

function withTempDirectory(fn)
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    return Promise.resolve(fn(directory)).finally(() =>
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    });
}

function testSingleMatchIsWrittenWithAllFields(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(url, match.blockNumber, match.blockNumber, '<<0xdead>>', outputFile);

        assert.ok(stdout.includes('output file'.padEnd(26, ' ') + outputFile + '\n'), stdout);
        assert.deepStrictEqual(readOutput(outputFile), [match]);
    });
}

function testNoMatchLeavesAnEmptyArray(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        await scan(url, match.blockNumber, match.blockNumber, '<<0xcafe>>', outputFile);

        assert.deepStrictEqual(readOutput(outputFile), []);
    });
}

function testExistingFileIsOverwrittenAtScanStart(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');
        fileSystem.writeFileSync(outputFile, '[{"stale":true}]');

        await scan(url, match.blockNumber, match.blockNumber, '<<0xcafe>>', outputFile);

        assert.deepStrictEqual(readOutput(outputFile), []);
    });
}

function testMatchesAreAppendedAcrossBlocks(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        await scan(url, match.blockNumber, match.blockNumber + 2, '<<0xdead>>', outputFile);

        assert.deepStrictEqual(readOutput(outputFile), [match, match, match]);
    });
}

function testOutputIsValidJsonAfterEachMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        // the file is rewritten as a complete array after every match, so a
        // partial scan (here: the full scan) must leave strict JSON behind
        let outputFile = path.join(directory, 'matches.json');

        await scan(url, match.blockNumber, match.blockNumber + 1, '<<0xdead>>', outputFile);

        let text = fileSystem.readFileSync(outputFile, 'utf8');
        assert.strictEqual(text, JSON.stringify([match, match]));
    });
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testSingleMatchIsWrittenWithAllFields(url);
        await testNoMatchLeavesAnEmptyArray(url);
        await testExistingFileIsOverwrittenAtScanStart(url);
        await testMatchesAreAppendedAcrossBlocks(url);
        await testOutputIsValidJsonAfterEachMatch(url);
        console.log('output-file tests passed');
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
