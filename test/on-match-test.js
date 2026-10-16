const assert = require('assert');
const childProcess = require('child_process');
const fileSystem = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// These tests run the real `evmap` executable against a fake JSON-RPC server
// that serves a single block with one contract creation, so the scan finds
// exactly one match and runs the --on-match command through /bin/sh. The
// expected values below are the fixture's fields as evmap reports them.
// Addresses and hashes use digits only so that address checksumming cannot
// change their case.

const evmapPath = path.join(__dirname, '..', 'evmap');

const blockNumber = 5;
const transactionHash = '0x' + '11'.repeat(32);
const blockHash = '0x' + '22'.repeat(32);
const contractAddress = '0x0000000000000000000000000000000000000001';
const ownerAddress = '0x0000000000000000000000000000000000000002';
const transactionData = '0x60dead60';
const contractBytecode = '0xdeadbeef';

const block = {
    hash: blockHash,
    parentHash: '0x' + '33'.repeat(32),
    number: '0x5',
    timestamp: '0x1',
    nonce: '0x0000000000000000',
    difficulty: '0x1',
    gasLimit: '0x1000000',
    gasUsed: '0x5208',
    miner: '0x0000000000000000000000000000000000000003',
    extraData: '0x',
    transactions: [transactionHash]
};

const transaction = {
    hash: transactionHash,
    blockHash: blockHash,
    blockNumber: '0x5',
    transactionIndex: '0x0',
    from: ownerAddress,
    gasPrice: '0x1',
    gas: '0x5208',
    to: null,
    value: '0x2a',          // 42
    nonce: '0x7',
    data: transactionData
};

const receipt = {
    to: null,
    from: ownerAddress,
    contractAddress: contractAddress,
    transactionIndex: '0x0',
    gasUsed: '0x5208',
    blockHash: blockHash,
    transactionHash: transactionHash,
    logs: [],
    blockNumber: '0x5',
    cumulativeGasUsed: '0x5208',
    status: '0x1'
};

function rpcResult(method, params)
{
    switch (method)
    {
        case 'net_version': return '1337';
        case 'eth_blockNumber': return '0x5';
        case 'eth_getBlockByNumber': return block;
        case 'eth_getTransactionByHash': return transaction;
        case 'eth_getTransactionReceipt': return receipt;
        case 'eth_getBalance': return '0x64';          // 100
        case 'eth_getCode': return contractBytecode;
        case 'eth_accounts': return [];
        default: throw new Error('fake rpc: unsupported method ' + method);
    }
}

function startFakeRpcServer()
{
    return new Promise((resolve, reject) =>
    {
        let server = http.createServer((request, response) =>
        {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () =>
            {
                let call = JSON.parse(body);
                let reply = { jsonrpc: '2.0', id: call.id };
                try
                {
                    reply.result = rpcResult(call.method, call.params);
                }
                catch (error)
                {
                    reply.error = { code: -32601, message: error.message };
                }
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify(reply));
            });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () =>
        {
            resolve({ server: server, url: 'http://127.0.0.1:' + server.address().port });
        });
    });
}

// async so the fake server in this process can answer while evmap runs
function runEvmap(args)
{
    return new Promise((resolve) =>
    {
        childProcess.execFile(process.execPath, [evmapPath].concat(args), { encoding: 'utf8' }, (error, stdout, stderr) =>
        {
            resolve({ status: error ? error.code : 0, stdout: stdout, stderr: stderr });
        });
    });
}

async function scanWithOnMatch(url, onMatch)
{
    let result = await runEvmap(['--url', url, '--block-start', String(blockNumber), '--block-end', String(blockNumber),
        '--delay', '0', '--query', '<<0xdead>>', '--on-match', onMatch]);

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.ok(result.stdout.includes('contract address'.padEnd(20, ' ') + contractAddress + '\n'), result.stdout);
    assert.ok(!result.stdout.includes('on-match error'), result.stdout);
    return result.stdout;
}

async function testEveryTokenIsSubstitutedAsOneArgument(url)
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    let argumentsFile = path.join(directory, 'arguments');
    try
    {
        // each {token} expands to one single-quoted argument, so printf
        // prints exactly one line per token; {nope} is not a known field
        await scanWithOnMatch(url, "printf '%s\\n' {blockNumber} {transactionHash} {contractAddress} {ownerAddress}"
            + " {transactionNonce} {transactionValue} {contractBalance} {transactionData} {contractBytecode} {nope} end"
            + " > '" + argumentsFile + "'");

        let lines = fileSystem.readFileSync(argumentsFile, 'utf8').split('\n');
        assert.deepStrictEqual(lines, [
            '5',
            transactionHash,
            contractAddress,
            ownerAddress,
            '7',
            '42',
            '100',
            transactionData,
            contractBytecode,
            '',
            'end',
            ''
        ]);
    }
    finally
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    }
}

async function testQuotedValueJoinsAdjacentLiteralText(url)
{
    // the quotes added around the value must not split it from text that
    // touches the token, and a token may be used more than once
    let stdout = await scanWithOnMatch(url, 'echo prefix-{blockNumber}-suffix {blockNumber}');

    assert.ok(stdout.includes('prefix-5-suffix 5\n'), stdout);
}

async function testBracesWithoutKnownTokenShapeAreLeftAlone(url)
{
    // only {word} is a token; other brace text reaches the shell untouched
    let stdout = await scanWithOnMatch(url, "echo '{not a token}' {blockNumber}");

    assert.ok(stdout.includes('{not a token} 5\n'), stdout);
}

async function main()
{
    let { server, url } = await startFakeRpcServer();
    try
    {
        await testEveryTokenIsSubstitutedAsOneArgument(url);
        await testQuotedValueJoinsAdjacentLiteralText(url);
        await testBracesWithoutKnownTokenShapeAreLeftAlone(url);
        console.log('on-match tests passed');
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
