import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePosts, summarizeComments, validateText } from '../src/format.js';

test('说说摘要：截断正文、数图片', () => {
  const body = {
    data: {
      total: 2,
      msglist: [
        { tid: 't1', content: 'a'.repeat(500), time: 1, comment_num: 3, images: [{}, {}], is_private: false },
        { tid: 't2', content: '  hello   world ', time: 2 }
      ]
    }
  };
  const out = summarizePosts(body);
  assert.equal(out.total, 2);
  assert.equal(out.count, 2);
  assert.equal(out.posts[0].content.length, 200);
  assert.equal(out.posts[0].images, 2);
  assert.equal(out.posts[1].content, 'hello world');
});

test('评论摘要：带楼中楼，保留 commentId', () => {
  const body = {
    data: {
      tid: 't1', content: 'x', comment_num: 1,
      comments: [{
        comment_id: '1', name: 'A', uin: 111, time: 9, content: 'hi',
        replies: [{ name: 'B', uin: 222, content: 'yo' }]
      }]
    }
  };
  const out = summarizeComments(body, 't1');
  assert.equal(out.comments[0].commentId, '1');
  assert.equal(out.comments[0].replies[0].name, 'B');
  assert.equal(out.commentCount, 1);
});

test('文本校验：空 / 超长 / CQ 码', () => {
  assert.match(validateText('', 10), /内容为空/);
  assert.match(validateText('字'.repeat(11), 10), /超过 10 字/);
  assert.match(validateText('[CQ:face,id=1]', 10), /CQ 码/);
  assert.equal(validateText('正常评论', 10), null);
  // 按字符数算（emoji 只算 1 个）
  assert.equal(validateText('😀'.repeat(10), 10), null);
});
