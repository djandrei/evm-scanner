const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

// These tests spawn the real `evmap-hex` executable. The expected hashes are
// the well-known keccak256 values of the ERC-20 signatures.

const evmapHexPath = path.join(__dirname, '..', 'evmap-hex');

function runEvmapHex(args)
{
    let result = childProcess.spawnSync(process.execPath, [evmapHexPath].concat(args), { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// a line as printed by printUtils.printToConsole('hex', 10, value)
function hexLine(value)
{
    return 'hex'.padEnd(10, ' ') + value + '\n';
}

function assertHex(args, expected)
{
    let result = runEvmapHex(args);
    assert.strictEqual(result.stdout, hexLine(expected), 'stdout for: ' + args.join(' '));
    assert.strictEqual(result.stderr, '');
    assert.strictEqual(result.status, 0);
}

function assertUsageError(args)
{
    let result = runEvmapHex(args);
    assert.strictEqual(result.stderr, 'option \'--input <input>\' missing\n', 'stderr for: ' + args.join(' '));
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.status, 1);
}

function testFullHashOfSignature()
{
    assertHex(['--input', 'transfer(address,uint256)'],
        '0xa9059cbb2ab09eb219583f4a59a5d0623ade346d962bcd4e46b11da047c9049b');
}

function testSelectorOfSignature()
{
    assertHex(['--input', 'transfer(address,uint256)', '--signature'], '0xa9059cbb');
    assertHex(['--input', 'balanceOf(address)', '--signature'], '0x70a08231');
}

function testSelectorFlagOrderDoesNotMatter()
{
    assertHex(['--signature', '--input', 'transfer(address,uint256)'], '0xa9059cbb');
}

function testWhitespaceInSignatureChangesTheHash()
{
    // evmap-hex hashes the input text as given; it does not normalize it
    let result = runEvmapHex(['--input', 'transfer(address, uint256)', '--signature']);
    assert.strictEqual(result.status, 0);
    assert.notStrictEqual(result.stdout, hexLine('0xa9059cbb'));
}

function testHexLookingInputIsHashedAsText()
{
    // '0xabcdef' is not decoded as bytes; it is hashed as the 8-character string
    assertHex(['--input', '0xabcdef'],
        '0xb1f1f26239f5476c09b367f6b4fcfa4f410c7938676514889db27a387c000238');
    assertHex(['--input', '0xabcdef', '--signature'], '0xb1f1f262');
}

function testMissingInput()
{
    assertUsageError([]);
    assertUsageError(['--signature']);
}

function testEmptyInput()
{
    assertUsageError(['--input', '']);
}

function main()
{
    testFullHashOfSignature();
    testSelectorOfSignature();
    testSelectorFlagOrderDoesNotMatter();
    testWhitespaceInSignatureChangesTheHash();
    testHexLookingInputIsHashedAsText();
    testMissingInput();
    testEmptyInput();
    console.log('evmap-hex tests passed');
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
