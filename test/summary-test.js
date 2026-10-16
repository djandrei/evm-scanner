const assert = require('assert');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server and check the --summary block printed at the end of the scan, which
// is read back from --output-file.

const summaryHeader = 'scan summary --------------------------------';
const noOutputFileMessage = 'cannot display summary: no output file specified.';
const noMatchMessage = 'no smart contracts matched the search query';

// a line as printed by printUtils.printToConsole(label, 20, value)
function summaryLine(label, value)
{
    return label.padEnd(20, ' ') + value + '\n';
}

function matchSummary()
{
    return summaryLine('contract', match.contractAddress)
        + summaryLine('owner', match.ownerAddress)
        + summaryLine('block number', match.blockNumber)
        + summaryLine('transaction hash', match.transactionHash)
        + summaryLine('balance', match.contractBalance);
}

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function scan(url, blockEnd, query, extraArgs)
{
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(blockEnd),
        '--delay', '0', '--query', query].concat(extraArgs));

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

function testSummaryListsTheMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(url, match.blockNumber, '<<0xdead>>', ['--output-file', outputFile, '--summary']);

        assert.ok(stdout.includes(summaryHeader), stdout);
        assert.strictEqual(countOccurrences(stdout, matchSummary()), 1, stdout);
        assert.ok(!stdout.includes(noMatchMessage), stdout);
        assert.ok(!stdout.includes(noOutputFileMessage), stdout);

        // the summary comes after the match report and before 'done.'
        let matchReportIndex = stdout.indexOf('match ---');
        let headerIndex = stdout.indexOf(summaryHeader);
        let doneIndex = stdout.indexOf('done.');
        assert.ok(matchReportIndex !== -1 && matchReportIndex < headerIndex && headerIndex < doneIndex, stdout);
    });
}

function testSummaryListsOneEntryPerMatch(url)
{
    return withTempDirectory(async (directory) =>
    {
        // the fake server serves the same block for every number, so three
        // blocks give three identical matches
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(url, match.blockNumber + 2, '<<0xdead>>', ['--output-file', outputFile, '--summary']);

        assert.strictEqual(countOccurrences(stdout, summaryHeader), 1, stdout);
        assert.strictEqual(countOccurrences(stdout, matchSummary()), 3, stdout);
    });
}

function testSummaryWithoutMatches(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(url, match.blockNumber, '<<0xcafe>>', ['--output-file', outputFile, '--summary']);

        assert.ok(stdout.includes(summaryHeader), stdout);
        assert.ok(stdout.includes(noMatchMessage), stdout);
        assert.strictEqual(countOccurrences(stdout, matchSummary()), 0, stdout);
    });
}

async function testSummaryWithoutOutputFile(url)
{
    // the scan still runs; the summary is replaced by an explanation
    let stdout = await scan(url, match.blockNumber, '<<0xdead>>', ['--summary']);

    assert.ok(stdout.includes(noOutputFileMessage), stdout);
    assert.ok(!stdout.includes(summaryHeader), stdout);
    assert.ok(stdout.includes('match ---'), stdout);
    assert.ok(stdout.includes('done.'), stdout);
}

function testNoSummaryWithoutTheFlag(url)
{
    return withTempDirectory(async (directory) =>
    {
        let outputFile = path.join(directory, 'matches.json');

        let stdout = await scan(url, match.blockNumber, '<<0xdead>>', ['--output-file', outputFile]);

        assert.ok(!stdout.includes(summaryHeader), stdout);
        assert.ok(!stdout.includes(noOutputFileMessage), stdout);
        assert.strictEqual(countOccurrences(stdout, matchSummary()), 0, stdout);
    });
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testSummaryListsTheMatch(url);
        await testSummaryListsOneEntryPerMatch(url);
        await testSummaryWithoutMatches(url);
        await testSummaryWithoutOutputFile(url);
        await testNoSummaryWithoutTheFlag(url);
        console.log('summary tests passed');
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
