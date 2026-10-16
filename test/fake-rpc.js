const childProcess = require('child_process');
const http = require('http');
const path = require('path');

// A fake JSON-RPC server serving a single block with one contract creation,
// for tests that need a real `evmap` scan to find exactly one match per
// block. The `match` object below lists the fixture's fields as evmap
// reports them. Addresses and hashes use digits only so that address
// checksumming cannot change their case.

const evmapPath = path.join(__dirname, '..', 'evmap');

const blockNumber = 5;
const transactionHash = '0x' + '11'.repeat(32);
const blockHash = '0x' + '22'.repeat(32);
const contractAddress = '0x0000000000000000000000000000000000000001';
const ownerAddress = '0x0000000000000000000000000000000000000002';
const transactionData = '0x60dead60';
const contractBytecode = '0xdeadbeef';

// the match as evmap prints it, substitutes it and writes it to --output-file
const match = {
    blockNumber: blockNumber,
    transactionHash: transactionHash,
    contractAddress: contractAddress,
    ownerAddress: ownerAddress,
    transactionNonce: 7,
    transactionValue: '42',
    contractBalance: '100',
    transactionData: transactionData,
    contractBytecode: contractBytecode
};

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
        case 'eth_getBlockByNumber': return block;     // the same block for every number
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

// async so the fake server in the test process can answer while evmap runs
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

module.exports = { match, startFakeRpcServer, runEvmap };
