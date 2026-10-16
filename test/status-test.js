const assert = require('assert');

const { match, block, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server and check the per-block progress lines printed by --status. A
// second server returns no block for number 6, which evmap reports as an
// invalid block and skips.

const matchReport = 'match ---';
const missingBlockNumber = 6;

// a line as printed by printUtils.printToConsole(label, 20, value)
function statusLine(label, blockNumber)
{
    return label.padEnd(20, ' ') + blockNumber + '\n';
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
    assert.ok(result.stdout.includes('done.'), result.stdout);
    return result.stdout;
}

async function testCurrentBlockIsPrintedPerBlockInOrder(url)
{
    let stdout = await scan(url, match.blockNumber + 2, ['--status']);

    assert.ok(stdout.includes('displays status during scan'), stdout);
    for (let blockNumber = 5; blockNumber <= 7; blockNumber++)
    {
        assert.strictEqual(countOccurrences(stdout, statusLine('current block', blockNumber)), 1, stdout);
    }
    assert.ok(stdout.indexOf(statusLine('current block', 5)) < stdout.indexOf(statusLine('current block', 6)), stdout);
    assert.ok(stdout.indexOf(statusLine('current block', 6)) < stdout.indexOf(statusLine('current block', 7)), stdout);
    assert.strictEqual(countOccurrences(stdout, 'invalid block'), 0, stdout);

    // each block's status line precedes that block's match report
    assert.ok(stdout.indexOf(statusLine('current block', 5)) < stdout.indexOf(matchReport), stdout);
    assert.strictEqual(countOccurrences(stdout, matchReport), 3, stdout);
}

async function testNoStatusLinesWithoutTheFlag(url)
{
    let stdout = await scan(url, match.blockNumber + 2, []);

    assert.strictEqual(countOccurrences(stdout, 'current block'), 0, stdout);
    assert.strictEqual(countOccurrences(stdout, 'invalid block'), 0, stdout);
    assert.strictEqual(countOccurrences(stdout, matchReport), 3, stdout);
}

async function testMissingBlockIsReportedAsInvalidAndSkipped(missingBlockUrl)
{
    let stdout = await scan(missingBlockUrl, match.blockNumber + 2, ['--status']);

    assert.strictEqual(countOccurrences(stdout, statusLine('invalid block', missingBlockNumber)), 1, stdout);
    assert.strictEqual(countOccurrences(stdout, statusLine('current block', 5)), 1, stdout);
    assert.strictEqual(countOccurrences(stdout, statusLine('current block', 6)), 0, stdout);
    assert.strictEqual(countOccurrences(stdout, statusLine('current block', 7)), 1, stdout);

    // the scan goes on past the missing block: matches from blocks 5 and 7
    assert.strictEqual(countOccurrences(stdout, matchReport), 2, stdout);
}

async function testMissingBlockIsSilentWithoutTheFlag(missingBlockUrl)
{
    let stdout = await scan(missingBlockUrl, match.blockNumber + 2, []);

    assert.strictEqual(countOccurrences(stdout, 'invalid block'), 0, stdout);
    assert.strictEqual(countOccurrences(stdout, matchReport), 2, stdout);
}

async function main()
{
    let defaultServer = await startFakeRpcServer();
    let missingBlockServer = await startFakeRpcServer({
        eth_getBlockByNumber: (params) => params[0] === '0x' + missingBlockNumber.toString(16) ? null : block
    });
    try
    {
        await testCurrentBlockIsPrintedPerBlockInOrder(defaultServer.url);
        await testNoStatusLinesWithoutTheFlag(defaultServer.url);
        await testMissingBlockIsReportedAsInvalidAndSkipped(missingBlockServer.url);
        await testMissingBlockIsSilentWithoutTheFlag(missingBlockServer.url);
        console.log('status tests passed');
    }
    finally
    {
        defaultServer.server.close();
        missingBlockServer.server.close();
    }
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
