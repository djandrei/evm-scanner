const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server with small --action-script modules written into a temp directory.
// Each module records what it was called with in a results file whose path
// is baked into the module source.

const matchReport = 'match ---';

async function scan(url, blockEnd, query, actionScript)
{
    return runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(blockEnd),
        '--delay', '0', '--query', query, '--action-script', actionScript]);
}

function assertScanCompleted(result)
{
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('done.'), result.stdout);
}

function withTempDirectory(fn)
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    return Promise.resolve(fn(directory)).finally(() =>
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    });
}

// write an action script module whose body receives (match, provider) and
// may use `resultsFile` (a string literal) to record what it sees
function writeActionScript(directory, body)
{
    let scriptFile = path.join(directory, 'action.js');
    let resultsFile = path.join(directory, 'results');
    fileSystem.writeFileSync(scriptFile,
        "const fs = require('fs');\n"
        + 'const resultsFile = ' + JSON.stringify(resultsFile) + ';\n'
        + body + '\n');
    return { scriptFile, resultsFile };
}

function testSyncFunctionReceivesTheMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        let { scriptFile, resultsFile } = writeActionScript(directory,
            'module.exports = function(match, provider) { fs.writeFileSync(resultsFile, JSON.stringify(match)); };');

        let result = await scan(url, match.blockNumber, '<<0xdead>>', scriptFile);

        assertScanCompleted(result);
        assert.strictEqual(result.stderr, '');
        assert.ok(result.stdout.includes('action script'.padEnd(26, ' ') + scriptFile + '\n'), result.stdout);
        assert.deepStrictEqual(JSON.parse(fileSystem.readFileSync(resultsFile, 'utf8')), match);
    });
}

function testAsyncFunctionReceivesTheLiveProvider(url)
{
    return withTempDirectory(async (directory) =>
    {
        // the provider is connected to the fake server, whose head block is 5
        let { scriptFile, resultsFile } = writeActionScript(directory,
            'module.exports = async function(match, provider) {\n'
            + '    let blockNumber = await provider.getBlockNumber();\n'
            + '    fs.writeFileSync(resultsFile, JSON.stringify({ blockNumber: blockNumber, contract: match.contractAddress }));\n'
            + '};');

        let result = await scan(url, match.blockNumber, '<<0xdead>>', scriptFile);

        assertScanCompleted(result);
        assert.strictEqual(result.stderr, '');
        assert.deepStrictEqual(JSON.parse(fileSystem.readFileSync(resultsFile, 'utf8')),
            { blockNumber: match.blockNumber, contract: match.contractAddress });
    });
}

function testCalledOncePerMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        // the fake server serves the same block for every number, so three
        // blocks give three matches
        let { scriptFile, resultsFile } = writeActionScript(directory,
            "module.exports = function(match) { fs.appendFileSync(resultsFile, match.blockNumber + '\\n'); };");

        let result = await scan(url, match.blockNumber + 2, '<<0xdead>>', scriptFile);

        assertScanCompleted(result);
        assert.strictEqual(fileSystem.readFileSync(resultsFile, 'utf8'), '5\n5\n5\n');
    });
}

function testNotCalledWithoutAMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        let { scriptFile, resultsFile } = writeActionScript(directory,
            "module.exports = function() { fs.writeFileSync(resultsFile, 'called'); };");

        let result = await scan(url, match.blockNumber, '<<0xcafe>>', scriptFile);

        assertScanCompleted(result);
        assert.ok(!result.stdout.includes(matchReport), result.stdout);
        assert.strictEqual(fileSystem.existsSync(resultsFile), false);
    });
}

function testRejectedPromiseIsReportedAndScanContinues(url)
{
    return withTempDirectory(async (directory) =>
    {
        let { scriptFile } = writeActionScript(directory,
            "module.exports = async function() { throw new Error('async boom'); };");

        let result = await scan(url, match.blockNumber + 1, '<<0xdead>>', scriptFile);

        assertScanCompleted(result);
        assert.strictEqual(result.stderr, 'action script error: async boom\naction script error: async boom\n');
        assert.strictEqual(result.stdout.split(matchReport).length - 1, 2, result.stdout);
    });
}

function testSynchronousThrowIsReportedAndScanContinues(url)
{
    return withTempDirectory(async (directory) =>
    {
        let { scriptFile } = writeActionScript(directory,
            "module.exports = function() { throw new Error('sync boom'); };");

        let result = await scan(url, match.blockNumber, '<<0xdead>>', scriptFile);

        assertScanCompleted(result);
        assert.strictEqual(result.stderr, 'action script error: sync boom\n');
    });
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testSyncFunctionReceivesTheMatch(url);
        await testAsyncFunctionReceivesTheLiveProvider(url);
        await testCalledOncePerMatch(url);
        await testNotCalledWithoutAMatch(url);
        await testRejectedPromiseIsReportedAndScanContinues(url);
        await testSynchronousThrowIsReportedAndScanContinues(url);
        console.log('action-script tests passed');
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
