// 双后端回归：对录制下来的真实响应（已脱敏）跑同一套解析断言。
//
// 为什么需要它：SnowLuma 和 NapCat 都能跑，但「跑得起来」不等于「字段都对」。
// 把两家的真实响应录成 fixture，CI 就能在没有网关的环境下证明：
// 同一套解析代码，对两个后端都成立。
//
// 新增后端：用 scripts/record-backend.mjs 录一份 test/backends/<名字>.json 即可，
// 这个文件会自动为它生成测试。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizePosts, summarizeComments, pickCommentId, pickPublishTid } from '../src/format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'backends');

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  : [];

if (files.length === 0) {
  test('还没有录制任何后端 fixture（先跑 scripts/record-backend.mjs）', () => {
    assert.ok(true);
  });
}

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const name = fixture.backend || path.basename(file, '.json');
  const actions = fixture.actions || {};

  test(`${name}：get_login_info 有 user_id`, () => {
    const data = actions.get_login_info?.data || {};
    const uid = data.user_id ?? data.uin;
    assert.ok(uid != null && String(uid).length >= 5, `user_id 缺失：${JSON.stringify(data).slice(0, 80)}`);
  });

  test(`${name}：说说列表能被 summarizePosts 解析`, () => {
    const body = actions.get_qzone_msg_list;
    assert.ok(body, '缺少 get_qzone_msg_list 记录');
    assert.equal(body.status, 'ok', `网关返回 ${body.status}/${body.retcode}`);
    const s = summarizePosts(body);
    assert.ok(Array.isArray(s.posts), 'posts 不是数组');
    assert.ok(s.posts.length > 0, '一条说说都没解析出来');
    for (const p of s.posts) {
      assert.ok(p.tid != null && String(p.tid).length > 0, 'tid 缺失');
      assert.equal(typeof p.content, 'string');
      assert.ok(p.commentCount === null || typeof p.commentCount === 'number');
    }
  });

  test(`${name}：评论能被 summarizeComments 解析`, () => {
    const body = actions.get_qzone_msg_detail;
    if (!body) return; // 录制时没有可用 tid，跳过
    assert.equal(body.status, 'ok', `网关返回 ${body.status}/${body.retcode}`);
    const s = summarizeComments(body, 'TID0000');
    assert.ok(Array.isArray(s.comments), 'comments 不是数组');
    for (const c of s.comments) {
      assert.equal(typeof c.commentId, 'string');
      assert.ok(c.commentId.length > 0, 'comment_id 缺失（楼中楼回复要用它）');
      assert.ok(Array.isArray(c.replies), 'replies 不是数组');
    }
    assert.equal(typeof s.commentCount, 'number');
  });
}

// 写入接口的返回字段：两家命名可能不同，提取器要都认
test('pickCommentId 兼容两种后端命名', () => {
  assert.equal(pickCommentId({ data: { comment_id: 'A1' } }), 'A1');
  assert.equal(pickCommentId({ data: { commentId: 'B2' } }), 'B2');
  assert.equal(pickCommentId({ data: { commentid: 'C3' } }), 'C3');
  assert.equal(pickCommentId({ data: { comment: { comment_id: 'D4' } } }), 'D4');
  assert.equal(pickCommentId({ data: {} }), '');
  assert.equal(pickCommentId(null), '');
});

test('pickPublishTid 兼容两种后端命名', () => {
  assert.equal(pickPublishTid({ data: { tid: 'T1' } }), 'T1');
  assert.equal(pickPublishTid({ data: { msgid: 'T2' } }), 'T2');
  assert.equal(pickPublishTid({ data: {} }), '');
});
