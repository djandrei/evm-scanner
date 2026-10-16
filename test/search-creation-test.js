const assert = require('assert');

const { match, transaction, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable against the fake JSON-RPC
// server and check which bytecode the query is matched against. The
// fixture's creation data is 0x60dead60 and its runtime code 0xdeadbeef, so
// '60dead60' can only match the creation data and 'beef' only the runtime
// code, while 'dead' matches both.

const matchReport = 'match ---';
const creationOnlyQuery = '<<0x60dead60>>';
const runtimeOnlyQuery = '<<0xbeef>>';
const bothQuery = '<<0xdead>>';
const noCreationDataMessage = 'cannot retrieve transaction data from provider, consider searching runtime';
const noRuntimeCodeMessage = 'cannot retrieve contract bytecode from provider, consider searching creation';

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function scan(url, query, extraArgs)
{
    let result = await runEvmap(['--url', url, '--block-start', String(match.blockNumber), '--block-end', String(match.blockNumber),
        '--delay', '0', '--query', query].concat(extraArgs));

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    return result.stdout;
}

async function assertMatches(url, query, extraArgs)
{
    let stdout = await scan(url, query, extraArgs);
    assert.strictEqual(countOccurrences(stdout, matchReport), 1, query + ' ' + extraArgs.join(' ') + '\n' + stdout);
    return stdout;
}

async function assertNoMatch(url, query, extraArgs)
{
    let stdout = await scan(url, query, extraArgs);
    assert.strictEqual(countOccurrences(stdout, matchReport), 0, query + ' ' + extraArgs.join(' ') + '\n' + stdout);
    return stdout;
}

async function testDefaultSearchesRuntimeOnly(url)
{
    await assertMatches(url, runtimeOnlyQuery, []);
    await assertNoMatch(url, creationOnlyQuery, []);
}

async function testSearchCreationSearchesCreationDataOnly(url)
{
    await assertMatches(url, creationOnlyQuery, ['--search-creation']);
    await assertNoMatch(url, runtimeOnlyQuery, ['--search-creation']);
}

async function testExplicitSearchRuntimeSearchesRuntimeOnly(url)
{
    await assertMatches(url, runtimeOnlyQuery, ['--search-runtime']);
    await assertNoMatch(url, creationOnlyQuery, ['--search-runtime']);
}

async function testBothFlagsMatchEitherSide(url)
{
    await assertMatches(url, creationOnlyQuery, ['--search-creation', '--search-runtime']);
    await assertMatches(url, runtimeOnlyQuery, ['--search-creation', '--search-runtime']);
}

async function testMatchOnBothSidesIsReportedOnce(url)
{
    await assertMatches(url, bothQuery, ['--search-creation', '--search-runtime']);
}

async function testEmptyCreationDataIsReportedAndDoesNotMatch(emptyCreationDataUrl)
{
    let stdout = await assertNoMatch(emptyCreationDataUrl, bothQuery, ['--search-creation']);
    assert.ok(stdout.includes(noCreationDataMessage), stdout);
    assert.ok(!stdout.includes(noRuntimeCodeMessage), stdout);

    // the runtime code is still intact on that server
    await assertMatches(emptyCreationDataUrl, bothQuery, []);
}

async function testEmptyRuntimeCodeIsReportedAndDoesNotMatch(emptyRuntimeCodeUrl)
{
    let stdout = await assertNoMatch(emptyRuntimeCodeUrl, bothQuery, []);
    assert.ok(stdout.includes(noRuntimeCodeMessage), stdout);
    assert.ok(!stdout.includes(noCreationDataMessage), stdout);

    // the creation data is still intact on that server
    await assertMatches(emptyRuntimeCodeUrl, bothQuery, ['--search-creation']);
}

async function main()
{
    let defaultServer = await startFakeRpcServer();
    let emptyCreationDataServer = await startFakeRpcServer({
        eth_getTransactionByHash: Object.assign({}, transaction, { data: '0x' })
    });
    let emptyRuntimeCodeServer = await startFakeRpcServer({ eth_getCode: '0x' });
    try
    {
        await testDefaultSearchesRuntimeOnly(defaultServer.url);
        await testSearchCreationSearchesCreationDataOnly(defaultServer.url);
        await testExplicitSearchRuntimeSearchesRuntimeOnly(defaultServer.url);
        await testBothFlagsMatchEitherSide(defaultServer.url);
        await testMatchOnBothSidesIsReportedOnce(defaultServer.url);
        await testEmptyCreationDataIsReportedAndDoesNotMatch(emptyCreationDataServer.url);
        await testEmptyRuntimeCodeIsReportedAndDoesNotMatch(emptyRuntimeCodeServer.url);
        console.log('search-creation tests passed');
    }
    finally
    {
        defaultServer.server.close();
        emptyCreationDataServer.server.close();
        emptyRuntimeCodeServer.server.close();
    }
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
