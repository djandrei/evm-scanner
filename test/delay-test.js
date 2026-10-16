const assert = require('assert');

const { match, block, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against a fake JSON-RPC server
// whose block lookup records when each request arrives. evmap pauses for
// --delay milliseconds before fetching every block, so the gap between two
// consecutive block requests, and between the startup 'latest' request and
// the first block, must be at least the delay. Timing on the server side
// keeps process startup out of the measurement.

// Node timers never fire early, but Date.now() has millisecond resolution
const toleranceMs = 2;

let blockRequests = [];

function recordBlockRequest(params)
{
    blockRequests.push({ tag: params[0], at: Date.now() });
    return block;
}

async function scan(url, blockEnd, extraArgs)
{
    blockRequests = [];
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(blockEnd),
        '--query', '<<0xdead>>'].concat(extraArgs));

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    return result.stdout;
}

// the startup 'latest' request followed by one request per scanned block
function requestTimes(blockCount)
{
    assert.deepStrictEqual(blockRequests.map((request) => request.tag),
        ['latest'].concat(Array.from({ length: blockCount }, (_, i) => '0x' + (match.blockNumber + i).toString(16))));
    return blockRequests.map((request) => request.at);
}

function gaps(times)
{
    return times.slice(1).map((at, i) => at - times[i]);
}

// returns the time from the 'latest' request to the last block request
async function testEveryBlockWaitsForTheDelay(url)
{
    let delay = 300;

    let stdout = await scan(url, match.blockNumber + 2, ['--delay', String(delay)]);

    assert.ok(stdout.includes('delay (ms)'.padEnd(26, ' ') + delay + '\n'), stdout);
    let times = requestTimes(3);
    let observed = gaps(times);
    observed.forEach((gap) =>
    {
        assert.ok(gap >= delay - toleranceMs, 'gap ' + gap + ' ms shorter than --delay ' + delay + ' ms; gaps: ' + observed);
    });
    return times[times.length - 1] - times[0];
}

async function testZeroDelayDoesNotWait(url, timedTotal)
{
    await scan(url, match.blockNumber + 2, ['--delay', '0']);
    let times = requestTimes(3);
    let zeroTotal = times[times.length - 1] - times[0];

    // three waits of 300 ms versus none; the RPC round trips are the same
    assert.ok(zeroTotal < timedTotal - 600, 'delay 0 took ' + zeroTotal + ' ms, delay 300 took ' + timedTotal + ' ms');
}

async function testDefaultDelayIsOneSecond(url)
{
    let stdout = await scan(url, match.blockNumber + 1, []);

    assert.ok(stdout.includes('delay (ms)'.padEnd(26, ' ') + '1000\n'), stdout);
    gaps(requestTimes(2)).forEach((gap) =>
    {
        assert.ok(gap >= 1000 - toleranceMs, 'gap ' + gap + ' ms shorter than the default 1000 ms');
    });
}

async function main()
{
    let { server, url } = await startFakeRpcServer({ eth_getBlockByNumber: recordBlockRequest });
    try
    {
        let timedTotal = await testEveryBlockWaitsForTheDelay(url);
        await testZeroDelayDoesNotWait(url, timedTotal);
        await testDefaultDelayIsOneSecond(url);
        console.log('delay tests passed');
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
