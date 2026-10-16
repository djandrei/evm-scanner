### evm-scanner

evm-scanner (npm package `evmap`) is a free and open-source tool for EVM smart contract exploration and discovery. The scanner supports regular expression queries that allow discovery of smart contracts with complex EVM patterns.

### Installation

From npm, which provides the `evmap` and `evmap-hex` commands:
```
$ npm install -g evmap
```
From source (the examples below use the executables from the repository root):
```
$ npm install
```

The scanner connects to any Ethereum JSON-RPC endpoint: a local node via `--port` (and optionally `--client`), or a public provider such as Infura or Alchemy via `--url`.

### Supported chains

The scanner is not tied to Ethereum mainnet. It only uses standard Ethereum JSON-RPC methods (`eth_getBlockByNumber`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBalance`, `eth_getCode`), detects contract creation as a transaction without a `to` address, and matches queries against EVM bytecode. Any EVM-compatible chain exposing that RPC surface works; the chain is selected purely by the endpoint you pass:

- Ethereum mainnet and testnets (Sepolia, Holesky)
- EVM layer 2 networks (Arbitrum, Optimism, Base, Polygon PoS, Scroll, Linea)
- other EVM chains (BNB Smart Chain, Avalanche C-Chain, Gnosis, Fantom)
- local development nodes (Ganache, Hardhat, Anvil, a private geth)

Unknown chain IDs are accepted; the network is simply reported as `unknown` at startup.

```
$ ./evmap --url https://arb1.arbitrum.io/rpc --block-start 200000000 --block-end 200000100 --query '<<transfer(address,uint256)>>'
```

Not supported: chains without Ethereum JSON-RPC and EVM bytecode (Bitcoin, Solana, Cosmos chains, Cardano, ...). Chains that expose an Ethereum-style RPC but run a different VM (for example zkSync Era) will connect, but hexadecimal bytecode patterns may not match because the compiled code differs.

Limitations that apply on every chain:
- only top-level contract creations are found; contracts deployed by factories or via `CREATE2` are internal transactions and are not detected;
- the scanner uses ethers v4, which predates EIP-1559 (type-2 transactions); scanning recent blocks on chains that use them has not been extensively tested.

### Error handling

Every RPC call made while scanning blocks is retried on failure, up to 5 attempts with exponential backoff (1s, 2s, 4s, 8s). Each retry is reported on stderr, for example:
```
rpc block 7264284 getBlock failed (attempt 1/5): invalid response - 429 (Too Many Requests); retrying in 1000 ms
```
If a call still fails after the last attempt the scan stops with `scan aborted: block <n> ...` and exit code 1. Matches already written to `--output-file` are kept; rerun with `--block-start <n>` to resume from the failed block. An endpoint that cannot be reached at startup is reported immediately without retries. `--verbose` additionally prints the full error. Invalid command-line options are reported on stderr and exit with code 1 before any connection is made.

### Tests

```
$ npm test
```
Runs the dependency-free test suite (Node `assert` only, no test framework). It consists of eleven files, run in sequence:

- `test/rpc-utils-test.js` - the RPC retry helper: backoff delays, retry logging, the error raised after the last attempt.
- `test/search-utils-test.js` - the query parser: signature hashing to 4-byte selectors, raw hex patterns, the `!`, `&&` and `||` operators, parentheses, and case-insensitive bytecode matching.
- `test/evmap-cli-test.js` - the `evmap` command-line validation. It spawns the real executable and checks each usage error (message on stderr, exit code 1) and the parameter summary printed for valid command lines. Valid runs point at a closed local port, so nothing touches the network.
- `test/evmap-hex-test.js` - the `evmap-hex` utility: full keccak256 hashes and 4-byte selectors of known signatures, hex-looking input hashed as text, and the missing `--input` usage error.
- `test/on-match-test.js` - the `--on-match` command substitution. It runs `evmap` against the fake JSON-RPC server in `test/fake-rpc.js`, which serves one block with one contract creation, and checks that every `{field}` token expands to a single shell argument with the matched values, that unknown tokens expand to an empty argument, and that quoted values join adjacent literal text.
- `test/output-file-test.js` - the `--output-file` JSON array, using the same fake server: a single match is written with all fields, a scan without matches leaves `[]`, an existing file is overwritten when the scan starts, matches from several blocks are appended, and the file is strict JSON.
- `test/summary-test.js` - the `--summary` block printed at the end of the scan, using the same fake server: one entry per match read back from the output file, the no-match message, the explanation printed when `--summary` is given without `--output-file`, and no summary without the flag.
- `test/balance-test.js` - the `--balance` filter, using the fake server once with its default balance and once overridden to report zero: a zero-balance contract is reported without the flag, dropped with it (no match report, no output file entry, no `--on-match` run), and a non-zero balance still passes the filter.
- `test/search-creation-test.js` - the `--search-creation` and `--search-runtime` options, using queries that can only match the fixture's creation data or only its runtime code: the default searches runtime only, `--search-creation` searches creation data only, both flags match either side and report a match on both sides once, and empty creation data or runtime code prints the "cannot retrieve" hint without matching.
- `test/action-script-test.js` - the `--action-script` option, with small modules written to a temp directory: a sync function receives the match object, an async function receives the live provider, the function runs once per match and not at all without one, and a rejected promise or synchronous throw is reported as `action script error: ...` on stderr while the scan continues.
- `test/status-test.js` - the `--status` option: one `current block` line per block, in order and ahead of that block's match report, none without the flag, and a block the provider does not return is printed as `invalid block` and skipped while the scan goes on.

### Known issues

If using an ethereum client that does not run in full sync mode, there are some things you should be aware of:
- the current block number of the network might be 0 (provider.getBlockNumber() method returns zero);
- the contract balances displayed might not be accurate (provider.getBalance(contractAddress) returns zero);

Hence, the --block-end implicit value (the network block number) is not a valid block number, and the scan will fail. \
Also, the --balance option will filter out contracts that might have a non-zero balance.

### Command line examples for evmap-hex

The evmap-hex utility can be easily used to generate a function signature.

```
$ ./evmap-hex --input 'transferFrom(address,address,uint256)'
hex       0x23b872dd7302113369cda2901243429419bec145408fa8b352b3dd92b66c680b
$ ./evmap-hex --input 'transferFrom(address,address,uint256)' --signature
hex       0x23b872dd
```

### Command line examples for evmap

The --help option displays the available scan options.
```
$ ./evmap --help
Usage: evmap [options]

Options:
  -V, --version           output the version number
  --url <url>             full JSON-RPC endpoint URL (overrides --client/--port)
  --delay <ms>            delay between block iterations in milliseconds (default: 1000)
  --client <client>       ethereum client (default: "localhost")
  --port <port>           ethereum client rpc port
  --block-start <block>   block number scan start
  --block-end <block>     block number scan end
  --query <query>         query to execute
  --query-file <file>     file with query to execute
  --search-creation       search the data on the creation transaction
  --search-runtime        search the contract bytecode
  --balance               search only for contracts with non-zero balance
  --output-file <file>    file with list of contracts that matched the search criteria
  --status                displays status info during the scan
  --verbose               displays contract data during the scan
  --summary               displays summary at the end of the scan
  --on-match <command>    shell command to run on each match; use {field} tokens
  --action-script <file>  JS module exporting async function onMatch(match, provider)
  -h, --help              output usage information
```
Simple scan using a function signature in the query.
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --query '<<transfer(address,uint256)>>'
```
Simple scan using a hexadecimal string in the query. Please note, the hexadecimal query supports regular expressions.
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --query '<<0x21[0-9]{4}3131>>'
```
Scan with a function signature and a hexadecimal string. 
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --query '<<transfer(address,uint256)>> && ! <<0x21[0-9]{4}3131>>'
```
Scan against a public provider instead of a local node.
```
$ ./evmap --url https://mainnet.infura.io/v3/<key> --block-start 1 --block-end 1000 --query '<<transfer(address,uint256)>>'
```
Slow down the scan to 2 seconds between blocks (default is 1000 ms), useful for rate-limited providers.
```
$ ./evmap --url https://mainnet.infura.io/v3/<key> --block-start 1 --block-end 1000 --delay 2000 --query '<<transfer(address,uint256)>>'
```
Run a shell command on each match. `{field}` tokens are substituted with the match data; available tokens are `{blockNumber}`, `{transactionHash}`, `{contractAddress}`, `{ownerAddress}`, `{transactionNonce}`, `{transactionValue}`, `{contractBalance}`, `{transactionData}` and `{contractBytecode}`.
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --query '<<transfer(address,uint256)>>' --on-match 'echo {contractAddress} {blockNumber}'
```
Call a JavaScript module on each match. The module's default export receives the match object (same fields as the tokens above) and the live `ethers.providers.JsonRpcProvider` instance.
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --query '<<transfer(address,uint256)>>' --action-script ./my-action.js
```
```js
// my-action.js
module.exports = async function(match, provider) {
    console.log(match.contractAddress, match.blockNumber);
};
```
Scan and display a summary.
```
$ ./evmap --port 8545 --block-start 1 --block-end 1000 --output-file 'scan-output.json' --summary --query '<<transfer(address,uint256)>>'
```
Example of a simple scan output.
```
$ ./evmap --port 14545 --block-start 7264275 --block-end 7264290 --query '<<transfer(address,uint256)>>' --output-file './scan-outputs/scan-20190227-2318.json' --status --summary --search-creation


url                       http://localhost:14545
delay (ms)                1000
block start               7264275
block end                 7264290
query                     <<transfer(address,uint256)>>
search creation bytecode  true
search runtime bytecode   false
displays status during scan
displays summary at the end of the scan
output file               ./scan-outputs/scan-20190227-2318.json


signer              no password provided


network             homestead
chain id            1
block#              0


start block         7264275
end block           7264290
query               <<transfer(address,uint256)>>
hexaized query      <a9059cbb>


current block       7264275
current block       7264276
current block       7264277
current block       7264278
current block       7264279
current block       7264280
current block       7264281
current block       7264282
current block       7264283
current block       7264284


match ---------------------------------------
block number        7264284
transaction hash    0xc9a3f0b1d777fff614ace40881f8b111673b913f463b53cd04bc193a372eff98
contract address    0x5Bac8421aa6426B8B6A53C0cff5f198236484406
owner address       0x6d1803F1E66d923253A7457fC03d23F5a8e20763
transaction nonce   0
transaction value   0
contract balance    0
current block       7264285
current block       7264286
current block       7264287


match ---------------------------------------
block number        7264287
transaction hash    0x130214070b523ebd81e09da4d17511956d3ac42131da12b7c799c7be480bfae9
contract address    0x89511Af1116384E096A9f0BD7175A627B839529C
owner address       0xcDd37Ada79F589c15bD4f8fD2083dc88E34A2af2
transaction nonce   1278
transaction value   0
contract balance    0
current block       7264288
current block       7264289
current block       7264290


scan summary --------------------------------


contract            0x5Bac8421aa6426B8B6A53C0cff5f198236484406
owner               0x6d1803F1E66d923253A7457fC03d23F5a8e20763
block number        7264284
transaction hash    0xc9a3f0b1d777fff614ace40881f8b111673b913f463b53cd04bc193a372eff98
balance             0


contract            0x89511Af1116384E096A9f0BD7175A627B839529C
owner               0xcDd37Ada79F589c15bD4f8fD2083dc88E34A2af2
block number        7264287
transaction hash    0x130214070b523ebd81e09da4d17511956d3ac42131da12b7c799c7be480bfae9
balance             0


done.
scan: 17260.040ms

```
