const assert = require('assert');

const { match, startFakeRpcServer, runEvmap } = require('./fake-rpc.js');

// These tests run the real `evmap` executable and check that a scan really
// connects through --client and --port. The CLI tests already cover how the
// URL is printed; these use fake JSON-RPC servers to prove the connection.
// The default client name is 'localhost', which may resolve to the IPv6
// loopback first, so the server for that case is bound to 'localhost' too.

const matchReport = 'match ---';

function countOccurrences(text, needle)
{
    return text.split(needle).length - 1;
}

async function scan(connectionArgs)
{
    return runEvmap(connectionArgs.concat(['--block-start', String(match.blockNumber), '--block-end', String(match.blockNumber),
        '--delay', '0', '--query', '<<0xdead>>']));
}

function assertScanFoundTheMatch(result, url)
{
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.ok(result.stdout.includes('url'.padEnd(26, ' ') + url + '\n'), result.stdout);
    assert.strictEqual(countOccurrences(result.stdout, matchReport), 1, result.stdout);
}

async function testClientAndPortConnect(server)
{
    let result = await scan(['--client', '127.0.0.1', '--port', String(server.port)]);

    assertScanFoundTheMatch(result, 'http://127.0.0.1:' + server.port);
}

async function testPortAloneUsesLocalhost(localhostServer)
{
    let result = await scan(['--port', String(localhostServer.port)]);

    assertScanFoundTheMatch(result, 'http://localhost:' + localhostServer.port);
}

async function testUrlTakesPrecedenceOverClientAndPort(server)
{
    // port 1 is closed; the scan must use --url and succeed
    let result = await scan(['--url', server.url, '--client', '127.0.0.1', '--port', '1']);

    assertScanFoundTheMatch(result, server.url);
}

async function testClientAndPortToAClosedPortAbort()
{
    let result = await scan(['--client', '127.0.0.1', '--port', '1']);

    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.startsWith('scan aborted: cannot connect to http://127.0.0.1:1:'), result.stderr);
    assert.strictEqual(countOccurrences(result.stdout, matchReport), 0, result.stdout);
}

async function testNonNumericPortIsRejected()
{
    // --port is parsed with parseInt, so a non-number becomes NaN and is
    // treated as missing
    let result = await scan(['--port', 'abc']);

    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, 'option \'--port <port>\' or \'--url <url>\' missing\n');
    assert.strictEqual(result.stdout, '');
}

async function main()
{
    let server = await startFakeRpcServer();
    let localhostServer = await startFakeRpcServer(undefined, 'localhost');
    try
    {
        await testClientAndPortConnect(server);
        await testPortAloneUsesLocalhost(localhostServer);
        await testUrlTakesPrecedenceOverClientAndPort(server);
        await testClientAndPortToAClosedPortAbort();
        await testNonNumericPortIsRejected();
        console.log('client-port tests passed');
    }
    finally
    {
        server.server.close();
        localhostServer.server.close();
    }
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
