import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneState, countKind, checkRate, recordRate } from '../src/guard.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test('pruneState 只留 24 小时内', () => {
  const now = Date.now();
  const state = {
    like: [now - 2 * DAY, now - HOUR],
    'like:t1': [now - HOUR],
    bad: 'not-an-array'
  };
  const out = pruneState(state, now);
  assert.deepEqual(out.like, [now - HOUR]);
  assert.deepEqual(out['like:t1'], [now - HOUR]);
  assert.equal(out.bad, undefined);
});

test('countKind 分别统计 24h / 1h', () => {
  const now = Date.now();
  const state = { like: [now - HOUR], 'like:a': [now - HOUR, now - 3 * HOUR] };
  assert.deepEqual(countKind(state, 'like', now), { day: 3, hour: 2 });
  // 别的 kind 不串味
  assert.deepEqual(countKind(state, 'comment', now), { day: 0, hour: 0 });
});

test('同一目标 24h 内不能重复', () => {
  const now = Date.now();
  const limits = { like: { perHour: 20, perDay: 50 } };
  const state = recordRate({}, 'like', 't1', now - HOUR);
  const r = checkRate(state, 'like', 't1', limits, now);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /24 小时内不重复/);
  // 换一条说说就可以
  assert.equal(checkRate(state, 'like', 't2', limits, now).allowed, true);
});

test('每小时 / 每天上限', () => {
  const now = Date.now();
  const limits = { comment: { perHour: 2, perDay: 3 } };
  let state = {};
  state = recordRate(state, 'comment', 'a', now - HOUR);
  state = recordRate(state, 'comment', 'b', now - HOUR);
  const r1 = checkRate(state, 'comment', 'c', limits, now);
  assert.equal(r1.allowed, false);
  assert.match(r1.reason, /每小时最多 2 次/);

  // 隔开一小时后，小时限制放开，但日限制仍在（3 次/天）
  const later = now + 2 * HOUR;
  assert.equal(checkRate(state, 'comment', 'c', limits, later).allowed, true);
  state = recordRate(state, 'comment', 'c', now);
  assert.equal(checkRate(state, 'comment', 'd', limits, later).allowed, false);
});

test('recordRate 只写对应 key，聚合 key 由 pruneState 清理', () => {
  const now = Date.now();
  const state = { like: [now - 3 * DAY] };
  const next = recordRate(state, 'like', 'x', now);
  assert.deepEqual(next['like:x'], [now]);
  // 聚合 key 保持不变（读时统一 pruneState）
  assert.deepEqual(next.like, [now - 3 * DAY]);
  assert.deepEqual(pruneState(next, now).like, undefined);
});
