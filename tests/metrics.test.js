'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Metrics = require('../metrics.js');

test('wait time uses whole units without rounding up a milestone', () => {
  assert.deepEqual(Metrics.formatWaitTime(59999), [{ value: 59, unit: 's' }]);
  assert.deepEqual(Metrics.formatWaitTime(60000), [{ value: 1, unit: 'm' }, { value: 0, unit: 's' }]);
  assert.deepEqual(Metrics.formatWaitTime(3599999), [{ value: 59, unit: 'm' }, { value: 59, unit: 's' }]);
  assert.deepEqual(Metrics.formatWaitTime(3600000), [{ value: 1, unit: 'h' }, { value: 0, unit: 'm' }]);
  assert.deepEqual(Metrics.formatWaitTime(3600000000), [{ value: 41, unit: 'd' }, { value: 16, unit: 'h' }]);
});

test('existing totals immediately unlock milestones without changing saved metrics', () => {
  const saved = { total: 206, totalGenTime: 51 * 3600000, achievements: ['Ding Centurion'], streak: 42 };
  const before = JSON.stringify(saved);
  const model = Metrics.summary(saved);
  assert.equal(model.dings, 206);
  assert.equal(model.timeText, '51h 0m');
  assert.equal(model.featured.id, 'wait-24');
  assert.equal(model.milestones.find(item => item.id === 'ding-100').reached, true);
  assert.equal(model.milestones.find(item => item.id === 'ding-1000').reached, false);
  assert.equal(JSON.stringify(saved), before);
});

test('milestones unlock at the exact recorded total', () => {
  const before = Metrics.summary({ total: 99, totalGenTime: 3599999 });
  const after = Metrics.summary({ total: 100, totalGenTime: 3600000 });
  for (const id of ['ding-100', 'wait-1']) {
    assert.equal(before.milestones.find(item => item.id === id).reached, false);
    assert.equal(after.milestones.find(item => item.id === id).reached, true);
  }
});

test('legacy ding counts remain visible without inventing wait time', () => {
  const model = Metrics.summary({}, 1248);
  assert.equal(model.dings, 1248);
  assert.equal(model.wait, 0);
  assert.equal(model.timeText, '0s');
  assert.equal(model.featured.id, 'ding-1000');
});

test('empty or invalid data never creates a milestone', () => {
  for (const input of [undefined, {}, { total: NaN, totalGenTime: Infinity }, { total: -1, totalGenTime: -1 }]) {
    const model = Metrics.summary(input, '1000');
    assert.equal(model.dings, 0);
    assert.equal(model.wait, 0);
    assert.equal(model.featured, null);
    assert.equal(model.reached, 0);
  }
});
