#!/usr/bin/env node
// mcp-qzone-safe 的 MCP 协议层自测（只读）。
//
// 只调用「读」工具，不点赞、不评论、不发说说——避免在真实账号上留下痕迹。
// 写操作的安全性由单元测试（guard/format）覆盖：限频、去重、长度、白名单。
//
// 环境变量：
//   QZONE_ONEBOT_URL    必填，例如 http://127.0.0.1:3000
//   QZONE_ONEBOT_TOKEN  必填（SnowLuma 的 access token）
//   QZONE_TEST_UIN      被测的 QQ 号（必须在 allowUins 里），例如机器人自己的号
//   QZONE_TEST_TID      可选：一条有评论的说说 tid（不给就自动从列表里挑）
//
// 用法：QZONE_ONEBOT_URL=... QZONE_ONEBOT_TOKEN=... QZONE_TEST_UIN=2144594778 node scripts/selftest-mcp.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = process.env.QZONE_ONEBOT_URL;
const token = process.env.QZONE_ONEBOT_TOKEN;
const testUin = process.env.QZONE_TEST_UIN;
if (!url || !token || !testUin) {
  console.error('需要 QZONE_ONEBOT_URL / QZONE_ONEBOT_TOKEN / QZONE_TEST_UIN');
  process.exit(1);
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); return true; }
  fail += 1; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function textOf(result) {
  return (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

// 临时配置：只允许操作被测号
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qzone-selftest-'));
const cfgPath = path.join(dir, 'config.json');
fs.writeFileSync(cfgPath, JSON.stringify({
  onebot: { baseUrl: url, token },
  allowUins: [testUin],
  publishEnabled: false,
  limits: { like: { perHour: 2, perDay: 2 }, comment: { perHour: 1, perDay: 1 }, publish: { perHour: 1, perDay: 1 } }
}, null, 2));

const client = new Client({ name: 'qzone-selftest', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, '../src/index.js')],
  env: { ...process.env, QZONE_CONFIG: cfgPath, QZONE_STATE_DIR: path.join(dir, 'state') }
});

try {
  await client.connect(transport);

  console.log('\n[1] 工具清单');
  const tools = (await client.listTools()).tools || [];
  const names = tools.map((t) => t.name).sort();
  ok('六个工具都在', ['qzone_see_posts', 'qzone_comments', 'qzone_like', 'qzone_comment', 'qzone_publish', 'friend_list'].every((n) => names.includes(n)), names.join(', '));

  console.log('\n[2] 读说说');
  const posts = await client.callTool({ name: 'qzone_see_posts', arguments: { target_uin: testUin, num: 3 } });
  const postText = textOf(posts);
  ok('拿到说说列表', !posts.isError && /posts/.test(postText), postText.slice(0, 60).replace(/\n/g, ' '));
  let firstTid = '';
  try { firstTid = JSON.parse(postText).posts?.[0]?.tid || ''; } catch {}
  ok('解析出 tid', Boolean(firstTid), firstTid);

  console.log('\n[3] 读评论');
  const tid = process.env.QZONE_TEST_TID || firstTid;
  if (tid) {
    // 这条说说属于 testUin；不传 target_uin 会按'看自己'处理，所以这里显式传
      const cm = await client.callTool({ name: 'qzone_comments', arguments: { tid, target_uin: testUin, num: 10 } });
    const cmText = textOf(cm);
    ok('读评论不报错', !cm.isError, cmText.slice(0, 70).replace(/\n/g, ' '));
  } else {
    console.log('  (跳过：没有 tid)');
  }

  console.log('\n[4] 白名单拦截');
  const deny = await client.callTool({ name: 'qzone_see_posts', arguments: { target_uin: '10000000', num: 1 } });
  ok('非白名单号被拒', deny.isError && /白名单/.test(textOf(deny)), textOf(deny).slice(0, 60));

  console.log('\n[5] 发说说默认关闭');
  const pub = await client.callTool({ name: 'qzone_publish', arguments: { content: '测试内容（不应发出）' } });
  ok('publish 被拒', pub.isError && /未启用/.test(textOf(pub)), textOf(pub).slice(0, 50));

  console.log('\n[6] 好友名册');
  const friends = await client.callTool({ name: 'friend_list', arguments: {} });
  const fText = textOf(friends);
  ok('friend_list 可用', !friends.isError && /total/.test(fText), fText.slice(0, 50).replace(/\n/g, ' '));
} catch (error) {
  console.error('❌ 协议层失败：', error?.message ?? error);
  fail += 1;
} finally {
  try { await client.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail ? 1 : 0;

