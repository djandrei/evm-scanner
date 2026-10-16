const assert = require('assert');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable and check what --verbose adds:
// object dumps of each transaction and receipt while scanning, the
// transaction data and bytecode lines in the match report, and the full
// error (with stack) when the scan aborts.

const unreachableUrl = 'http://127.0.0.1:1';
const transactionDumpHeader = 'transaction:\n{\n';
const receiptDumpHeader = 'transaction receipt:\n{\n';

// a line as printed by printUtils.printToConsole(label, 20, value)
function matchLine(label, value)
{
    return label.padEnd(20, ' ') + value + '\n';
}

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function scan(url, blockEnd, extraArgs)
{
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(blockEnd),
        '--delay', '0', '--query', '<<0xdead>>'].concat(extraArgs));

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    return result.stdout;
}

async function testVerboseDumpsTransactionAndReceipt(url)
{
    let stdout = await scan(url, match.blockNumber, ['--verbose']);

    assert.strictEqual(countOccurrences(stdout, transactionDumpHeader), 1, stdout);
    assert.ok(stdout.includes("  hash: '" + match.transactionHash + "',\n"), stdout);
    assert.ok(stdout.includes("  data: '" + match.transactionData + "',\n"), stdout);

    assert.strictEqual(countOccurrences(stdout, receiptDumpHeader), 1, stdout);
    assert.ok(stdout.includes("  contractAddress: '" + match.contractAddress + "',\n"), stdout);

    // both dumps come before the match report
    assert.ok(stdout.indexOf(transactionDumpHeader) < stdout.indexOf(receiptDumpHeader), stdout);
    assert.ok(stdout.indexOf(receiptDumpHeader) < stdout.indexOf('match ---'), stdout);
}

async function testVerboseAddsDataAndBytecodeToTheMatchReport(url)
{
    let stdout = await scan(url, match.blockNumber, ['--verbose']);

    let report = stdout.slice(stdout.indexOf('match ---'));
    assert.ok(report.includes(matchLine('contract balance', match.contractBalance)
        + matchLine('transaction data', match.transactionData)
        + matchLine('contract bytecode', match.contractBytecode)), report);
}

async function testVerboseDumpsEveryBlock(url)
{
    let stdout = await scan(url, match.blockNumber + 2, ['--verbose']);

    assert.strictEqual(countOccurrences(stdout, transactionDumpHeader), 3, stdout);
    assert.strictEqual(countOccurrences(stdout, receiptDumpHeader), 3, stdout);
    assert.strictEqual(countOccurrences(stdout, matchLine('contract bytecode', match.contractBytecode)), 3, stdout);
}

async function testNothingExtraWithoutTheFlag(url)
{
    let stdout = await scan(url, match.blockNumber, []);

    assert.strictEqual(countOccurrences(stdout, transactionDumpHeader), 0, stdout);
    assert.strictEqual(countOccurrences(stdout, receiptDumpHeader), 0, stdout);
    assert.ok(!stdout.includes('transaction data'), stdout);
    assert.ok(!stdout.includes('contract bytecode'), stdout);
    assert.ok(stdout.includes(matchLine('contract balance', match.contractBalance)), stdout);
}

async function testAbortPrintsTheFullErrorOnlyWithTheFlag()
{
    let args = ['--url', unreachableUrl, '--block-start', String(match.blockNumber), '--query', '<<0xdead>>'];
    let abortLine = 'scan aborted: cannot connect to ' + unreachableUrl;

    let plain = await runEvmap(args);
    assert.strictEqual(plain.status, 1);
    assert.ok(plain.stderr.startsWith(abortLine), plain.stderr);
    assert.strictEqual(plain.stderr.split('\n').length, 2, plain.stderr);   // one line plus trailing newline
    assert.ok(!plain.stderr.includes('    at '), plain.stderr);

    let verbose = await runEvmap(args.concat(['--verbose']));
    assert.strictEqual(verbose.status, 1);
    assert.ok(verbose.stderr.startsWith(abortLine), verbose.stderr);
    assert.ok(verbose.stderr.includes('\nError: cannot connect to ' + unreachableUrl), verbose.stderr);
    assert.ok(verbose.stderr.includes('\n    at '), verbose.stderr);
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testVerboseDumpsTransactionAndReceipt(url);
        await testVerboseAddsDataAndBytecodeToTheMatchReport(url);
        await testVerboseDumpsEveryBlock(url);
        await testNothingExtraWithoutTheFlag(url);
        await testAbortPrintsTheFullErrorOnlyWithTheFlag();
        console.log('verbose tests passed');
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
