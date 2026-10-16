# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Install dependencies:
```
npm install
```

Run the scanner:
```
# Local node (--port required if --url is not provided)
./evmap --port <port> --block-start <block> --block-end <block> --query '<query>'

# Public provider (Infura, Alchemy, etc.)
./evmap --url https://mainnet.infura.io/v3/<key> --block-start <block> --block-end <block> --query '<query>'
```

`--delay <ms>` sets the pause between block iterations (default: 1000ms).

`--on-match <command>` runs a shell command on each match. Use `{field}` tokens for substitution:
```
./evmap ... --on-match 'echo {contractAddress} {blockNumber}'
```
Available tokens: `{blockNumber}`, `{transactionHash}`, `{contractAddress}`, `{ownerAddress}`, `{transactionNonce}`, `{transactionValue}`, `{contractBalance}`, `{transactionData}`, `{contractBytecode}`.

Each substituted value is wrapped in POSIX single quotes before the command is passed to `/bin/sh`, so on-chain data can never be interpreted as shell syntax. Do not add your own quotes around a token; `{contractAddress}` already expands to a single quoted argument.

`--action-script <file>` loads a JS module and calls its default export on each match:
```
./evmap ... --action-script ./my-action.js
```
```js
// my-action.js
module.exports = async function(match, provider) {
    // match has the same fields as the {field} tokens above
    // provider is the live ethers.providers.JsonRpcProvider instance
};
```

Other scanner options:
- `--client <name>` — host used to build the RPC URL when `--url` is not given (default: `localhost`, combined with `--port` as `http://<client>:<port>`).
- `--block-end <block>` — end of the scan range; if omitted, defaults to the current network block number.
- `--query-file <file>` — read the query from a file instead of `--query` (mutually exclusive with `--query`).
- `--search-creation` / `--search-runtime` — match against the creation transaction data and/or the deployed runtime bytecode. If neither is given, `--search-runtime` is used by default.
- `--balance` — only report contracts with a non-zero balance.
- `--output-file <file>` — write matches to a JSON array file (see Output file format below).
- `--status` — print per-block progress during the scan.
- `--verbose` — print full transaction/receipt/bytecode data during the scan.
- `--summary` — print a summary of all matches at the end (requires `--output-file`).

Run the evmap-hex utility (generates function signatures/keccak256 hashes):
```
./evmap-hex --input 'transfer(address,uint256)'
./evmap-hex --input 'transfer(address,uint256)' --signature   # 4-byte selector only
```

Run the tests (dependency-free, Node `assert` only; covers the RPC retry helper, the query parser, the `evmap` command-line validation, the `evmap-hex` utility, the `--on-match` substitution, the `--output-file` writing, the `--summary` output, the `--balance` filter, the `--search-creation` / `--search-runtime` selection, the `--action-script` option and the `--status` progress lines; the last nine spawn the real executables, the CLI tests against a closed local port and the scan tests against the fake JSON-RPC server in `test/fake-rpc.js`, whose `startFakeRpcServer(overrides)` accepts per-method result overrides, each a value or a function of the call params):
```
npm test
```

## Architecture

Two executable entry points (`evmap` and `evmap-hex`), both `#!/usr/bin/env node` scripts using `commander` for CLI parsing. `package.json` exposes them as the `evmap` and `evmap-hex` commands via its `bin` field.

**`evmap`** — the main tool. Iterates over a range of Ethereum blocks, finds contract-creation transactions (those with no `to` address), and matches their creation data or runtime bytecode against a user-supplied query expression.

**`evmap-hex`** — a small utility that computes `keccak256` hashes of ABI function signatures, used to generate the hex values that queries match against.

### Query language (`utils/search-utils.js`)

The query syntax wraps tokens in `<< >>`:
- `<<transfer(address,uint256)>>` — a Solidity function signature; gets hashed to its 4-byte selector
- `<<0x21[0-9]{4}3131>>` — a raw hex pattern; supports regex

At evaluation time (`SearchUtils`):
1. `hexaizeQuery()` converts `<< >>` tokens into `< >` tokens, replacing signatures with their 4-byte hex selectors and stripping the `0x` prefix.
2. `evaluateQuery()` processes `! <token>` (NOT), `<token>` (presence match), `&&` (AND → `*`), `||` (OR → `+`) and delegates to `mathjs` for boolean arithmetic.

### Data flow

```
evmap CLI
  → validateCommandLine()       parses + validates args → SearchParameters
  → statusUtils.retrieveNetworkState()  connects via JsonRpcProvider
  → for each block:
      provider.getBlock() → provider.getTransaction() → filter to contract creations (tx.to == null)
      → provider.getTransactionReceipt() for contractAddress
      → provider.getCode() / transaction.data for bytecode
      (every provider call above goes through rpcUtils.withRetry())
      → searchUtils.foundMatch(bytecode)
      → print match + optionally append to JSON output file
      → optionally run --on-match shell command
      → optionally call --action-script module function
```

### `utils/` modules

| File | Purpose |
|---|---|
| `search-parameters.js` | Plain data object holding all scan configuration (url, delay, block range, query, on-match action flags) |
| `search-utils.js` | Query parsing and bytecode matching logic |
| `network-state.js` | Plain data object holding provider, signer, and network metadata |
| `status-utils.js` | Connects to the RPC node via URL, populates `NetworkState`, prints network/contract status; signer setup is optional and skipped gracefully for read-only public providers |
| `contract-utils.js` | Thin wrappers around `ethers.js` for provider creation and contract deployment (used externally, not by scanner itself); `getProvider(url)` accepts any JSON-RPC URL |
| `print-utils.js` | Columnar console output helpers |
| `rpc-utils.js` | `withRetry(description, fn)` retries a provider call with exponential backoff (5 attempts, 1s base, 16s cap), logs each retry to stderr, and rethrows a wrapped error (original in `.cause`) after the last attempt; `describeError()` appends ethers v4's `responseText` to the message |

### Error handling

Transient RPC failures (rate limits, timeouts, dropped connections) are handled per call by `rpcUtils.withRetry()` in the block loop. When retries are exhausted, or the endpoint is unreachable at startup, the error propagates out of `main()` to the single `.catch` at the bottom of `evmap`, which prints `scan aborted: <reason>` (naming the failing block), the output file path if any, the full error under `--verbose`, and sets exit code 1. `process.exitCode` is used rather than `process.exit()` so pending `--on-match` child processes can finish. Command-line validation errors in `evmap` (and a missing `--input` in `evmap-hex`) are printed to stderr through `printUtils.printError()` and exit with code 1 before any connection is made. The retry policy is intentionally not configurable from the command line.

### Key dependencies

- **ethers v4** (`ethers.providers.JsonRpcProvider`) — RPC connection; note this is the older v4 API (e.g. `ethers.utils.id`, not `ethers.id`)
- **commander v2** — CLI parsing
- **mathjs** — evaluates the boolean query expression after token substitution

### Output file format

JSON array written to `--output-file`. Each matched contract entry:
```json
{
  "blockNumber": 7264284,
  "transactionHash": "0x...",
  "contractAddress": "0x...",
  "ownerAddress": "0x...",
  "transactionNonce": 0,
  "transactionValue": "0",
  "contractBalance": "0",
  "transactionData": "0x...",
  "contractBytecode": "0x..."
}
```

`template-input-signature` is an example query file for use with `--query-file`.
