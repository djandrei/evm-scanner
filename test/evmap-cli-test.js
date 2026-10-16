const assert = require('assert');
const childProcess = require('child_process');
const fileSystem = require('fs');
const os = require('os');
const path = require('path');

// These tests spawn the real `evmap` executable and inspect what
// validateCommandLine() prints. Errors go to stderr with exit code 1; the
// parameter summary of a valid command line goes to stdout. A valid command
// line goes on to try to connect; pointing it at a closed local port makes
// that fail fast with 'scan aborted: cannot connect ...' on stderr, which
// doubles as proof that validation passed. Nothing here touches the network.

const evmapPath = path.join(__dirname, '..', 'evmap');
const unreachableUrl = 'http://127.0.0.1:1';

function runEvmap(args)
{
    let result = childProcess.spawnSync(process.execPath, [evmapPath].concat(args), { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// a line as printed by printUtils.printToConsole(label, 26, value)
function parameterLine(label, value)
{
    return label.padEnd(26, ' ') + value + '\n';
}

function assertValidationError(args, message)
{
    let result = runEvmap(args);
    assert.strictEqual(result.stderr, message + '\n', 'stderr for: ' + args.join(' '));
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.status, 1);
}

function assertValidationPassed(result, args)
{
    assert.ok(result.stderr.includes('scan aborted: cannot connect to ' + unreachableUrl),
        'expected validation to pass and the connect to fail for: ' + args.join(' ') + '\n' + result.stdout + result.stderr);
    assert.strictEqual(result.status, 1);
}

function runValid(args)
{
    let result = runEvmap(args);
    assertValidationPassed(result, args);
    return result.stdout;
}

function testMissingPortAndUrl()
{
    assertValidationError(
        ['--block-start', '1', '--query', '<<0xdead>>'],
        'option \'--port <port>\' or \'--url <url>\' missing');
}

function testInvalidPort()
{
    let message = 'option \'--port <port>\' must be a number between 1 and 65535';
    assertValidationError(['--port', 'abc', '--block-start', '1', '--query', '<<0xdead>>'], message);
    assertValidationError(['--port', '0', '--block-start', '1', '--query', '<<0xdead>>'], message);
    assertValidationError(['--port', '65536', '--block-start', '1', '--query', '<<0xdead>>'], message);
    // an invalid --port is rejected even when --url would otherwise be used
    assertValidationError(['--port', 'abc', '--url', unreachableUrl, '--block-start', '1', '--query', '<<0xdead>>'], message);
}

function testMissingBlockStart()
{
    assertValidationError(
        ['--port', '8545', '--query', '<<0xdead>>'],
        'option \'--block-start <block>\' missing');
}

function testBlockStartGreaterThanBlockEnd()
{
    assertValidationError(
        ['--port', '8545', '--block-start', '10', '--block-end', '9', '--query', '<<0xdead>>'],
        'block start cannot be greater than block end');
}

function testMissingQuery()
{
    assertValidationError(
        ['--port', '8545', '--block-start', '1'],
        'option \'--query <query>\' or \'--query-file <file>\' missing');
}

function testBothQueryAndQueryFile()
{
    assertValidationError(
        ['--port', '8545', '--block-start', '1', '--query', '<<0xdead>>', '--query-file', 'some-file'],
        'both \'--query <query>\' or \'--query-file <file>\' specified');
}

function testActionScriptNotFound()
{
    let missing = path.join(os.tmpdir(), 'evmap-missing-action-script.js');
    assertValidationError(
        ['--url', unreachableUrl, '--block-start', '1', '--query', '<<0xdead>>', '--action-script', missing],
        'action script file not found: ' + missing);
}

function testUrlIsBuiltFromClientAndPort()
{
    // --client and --port cannot produce an unreachable URL that is also
    // deterministic to assert on, so this one checks the printed URL only
    let result = runEvmap(['--port', '1', '--client', '127.0.0.1', '--block-start', '5', '--query', '<<0xdead>>']);

    assert.ok(result.stdout.includes(parameterLine('url', 'http://127.0.0.1:1')));
    assertValidationPassed(result, ['--port', '1', '--client', '127.0.0.1']);
}

function testDefaultClientIsLocalhost()
{
    let result = runEvmap(['--port', '8545', '--block-start', '5', '--query', '<<0xdead>>']);

    assert.ok(result.stdout.includes(parameterLine('url', 'http://localhost:8545')));
}

function testUrlOverridesClientAndPort()
{
    let stdout = runValid(['--url', unreachableUrl, '--port', '8545', '--client', 'example.invalid',
        '--block-start', '5', '--query', '<<0xdead>>']);

    assert.ok(stdout.includes(parameterLine('url', unreachableUrl)));
}

function testDefaults()
{
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>']);

    assert.ok(stdout.includes(parameterLine('delay (ms)', '1000')));
    assert.ok(stdout.includes(parameterLine('block start', '5')));
    assert.ok(!stdout.includes('block end'), 'block end should not be printed when --block-end is omitted');
    assert.ok(stdout.includes(parameterLine('query', '<<0xdead>>')));
    assert.ok(stdout.includes(parameterLine('search creation bytecode', 'false')));
    assert.ok(stdout.includes(parameterLine('search runtime bytecode', 'true')));
    assert.ok(!stdout.includes('only contracts with non-zero balance'));
    assert.ok(!stdout.includes('displays status during scan'));
    assert.ok(!stdout.includes('displays summary at the end of the scan'));
    assert.ok(!stdout.includes('output file'));
    assert.ok(!stdout.includes('on-match command'));
    assert.ok(!stdout.includes('action script'));
}

function testExplicitBlockEndAndZeroDelay()
{
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--block-end', '7', '--delay', '0',
        '--query', '<<0xdead>>']);

    assert.ok(stdout.includes(parameterLine('block end', '7')));
    assert.ok(stdout.includes(parameterLine('delay (ms)', '0')), '--delay 0 must not fall back to the default');
}

function testEqualBlockStartAndEndIsAccepted()
{
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '7', '--block-end', '7', '--query', '<<0xdead>>']);

    assert.ok(stdout.includes(parameterLine('block start', '7')));
    assert.ok(stdout.includes(parameterLine('block end', '7')));
}

function testSearchCreationOnly()
{
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>', '--search-creation']);

    assert.ok(stdout.includes(parameterLine('search creation bytecode', 'true')));
    assert.ok(stdout.includes(parameterLine('search runtime bytecode', 'false')));
}

function testSearchCreationAndRuntime()
{
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>',
        '--search-creation', '--search-runtime']);

    assert.ok(stdout.includes(parameterLine('search creation bytecode', 'true')));
    assert.ok(stdout.includes(parameterLine('search runtime bytecode', 'true')));
}

function testQueryFileIsReadAndNewlinesStripped()
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    let queryFile = path.join(directory, 'query');
    fileSystem.writeFileSync(queryFile, '<<0xdead>> &&\n<<0xbeef>>\n');
    try
    {
        let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query-file', queryFile]);

        assert.ok(stdout.includes(parameterLine('query', '<<0xdead>> &&<<0xbeef>>')));
    }
    finally
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    }
}

function testOptionalFlagsAndFilesArePrinted()
{
    let directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'evmap-test-'));
    let actionScript = path.join(directory, 'action.js');
    fileSystem.writeFileSync(actionScript, 'module.exports = function() {};\n');
    try
    {
        let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>',
            '--balance', '--status', '--verbose', '--summary',
            '--output-file', 'matches.json',
            '--on-match', 'echo {contractAddress}',
            '--action-script', actionScript]);

        assert.ok(stdout.includes('only contracts with non-zero balance'));
        assert.ok(stdout.includes('displays status during scan'));
        assert.ok(stdout.includes('displays summary at the end of the scan'));
        assert.ok(stdout.includes(parameterLine('output file', 'matches.json')));
        assert.ok(stdout.includes(parameterLine('on-match command', 'echo {contractAddress}')));
        assert.ok(stdout.includes(parameterLine('action script', path.resolve(actionScript))));
    }
    finally
    {
        fileSystem.rmSync(directory, { recursive: true, force: true });
    }
}

function testRelativeActionScriptIsResolved()
{
    // a repo module that exports a function, relative to the repo root the test runs from
    let stdout = runValid(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>',
        '--action-script', 'utils/search-parameters.js']);

    assert.ok(stdout.includes(parameterLine('action script', path.resolve('utils/search-parameters.js'))));
}

function testActionScriptMustExportFunction()
{
    // package.json loads as a module but exports an object, not a function
    let result = runEvmap(['--url', unreachableUrl, '--block-start', '5', '--query', '<<0xdead>>',
        '--action-script', 'package.json']);

    assert.ok(result.stdout.includes(parameterLine('action script', path.resolve('package.json'))));
    assert.strictEqual(result.stderr, 'action script must export a function\n');
    assert.strictEqual(result.status, 1);
}

function main()
{
    testMissingPortAndUrl();
    testInvalidPort();
    testMissingBlockStart();
    testBlockStartGreaterThanBlockEnd();
    testMissingQuery();
    testBothQueryAndQueryFile();
    testActionScriptNotFound();
    testUrlIsBuiltFromClientAndPort();
    testDefaultClientIsLocalhost();
    testUrlOverridesClientAndPort();
    testDefaults();
    testExplicitBlockEndAndZeroDelay();
    testEqualBlockStartAndEndIsAccepted();
    testSearchCreationOnly();
    testSearchCreationAndRuntime();
    testQueryFileIsReadAndNewlinesStripped();
    testOptionalFlagsAndFilesArePrinted();
    testRelativeActionScriptIsResolved();
    testActionScriptMustExportFunction();
    console.log('evmap cli tests passed');
}

try
{
    main();
}
catch (error)
{
    console.error(error);
    process.exit(1);
}
