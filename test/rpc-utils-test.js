const assert = require('assert');

const rpcUtils = require('../utils/rpc-utils.js');

function fakeOptions(extra)
{
    let sleeps = [];
    let logs = [];
    let options = Object.assign(
        {
            sleep: function(ms) { sleeps.push(ms); return Promise.resolve(); },
            log: function(message) { logs.push(message); }
        },
        extra);
    return { options, sleeps, logs };
}

async function testSucceedsFirstTry()
{
    let { options, sleeps, logs } = fakeOptions();
    let result = await rpcUtils.withRetry('getBlock', async () => 42, options);

    assert.strictEqual(result, 42);
    assert.deepStrictEqual(sleeps, []);
    assert.deepStrictEqual(logs, []);
}

async function testSucceedsOnThirdTry()
{
    let { options, sleeps, logs } = fakeOptions();
    let calls = 0;
    let result = await rpcUtils.withRetry('block 7 getBlock', async () =>
    {
        calls++;
        if (calls < 3)
        {
            throw new Error('boom ' + calls);
        }
        return 'ok';
    }, options);

    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(sleeps, [1000, 2000]);
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0], 'rpc block 7 getBlock failed (attempt 1/5): boom 1; retrying in 1000 ms');
    assert.strictEqual(logs[1], 'rpc block 7 getBlock failed (attempt 2/5): boom 2; retrying in 2000 ms');
}

async function testExhaustsAttempts()
{
    let { options, sleeps, logs } = fakeOptions();
    let calls = 0;
    let lastError = null;
    let thrown = null;
    try
    {
        await rpcUtils.withRetry('block 7 getBlock', async () =>
        {
            calls++;
            lastError = new Error('boom ' + calls);
            throw lastError;
        }, options);
    }
    catch (error)
    {
        thrown = error;
    }

    assert.ok(thrown, 'expected withRetry to throw');
    assert.strictEqual(calls, 5);
    assert.deepStrictEqual(sleeps, [1000, 2000, 4000, 8000]);
    assert.strictEqual(logs.length, 4);
    assert.strictEqual(thrown.message, 'block 7 getBlock failed after 5 attempts: boom 5');
    assert.strictEqual(thrown.cause, lastError);
}

async function testDescribeErrorIncludesResponseText()
{
    let plain = new Error('boom');
    assert.strictEqual(rpcUtils.describeError(plain), 'boom');

    let transport = new Error('invalid response - 0');
    transport.responseText = 'Error: connect ECONNREFUSED 127.0.0.1:1\n    at TCPConnectWrap.afterConnect';
    assert.strictEqual(rpcUtils.describeError(transport), 'invalid response - 0 (Error: connect ECONNREFUSED 127.0.0.1:1)');
}

async function testDelayIsCapped()
{
    let { options, sleeps } = fakeOptions({ attempts: 7 });
    try
    {
        await rpcUtils.withRetry('getCode', async () => { throw new Error('boom'); }, options);
    }
    catch (error)
    {
    }

    assert.deepStrictEqual(sleeps, [1000, 2000, 4000, 8000, 16000, 16000]);
}

async function main()
{
    await testSucceedsFirstTry();
    await testSucceedsOnThirdTry();
    await testExhaustsAttempts();
    await testDelayIsCapped();
    await testDescribeErrorIncludesResponseText();
    console.log('rpc-utils tests passed');
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
