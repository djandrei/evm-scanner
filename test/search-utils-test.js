const assert = require('assert');

const SearchUtils = require('../utils/search-utils.js');

function searchUtilsFor(query)
{
    let searchUtils = new SearchUtils({ query: query });
    searchUtils.setup();
    return searchUtils;
}

function testSignatureIsHashedToSelector()
{
    let searchUtils = searchUtilsFor('<<transfer(address,uint256)>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '<a9059cbb>');
    assert.strictEqual(searchUtils.foundMatch('0x6080a9059cbb6040'), true);
    assert.strictEqual(searchUtils.foundMatch('0x60806040'), false);
}

function testRawHexTokenKeepsPatternAndDropsPrefix()
{
    let searchUtils = searchUtilsFor('<< 0x21[0-9]{4}3131 >>');

    assert.strictEqual(searchUtils.hexaizedQuery, '<21[0-9]{4}3131>');
    assert.strictEqual(searchUtils.foundMatch('0x2112343131ff'), true);
    assert.strictEqual(searchUtils.foundMatch('0x21ab343131ff'), false);
}

function testUppercasePrefixAndCaseInsensitiveMatch()
{
    let searchUtils = searchUtilsFor('<<0XDEAD>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '<DEAD>');
    assert.strictEqual(searchUtils.foundMatch('0xDeAd'), true);
    assert.strictEqual(searchUtils.foundMatch('0xdead'), true);
}

function testNotOperator()
{
    let searchUtils = searchUtilsFor('!<<0xdead>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '!<dead>');
    assert.strictEqual(searchUtils.foundMatch('0xdead'), false);
    assert.strictEqual(searchUtils.foundMatch('0xbeef'), true);
}

function testNotWithWhitespaceCombinedWithAnd()
{
    let searchUtils = searchUtilsFor('! <<0xdead>> && <<0xbeef>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '! <dead> && <beef>');
    assert.strictEqual(searchUtils.foundMatch('0xbeef'), true);
    assert.strictEqual(searchUtils.foundMatch('0xdeadbeef'), false);
    assert.strictEqual(searchUtils.foundMatch('0xdead'), false);
}

function testAndOperator()
{
    let searchUtils = searchUtilsFor('<<0xdead>> && <<0xbeef>>');

    assert.strictEqual(searchUtils.foundMatch('0xdeadbeef'), true);
    assert.strictEqual(searchUtils.foundMatch('0xdead'), false);
    assert.strictEqual(searchUtils.foundMatch('0xbeef'), false);
    assert.strictEqual(searchUtils.foundMatch('0x'), false);
}

function testOrOperator()
{
    let searchUtils = searchUtilsFor('<<0xdead>> || <<0xbeef>>');

    assert.strictEqual(searchUtils.foundMatch('0xdead'), true);
    assert.strictEqual(searchUtils.foundMatch('0xbeef'), true);
    assert.strictEqual(searchUtils.foundMatch('0xcafe'), false);

    // both sides true sums to 2; any non-zero result counts as a match
    assert.strictEqual(searchUtils.evaluateQuery('0xdeadbeef', searchUtils.hexaizedQuery), 2);
    assert.strictEqual(searchUtils.foundMatch('0xdeadbeef'), true);
}

function testRepeatedTokenIsReplacedEverywhere()
{
    let searchUtils = searchUtilsFor('<<0xdead>> && <<0xdead>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '<dead> && <dead>');
    assert.strictEqual(searchUtils.foundMatch('0xdead'), true);
    assert.strictEqual(searchUtils.foundMatch('0xbeef'), false);
}

function testParenthesesAndMixedSignatures()
{
    // same query as the template-input-signature example file
    let searchUtils = searchUtilsFor('( <<kill(address)>> || <<selfdestruct(address)>> ) && <<withdraw(address,uint256)>>');

    assert.strictEqual(searchUtils.hexaizedQuery, '( <cbf0b0c0> || <cfc72007> ) && <f3fef3a3>');
    assert.strictEqual(searchUtils.foundMatch('0xcbf0b0c0f3fef3a3'), true);
    assert.strictEqual(searchUtils.foundMatch('0xcfc72007f3fef3a3'), true);
    assert.strictEqual(searchUtils.foundMatch('0xcbf0b0c0cfc72007'), false);
    assert.strictEqual(searchUtils.foundMatch('0xf3fef3a3'), false);
}

function testHexaizeQueryDoesNotMutateInput()
{
    let searchUtils = new SearchUtils({ query: '<<0xdead>>' });
    let query = '<<transfer(address,uint256)>>';

    searchUtils.hexaizeQuery(query);

    assert.strictEqual(query, '<<transfer(address,uint256)>>');
}

function main()
{
    testSignatureIsHashedToSelector();
    testRawHexTokenKeepsPatternAndDropsPrefix();
    testUppercasePrefixAndCaseInsensitiveMatch();
    testNotOperator();
    testNotWithWhitespaceCombinedWithAnd();
    testAndOperator();
    testOrOperator();
    testRepeatedTokenIsReplacedEverywhere();
    testParenthesesAndMixedSignatures();
    testHexaizeQueryDoesNotMutateInput();
    console.log('search-utils tests passed');
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
