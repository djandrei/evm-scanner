const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server with the query read from a file via --query-file. The CLI tests
// already cover the parameter summary and the --query / --query-file
// exclusivity; these check that a file-sourced query drives the scan.

const matchReport = 'match ---';
const repositoryRoot = path.join(__dirname, '..');

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function scanWithQueryFile(url, queryFile)
{
    return runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(match.blockNumber),
        '--delay', '0', '--query-file', queryFile]);
}

function assertScanCompleted(result)
{
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
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

function writeQueryFile(directory, content)
{
    let queryFile = path.join(directory, 'query');
    fileSystem.writeFileSync(queryFile, content);
    return queryFile;
}

function testQueryFromFileFindsTheMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        let queryFile = writeQueryFile(directory, '<<0xdead>>\n');

        let result = await scanWithQueryFile(url, queryFile);

        assertScanCompleted(result);
        assert.ok(result.stdout.includes('hexaized query'.padEnd(20, ' ') + '<dead>\n'), result.stdout);
        assert.strictEqual(countOccurrences(result.stdout, matchReport), 1, result.stdout);
    });
}

function testQueryFromFileCanRejectTheContract(url)
{
    return withTempDirectory(async (directory) =>
    {
        let queryFile = writeQueryFile(directory, '<<0xcafe>>\n');

        let result = await scanWithQueryFile(url, queryFile);

        assertScanCompleted(result);
        assert.strictEqual(countOccurrences(result.stdout, matchReport), 0, result.stdout);
    });
}

function testMultiLineQueryIsJoinedBeforeEvaluation(url)
{
    return withTempDirectory(async (directory) =>
    {
        // operators and tokens on separate lines form one expression
        let queryFile = writeQueryFile(directory, '<<0xbeef>>\n&&\n! <<0xcafe>>\n');

        let result = await scanWithQueryFile(url, queryFile);

        assertScanCompleted(result);
        assert.ok(result.stdout.includes('query'.padEnd(26, ' ') + '<<0xbeef>>&&! <<0xcafe>>\n'), result.stdout);
        assert.strictEqual(countOccurrences(result.stdout, matchReport), 1, result.stdout);
    });
}

async function testShippedExampleFileIsAValidQuery(url)
{
    // template-input-signature is the example query file documented for
    // --query-file; it must parse, even though the fixture does not match it
    let result = await scanWithQueryFile(url, path.join(repositoryRoot, 'template-input-signature'));

    assertScanCompleted(result);
    assert.ok(result.stdout.includes('hexaized query'.padEnd(20, ' ') + '( <cbf0b0c0> || <cfc72007> ) && <f3fef3a3>\n'), result.stdout);
    assert.strictEqual(countOccurrences(result.stdout, matchReport), 0, result.stdout);
}

function testMissingQueryFileAbortsBeforeTheScan(url)
{
    return withTempDirectory(async (directory) =>
    {
        let queryFile = path.join(directory, 'missing');

        let result = await scanWithQueryFile(url, queryFile);

        assert.strictEqual(result.status, 1, result.stdout + result.stderr);
        assert.ok(result.stderr.startsWith('scan aborted: '), result.stderr);
        assert.ok(result.stderr.includes('no such file or directory'), result.stderr);
        assert.ok(result.stderr.includes(queryFile), result.stderr);
        assert.ok(!result.stdout.includes('start block'), 'the scan must not start: ' + result.stdout);
    });
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testQueryFromFileFindsTheMatch(url);
        await testQueryFromFileCanRejectTheContract(url);
        await testMultiLineQueryIsJoinedBeforeEvaluation(url);
        await testShippedExampleFileIsAValidQuery(url);
        await testMissingQueryFileAbortsBeforeTheScan(url);
        console.log('query-file tests passed');
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
