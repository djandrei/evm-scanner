const assert = require('assert');

const { block, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against fake JSON-RPC servers
// with a chosen head block number and check which blocks the scan requests
// when --block-end is omitted (it defaults to the head block) or given.
// Blocks beyond the head are served as null, as a real node would.

const matchReport = 'match ---';

let blockRequests = [];

async function startServerWithHead(headBlockNumber)
{
    let { server, url } = await startFakeRpcServer({
        eth_blockNumber: '0x' + headBlockNumber.toString(16),
        eth_getBlockByNumber: (params) =>
        {
            blockRequests.push(params[0]);
            return params[0] === 'latest' || parseInt(params[0], 16) <= headBlockNumber ? block : null;
        }
    });
    return { server, url };
}

async function scan(url, blockStart, extraArgs)
{
    blockRequests = [];
    let result = await runEvmap(['--url', url, '--block-start', String(blockStart), '--delay', '0', '--query', '<<0xdead>>']
        .concat(extraArgs));

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.ok(result.stdout.includes('done.'), result.stdout);
    return result.stdout;
}

// a line as printed by printUtils.printToConsole(label, 20, value)
function scanLine(label, value)
{
    return label.padEnd(20, ' ') + value + '\n';
}

function hex(blockNumber)
{
    return '0x' + blockNumber.toString(16);
}

function range(from, to)
{
    let numbers = [];
    for (let n = from; n <= to; n++)
    {
        numbers.push(hex(n));
    }
    return numbers;
}

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function testOmittedBlockEndScansUpToTheHead(url)
{
    let stdout = await scan(url, 5, []);

    assert.ok(!stdout.includes('block end'), 'parameter summary must not show a block end: ' + stdout);
    assert.ok(stdout.includes(scanLine('block#', 7)), stdout);
    assert.ok(stdout.includes(scanLine('start block', 5)), stdout);
    assert.ok(stdout.includes(scanLine('end block', 7)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest'].concat(range(5, 7)));
    assert.strictEqual(countOccurrences(stdout, matchReport), 3, stdout);
}

async function testExplicitBlockEndBelowTheHeadIsHonored(url)
{
    let stdout = await scan(url, 5, ['--block-end', '6']);

    assert.ok(stdout.includes('block end'.padEnd(26, ' ') + '6\n'), stdout);
    assert.ok(stdout.includes(scanLine('end block', 6)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest'].concat(range(5, 6)));
    assert.strictEqual(countOccurrences(stdout, matchReport), 2, stdout);
}

async function testExplicitBlockEndBeyondTheHeadIsNotClamped(url)
{
    let stdout = await scan(url, 5, ['--block-end', '9', '--status']);

    assert.ok(stdout.includes(scanLine('end block', 9)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest'].concat(range(5, 9)));
    // blocks 8 and 9 do not exist yet and are skipped
    assert.strictEqual(countOccurrences(stdout, scanLine('invalid block', 8)), 1, stdout);
    assert.strictEqual(countOccurrences(stdout, scanLine('invalid block', 9)), 1, stdout);
    assert.strictEqual(countOccurrences(stdout, matchReport), 3, stdout);
}

async function testStartAtTheHeadScansOneBlock(url)
{
    let stdout = await scan(url, 7, []);

    assert.ok(stdout.includes(scanLine('end block', 7)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest', hex(7)]);
    assert.strictEqual(countOccurrences(stdout, matchReport), 1, stdout);
}

async function testStartBeyondTheHeadScansNothing(url)
{
    // validation only compares --block-start with an explicit --block-end,
    // so this is accepted and the scan loop simply has nothing to do
    let stdout = await scan(url, 8, []);

    assert.ok(stdout.includes(scanLine('start block', 8)), stdout);
    assert.ok(stdout.includes(scanLine('end block', 7)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest']);
    assert.strictEqual(countOccurrences(stdout, matchReport), 0, stdout);
}

async function testBlockEndZeroIsNotTreatedAsOmitted(url)
{
    // 0 is the genesis block; an explicit --block-end 0 must not fall back
    // to the head block
    let stdout = await scan(url, 0, ['--block-end', '0']);

    assert.ok(stdout.includes(scanLine('end block', 0)), stdout);
    assert.deepStrictEqual(blockRequests, ['latest', hex(0)]);
    assert.strictEqual(countOccurrences(stdout, matchReport), 1, stdout);
}

async function main()
{
    let { server, url } = await startServerWithHead(7);
    try
    {
        await testOmittedBlockEndScansUpToTheHead(url);
        await testExplicitBlockEndBelowTheHeadIsHonored(url);
        await testExplicitBlockEndBeyondTheHeadIsNotClamped(url);
        await testStartAtTheHeadScansOneBlock(url);
        await testStartBeyondTheHeadScansNothing(url);
        await testBlockEndZeroIsNotTreatedAsOmitted(url);
        console.log('block-end tests passed');
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
