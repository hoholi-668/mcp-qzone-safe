#!/usr/bin/env node
// 录制某个 OneBot 后端（SnowLuma / NapCat）的真实响应，脱敏后存成 fixture。
//
// 用途：让 CI 在没有网关的情况下，仍能验证「同一套解析代码对两种后端都成立」。
//
// 用法：
//   node scripts/record-backend.mjs \
//     --backend snowluma \
//     --url http://127.0.0.1:3000 \
//     --token <token> \
//     --uin <你自己的号> \
//     --out test/backends/snowluma.json
//
// 只调用**只读** action（get_login_info / get_qzone_msg_list / get_qzone_msg_detail），
// 不点赞、不评论、不发说说。

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else { out[key] = true; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const backend = String(args.backend || '').trim();
const baseUrl = String(args.url || '').trim().replace(/\/+$/, '');
const token = String(args.token || '').trim();
const uin = String(args.uin || '').trim();
const out = String(args.out || '').trim();

if (!backend || !baseUrl || !uin || !out) {
  console.error('用法: node scripts/record-backend.mjs --backend <名字> --url <baseUrl> --token <token> --uin <号> --out <文件>');
  process.exit(2);
}

async function call(action, params = {}) {
  const res = await fetch(`${baseUrl}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000)
  });
  return res.json().catch(() => ({ status: 'failed', retcode: -1, wording: 'invalid json' }));
}

// ── 脱敏：fixture 会进公开仓库，不能带真实 QQ 号 / 说说内容 / 图片地址 ──
const TEXT_KEYS = new Set(['content', 'name', 'nickname', 'message', 'title', 'desc', 'summary', 'text', 'wording']);
const TID_KEYS = new Set(['tid', 'feed_id', 'id']);

function makeRedactor() {
  const uinMap = new Map();
  const tidMap = new Map();
  let uinSeq = 0;
  let tidSeq = 0;
  return function redact(value, key = '') {
    if (Array.isArray(value)) return value.map((v) => redact(v, key));
    if (value && typeof value === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(value)) o[k] = redact(v, k);
      return o;
    }
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key)) return '（示例文本）';
      if (TID_KEYS.has(key)) {
        if (!tidMap.has(value)) { tidSeq += 1; tidMap.set(value, `TID${String(tidSeq).padStart(4, '0')}`); }
        return tidMap.get(value);
      }
      if (/^https?:\/\//i.test(value)) return 'https://example.invalid/resource';
      if (/^\d{5,12}$/.test(value)) {
        if (!uinMap.has(value)) { uinSeq += 1; uinMap.set(value, String(10000 + uinSeq)); }
        return uinMap.get(value);
      }
      return value;
    }
    if (typeof value === 'number' && Number.isInteger(value) && value >= 10000 && value <= 99999999999) {
      const s = String(value);
      if (!uinMap.has(s)) { uinSeq += 1; uinMap.set(s, String(10000 + uinSeq)); }
      return Number(uinMap.get(s));
    }
    return value;
  };
}

(async () => {
  const actions = {};

  actions.get_login_info = await call('get_login_info', {});
  console.log('  get_login_info:', actions.get_login_info?.status, '| app:', actions.get_login_info?.data?.app_name || '(无)');

  actions.get_qzone_msg_list = await call('get_qzone_msg_list', { target_uin: Number(uin), pos: 0, num: 3 });
  const tid = actions.get_qzone_msg_list?.data?.msglist?.[0]?.tid;
  console.log('  get_qzone_msg_list:', actions.get_qzone_msg_list?.status,
    '| 条数:', Array.isArray(actions.get_qzone_msg_list?.data?.msglist) ? actions.get_qzone_msg_list.data.msglist.length : 0,
    '| tid:', tid || '(无)');

  if (tid) {
    actions.get_qzone_msg_detail = await call('get_qzone_msg_detail', { tid, target_uin: Number(uin), pos: 0, num: 20 });
    const cm = actions.get_qzone_msg_detail?.data?.comments;
    console.log('  get_qzone_msg_detail:', actions.get_qzone_msg_detail?.status,
      '| 评论数:', Array.isArray(cm) ? cm.length : 0);
  } else {
    actions.get_qzone_msg_detail = null;
    console.log('  get_qzone_msg_detail: 跳过（没有可用 tid）');
  }

  const redact = makeRedactor();
  const fixture = {
    backend,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: '录制自真实网关；文本/QQ号/tid/URL 已脱敏，只保留结构。',
    actions: redact(actions)
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`\n  已写入 ${out}`);
})().catch((error) => {
  console.error('录制失败：', error?.message ?? error);
  process.exit(1);
});
