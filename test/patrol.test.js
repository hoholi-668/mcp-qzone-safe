import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPatrolTargets, pickNewPosts, mergeSeen, formatPatrolDigest } from '../src/patrol.js';

test('轮询挑人：接着上次的位置，循环', () => {
  const uins = ['a', 'b', 'c', 'd'];
  assert.deepEqual(pickPatrolTargets(uins, 0, 2), { targets: ['a', 'b'], nextIndex: 2 });
  assert.deepEqual(pickPatrolTargets(uins, 2, 2), { targets: ['c', 'd'], nextIndex: 0 });
  // 越界回绕
  assert.deepEqual(pickPatrolTargets(uins, 3, 3), { targets: ['d', 'a', 'b'], nextIndex: 2 });
  // 空列表
  assert.deepEqual(pickPatrolTargets([], 0, 3), { targets: [], nextIndex: 0 });
});

test('只挑没看过的说说', () => {
  const posts = [
    { tid: 't1', content: '旧' },
    { tid: 't2', content: '新1' },
    { tid: 't3', content: '新2' }
  ];
  const out = pickNewPosts(posts, ['t1'], 2);
  assert.deepEqual(out.map((p) => p.tid), ['t2', 't3']);
  // 没看过的限制数量
  assert.equal(pickNewPosts(posts, [], 1).length, 1);
  // 空/异常输入
  assert.deepEqual(pickNewPosts(null, ['x']), []);
  assert.deepEqual(pickNewPosts(posts, undefined, 5).map((p) => p.tid), ['t1', 't2', 't3']);
});

test('已见列表去重并保留最近 500 条', () => {
  const merged = mergeSeen(['a', 'b'], ['b', 'c']);
  assert.deepEqual(merged, ['a', 'b', 'c']);
  const big = Array.from({ length: 600 }, (_, i) => `t${i}`);
  const capped = mergeSeen(big, ['new']);
  assert.equal(capped.length, 500);
  assert.equal(capped[capped.length - 1], 'new');
});

test('巡视摘要：没有新动态就不输出', () => {
  assert.equal(formatPatrolDigest([{ uin: 'u1', name: 'A', posts: [] }]), '');
  const text = formatPatrolDigest([
    { uin: 'u1', name: 'A', posts: [{ tid: 't1', content: '今天吃了面' }] }
  ]);
  assert.match(text, /A 有新说说/);
  assert.match(text, /今天吃了面/);
  assert.match(text, /tid t1/);
});
