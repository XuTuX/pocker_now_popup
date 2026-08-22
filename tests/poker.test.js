const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../poker.js');
require('../gto.js');

const P = global.PNHACards;
const GTO = global.PNHAGTO;
const card = (r, s) => ({ r, s });

test('rankCompare compares every high-card kicker', () => {
  const a = P.evalMade([
    card(14, 's'), card(13, 'h'), card(9, 'd'), card(4, 'c'), card(2, 's')
  ]);
  const b = P.evalMade([
    card(14, 's'), card(13, 'h'), card(8, 'd'), card(4, 'c'), card(2, 's')
  ]);
  assert.equal(P.rankCompare(a, b) > 0, true);
});

test('rankCompare compares all pair kickers', () => {
  const a = P.evalMade([
    card(14, 's'), card(14, 'h'), card(13, 'd'), card(12, 'c'), card(2, 's')
  ]);
  const b = P.evalMade([
    card(14, 's'), card(14, 'h'), card(13, 'd'), card(11, 'c'), card(2, 's')
  ]);
  assert.equal(P.rankCompare(a, b) > 0, true);
});

test('rankCompare compares flush cards after the top card', () => {
  const a = P.evalMade([
    card(14, 's'), card(13, 's'), card(9, 's'), card(4, 's'), card(2, 's')
  ]);
  const b = P.evalMade([
    card(14, 's'), card(12, 's'), card(9, 's'), card(4, 's'), card(2, 's')
  ]);
  assert.equal(P.rankCompare(a, b) > 0, true);
});

test('manual GTO raise mode does not auto-limp an RFI hand', () => {
  const decision = GTO.decide({
    hand: 'AKo',
    position: 'UTG',
    tableSize: 6,
    toCallBB: 1,
    myBetBB: 0,
    stackBB: 100,
    limpers: 0,
    street: 0,
    aggroAuto: false,
    streetMode: 'all'
  });
  assert.equal(decision.action, 'wait');
  assert.match(decision.reason, /오픈/);
});
