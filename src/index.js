#!/usr/bin/env node
// 受限的「QQ 空间」MCP 服务。
//
// 只放四件事（看 / 赞 / 评 / 发），每一件都过闸门：
//   · 目标白名单   —— 只允许对 allowUins 里的号操作（可自动并入指定群的成员）
//   · 去重         —— 同一条说说 24h 内只能赞一次 / 评一次
//   · 频率上限     —— 每小时 / 每天分别限制（评论比点赞严得多）
//   · 长度上限     —— 评论默认 120 字、说说默认 300 字，且拒绝 CQ 码
//   · 审计         —— 每次调用落 <stateDir>/audit.jsonl
//   · 发说说默认关 —— 必须 publishEnabled: true 才可用
//
// 连接 OneBot（SnowLuma 等兼容实现）：
//   QZONE_ONEBOT_URL   默认 http://127.0.0.1:3000
//   QZONE_ONEBOT_TOKEN 访问令牌（可选）
//
// 可选联动：QZONE_BRIDGE_STATE_DIR 指向外部状态目录时，会同步
// 「我回过的评论 / 待回复 / 好友名册」，与 qq-bridge 这类宿主共用状态。

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { pruneState, checkRate, recordRate } from './guard.js';
import { summarizePosts, summarizeComments, validateText } from './format.js';
import { pickPatrolTargets, pickNewPosts, mergeSeen, formatPatrolDigest } from './patrol.js';

const cfg = loadConfig();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* 状态写入失败不影响主流程 */ }
}

function audit(entry) {
  try {
    fs.mkdirSync(cfg.stateDir, { recursive: true });
    fs.appendFileSync(cfg.auditPath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch { /* 审计失败不能影响主流程 */ }
}

async function callOneBot(action, params) {
  const res = await fetch(`${cfg.onebot.baseUrl}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.onebot.token ? { authorization: `Bearer ${cfg.onebot.token}` } : {})
    },
    body: JSON.stringify(params ?? {}),
    signal: AbortSignal.timeout(30_000)
  });
  return res.json().catch(() => ({ status: 'failed', retcode: -1, wording: 'invalid json' }));
}

// ── 白名单：配置里的号 + 可选地从群里补齐 ────────────────────────────────
let groupSeeded = false;
async function seedGroupUins({ attempts = 3 } = {}) {
  if (!cfg.groupUinsFrom.length) { groupSeeded = true; return true; }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let ok = true;
    for (const gid of cfg.groupUinsFrom) {
      try {
        const r = await callOneBot('get_group_member_list', { group_id: Number(gid) });
        const list = Array.isArray(r?.data) ? r.data : [];
        if (!list.length) ok = false;
        for (const m of list) if (m?.user_id) cfg.allowUins.add(String(m.user_id));
      } catch { ok = false; }
    }
    if (ok) {
      groupSeeded = true;
      console.error(`[qzone-safe] 群成员已并入白名单 -> ${cfg.allowUins.size} 个号`);
      return true;
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000));
  }
  console.error('[qzone-safe] 群成员拉取失败（OneBot 可能未就绪），白名单暂只含配置里的账号');
  return false;
}

async function ensureAllowed(uin) {
  const key = String(uin ?? '');
  if (!/^\d{5,12}$/.test(key)) return `target_uin 不是合法 QQ 号：${key}`;
  if (selfUin && key === selfUin) return null;   // 自己永远允许
  if (!cfg.allowUins.has(key) && !groupSeeded) await seedGroupUins({ attempts: 1 });
  if (!cfg.allowUins.has(key)) {
    return `拒绝：${key} 不在白名单内（当前允许：${[...cfg.allowUins].join(', ') || '空'}）。`
      + '如需放开，把该 QQ 号加进配置文件 allowUins 后重启本服务。';
  }
  return null;
}

// ── 频率/去重状态 ───────────────────────────────────────────────────────
function loadRate() { return pruneState(readJson(cfg.ratePath, {})); }
function saveRate(state) { writeJson(cfg.ratePath, state); }

function guard(kind, dedupeKey) {
  const result = checkRate(loadRate(), kind, dedupeKey, cfg.limits);
  return result.allowed ? null : result.reason;
}
function record(kind, dedupeKey) {
  saveRate(recordRate(loadRate(), kind, dedupeKey));
}

// ── 「发完说说顺便逛逛朋友空间」 ─────────────────────────────────────────
// 触发点：她成功发出一条说说后（她本来就醒着），顺便看看好友有没有新动态。
// 好处：不需要额外定时器，也不产生额外唤醒；她当场就能点赞/评论/只是看看。
const PATROL_PATH = path.join(cfg.stateDir, 'qzone-patrol.json');

/** 好友名字（如果宿主配了 friends.json，就用她写过的备注） */
function friendName(uin) {
  if (!bridgeState) return '';
  const friends = readJson(bridgeState.friends, {});
  return friends?.[uin]?.name || '';
}

/**
 * 巡视一轮：挑几个人、拉最近说说、挑没见过的、存状态。
 * 只读，不会点赞或评论；要不要互动由她自己决定。
 */
async function runPatrol() {
  if (!cfg.patrol?.enabled) return '';
  const state = readJson(PATROL_PATH, { seen: [], index: 0 });
  const exclude = new Set([cfg.patrol.selfUin, ...(cfg.patrol.excludeUins || [])].filter(Boolean).map(String));
  const pool = [...cfg.allowUins].filter((u) => !exclude.has(String(u)));
  if (!pool.length) return '';

  const { targets, nextIndex } = pickPatrolTargets(pool, Number(state.index) || 0, cfg.patrol.maxFriends);
  const results = [];
  const seenNew = [];
  const fetched = [];

  for (const uin of targets) {
    try {
      const body = await callOneBot('get_qzone_msg_list', { target_uin: Number(uin), pos: 0, num: 3 });
      const posts = Array.isArray(body?.data?.msglist) ? body.data.msglist : [];
      if (!posts.length) continue;
      for (const p of posts) if (p?.tid) fetched.push(String(p.tid));
      const fresh = pickNewPosts(posts, state.seen, cfg.patrol.perFriend);
      if (fresh.length) {
        results.push({ uin: String(uin), name: friendName(uin), posts: fresh });
        for (const p of fresh) seenNew.push(p.tid);
      }
    } catch { /* 单个好友失败不影响其他 */ }
  }

  // 记下「看到过的」而不是「给她看过的」：好友的老说说下次不该再刷出来
  savePatrol({ seen: mergeSeen(state.seen, [...fetched, ...seenNew]), index: nextIndex });
  audit({ tool: 'patrol', targets: targets.length, fresh: seenNew.length });
  return formatPatrolDigest(results);
}

function savePatrol(next) {
  writeJson(PATROL_PATH, next);
}


// ── 可选联动：与宿主（如 qq-bridge）共用状态 ─────────────────────────────
const bridgeState = cfg.bridgeStateDir ? {
  watch: path.join(cfg.bridgeStateDir, 'qzone-watch.json'),
  pending: path.join(cfg.bridgeStateDir, 'qzone-pending-comment.json'),
  mine: path.join(cfg.bridgeStateDir, 'qzone-my-comments.json'),
  friends: path.join(cfg.bridgeStateDir, 'friends.json'),
  lastPublish: path.join(cfg.bridgeStateDir, 'qzone-last-publish.json')
} : null;

function markReplied(tid, commentUin, newCommentId) {
  if (!bridgeState) return;
  const st = readJson(bridgeState.watch, {});
  st.replied = st.replied || {};
  if (newCommentId) st.replied[newCommentId] = Date.now();
  if (commentUin) {
    st.replied[`uin:${commentUin}:${tid}`] = Date.now();
    st.replied[`tid:${tid}:${commentUin}`] = Date.now();
  }
  writeJson(bridgeState.watch, st);
  const pend = readJson(bridgeState.pending, null);
  if (pend && Array.isArray(pend.items)) {
    const rest = pend.items.filter((x) => String(x.uin) !== String(commentUin) && String(x.tid) !== String(tid));
    if (rest.length) writeJson(bridgeState.pending, { items: rest });
    else { try { fs.unlinkSync(bridgeState.pending); } catch {} }
  }
}

function noteMyComment(host, tid, newCommentId) {
  if (!bridgeState) return;
  const mine = readJson(bridgeState.mine, {});
  mine[`${host}:${tid}`] = { hostUin: String(host || ''), tid: String(tid), commentId: String(newCommentId || ''), at: Date.now(), checkedAt: 0 };
  writeJson(bridgeState.mine, mine);
}

function text(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

// 她自己的 QQ 号：启动后若配置没给，自动从 OneBot 取
let selfUin = String(cfg.selfUin || '');

const server = new McpServer({ name: 'qzone-safe', version: '0.1.0' });

server.tool(
  'qzone_see_posts',
  '查看某个 QQ 号的最新说说（只读）。用户说「朋友们最近发了什么」「看看某人空间」时用；不知道有哪些号就先调 friend_list。**不传 target_uin = 看你自己的空间**（用户说「我空间」「我的说说」时就别传）。返回 tid（评论/点赞要用）、正文摘要、图片数、评论数、总条数。target_uin 必须在白名单内，自己例外。',
  { target_uin: z.string().optional().describe('要查看的 QQ 号；不传就是你自己（看自己空间）'), num: z.number().int().min(1).max(5).optional().describe('取几条，默认 3') },
  async ({ target_uin, num }) => {
    // 不传 target_uin = 看自己的空间（用户说“我空间/我的说说”时最常见）
    const owner = String(target_uin || selfUin || '');
    if (!owner) return text('需要 target_uin：说说主人的 QQ 号。看自己的空间可以不传，但本服务还没拿到你的号。', true);
    const deny = await ensureAllowed(owner);
    if (deny) return text(deny, true);
    try {
      const body = await callOneBot('get_qzone_msg_list', { target_uin: Number(owner), pos: 0, num: num ?? 3 });
      audit({ tool: 'see_posts', target_uin: owner, ok: body?.status === 'ok' });
      if (body?.status !== 'ok') {
        const hint = target_uin
          ? ''
          : '（没传 target_uin 时默认按「你自己的说说」去读；如果这条是别人的，请补上 target_uin=说说主人的 QQ 号）';
        return text({ failed: true, retcode: body?.retcode, wording: body?.wording, hint }, true);
      }
      return text(summarizePosts(body));
    } catch (error) {
      return text(`读取失败：${error?.message ?? error}`, true);
    }
  }
);

server.tool(
  'qzone_comments',
  '读取某条说说下面的评论（只读）。用户问「有人评论我吗」「这条下面说了什么」时用；看自己的说说要先 qzone_see_posts 拿自己最新说说的 tid。能翻页（pos/num），返回每条评论的作者/时间/内容，以及楼中楼回复。',
  {
    tid: z.string().describe('说说 tid（qzone_see_posts 返回的）'),
    target_uin: z.string().optional().describe('说说主人的 QQ 号（看别人的说说必填，否则桥接返回 -8「原文已被删除」）'),
    pos: z.number().int().min(0).optional().describe('评论起始偏移，默认 0'),
    num: z.number().int().min(1).max(50).optional().describe('取多少条，默认 20')
  },
  async ({ tid, target_uin, pos, num }) => {
    try {
      const params = { tid, pos: pos ?? 0, num: num ?? 20 };
      const owner = target_uin || selfUin;
      if (owner) params.target_uin = Number(owner);
      if (!owner) {
        return text('需要 target_uin：说说主人的 QQ 号。看自己的说说可以不传（但本服务还没拿到你的号）。', true);
      }
      const body = await callOneBot('get_qzone_msg_detail', params);
      audit({ tool: 'comments', tid, ok: body?.status === 'ok' });
      if (body?.status !== 'ok') return text({ failed: true, retcode: body?.retcode, wording: body?.wording }, true);
      const out = summarizeComments(body, tid);
      if (out.comments.length >= (num ?? 20)) out.note = '可能还有更多评论，可加大 pos 继续翻';
      return text(out);
    } catch (error) {
      return text(`读取评论失败：${error?.message ?? error}`, true);
    }
  }
);

server.tool(
  'qzone_like',
  '给某条说说点赞。用户说「给这条点个赞」时用。需要 target_uin + tid（先 qzone_see_posts 拿）。同一条 24h 内只能赞一次，有频率上限。',
  { target_uin: z.string(), tid: z.string().describe('说说 tid') },
  async ({ target_uin, tid }) => {
    const deny = await ensureAllowed(target_uin);
    if (deny) return text(deny, true);
    const blocked = guard('like', tid);
    if (blocked) return text(blocked, true);
    try {
      const body = await callOneBot('like_qzone', { tid, target_uin: Number(target_uin) });
      audit({ tool: 'like', target_uin, tid, ok: body?.status === 'ok', retcode: body?.retcode });
      if (body?.status !== 'ok') return text({ failed: true, retcode: body?.retcode, wording: body?.wording }, true);
      record('like', tid);
      return text({ ok: true, action: 'like', tid });
    } catch (error) {
      return text(`点赞失败：${error?.message ?? error}`, true);
    }
  }
);

server.tool(
  'qzone_comment',
  '评论某条说说，或回复某条评论（楼中楼）。用户说「回他一句」「评论一下」时用。需要 target_uin + tid + content。要回复评论时，额外传 comment_id + comment_uin（从 qzone_comments 拿）。≤120 字，禁止 CQ 码。同一条 24h 内只能评一次，每小时最多 3 条、每天最多 10 条。',
  {
    target_uin: z.string().optional().describe('说说归属的 QQ 号；评论自己的说说可以不传'),
    tid: z.string().describe('说说 tid'),
    content: z.string().describe('评论正文，纯文本'),
    comment_id: z.string().optional().describe('要回复的一级评论 id（qzone_comments 返回的 commentId）'),
    comment_uin: z.string().optional().describe('被回复评论的作者 QQ 号'),
    reply_uin: z.string().optional().describe('楼中楼里要回复的那个人的 QQ 号（可选）'),
    reply_name: z.string().optional().describe('楼中楼里要回复的那个人的昵称（可选）')
  },
  async ({ target_uin, tid, content, comment_id, comment_uin, reply_uin, reply_name }) => {
    const ownUin = !target_uin;
    const deny = ownUin ? null : await ensureAllowed(target_uin);
    if (deny) return text(deny, true);
    const body = String(content ?? '').trim();
    const invalid = validateText(body, cfg.maxCommentChars);
    if (invalid) return text(invalid, true);
    const blocked = guard('comment', `${tid}:${comment_uin || ''}`);
    if (blocked) return text(blocked, true);
    try {
      const payload = { tid, content: body };
      if (target_uin) payload.target_uin = Number(target_uin);
      if (comment_id) payload.comment_id = String(comment_id);
      if (comment_uin) payload.comment_uin = String(comment_uin);
      if (reply_uin) payload.reply_uin = String(reply_uin);
      if (reply_name) payload.reply_name = String(reply_name);
      const res = await callOneBot('comment_qzone', payload);
      audit({ tool: 'comment', target_uin, tid, chars: [...body].length, ok: res?.status === 'ok', retcode: res?.retcode });
      if (res?.status !== 'ok') return text({ failed: true, retcode: res?.retcode, wording: res?.wording }, true);
      record('comment', String(tid));
      const newId = String(res?.data?.comment_id || res?.data?.commentid || '');
      if (target_uin) noteMyComment(target_uin, tid, newId);
      markReplied(tid, comment_uin, newId);
      return text({ ok: true, action: 'comment', tid, content: body });
    } catch (error) {
      return text(`评论失败：${error?.message ?? error}`, true);
    }
  }
);

function readFriends() {
  if (!bridgeState) return {};
  return readJson(bridgeState.friends, {});
}
function writeFriends(obj) {
  if (!bridgeState) return;
  writeJson(bridgeState.friends, obj);
}

server.tool(
  'friend_list',
  '查看好友名册（谁写过定义、谁还没写）。用户问「你认识谁」「都有哪些朋友」时用；也是 qzone_see_posts 的上一步——先拿到号，再去看说说。返回每个好友的 uin / 名字 / 关系 / 语气 / 备注。',
  {},
  async () => {
    const friends = readFriends();
    const rows = [];
    for (const uin of cfg.allowUins) {
      const f = friends[uin];
      rows.push(f
        ? { uin, name: f.name || '', relation: f.relation || '', tone: f.tone || '', notes: f.notes || [], written: true }
        : { uin, written: false });
    }
    return text({ ok: true, total: rows.length, friends: rows });
  }
);

server.tool(
  'friend_note',
  '给一个好友写下你的定义（名字/关系/该怎么跟他说话/备注）。用户说「记住这个人」「他是谁」「该怎么跟他说话」时用。传了哪项就更新哪项，notes 会追加。',
  {
    uin: z.string().describe('好友 QQ 号'),
    name: z.string().optional().describe('你对他/她的称呼'),
    relation: z.string().optional().describe('他/她跟你是什么关系'),
    tone: z.string().optional().describe('该怎么跟他说话（语气/分寸）'),
    note: z.string().optional().describe('一条备注（追加）')
  },
  async ({ uin, name, relation, tone, note }) => {
    const key = String(uin || '');
    if (!/^\d{5,12}$/.test(key)) return text('拒绝：uin 不是合法 QQ 号', true);
    if (!cfg.allowUins.has(key)) return text(`拒绝：${key} 不在好友白名单内`, true);
    if (!bridgeState) return text('拒绝：未配置 QZONE_BRIDGE_STATE_DIR，好友名册不可用', true);
    const friends = readFriends();
    const cur = friends[key] || { notes: [] };
    if (name) cur.name = String(name).slice(0, 30);
    if (relation) cur.relation = String(relation).slice(0, 80);
    if (tone) cur.tone = String(tone).slice(0, 80);
    if (note) { cur.notes = Array.isArray(cur.notes) ? cur.notes : []; cur.notes = [...cur.notes, String(note).slice(0, 80)].slice(-8); }
    cur.updatedAt = Date.now();
    friends[key] = cur;
    writeFriends(friends);
    return text({ ok: true, uin: key, saved: cur });
  }
);

server.tool(
  'qzone_publish',
  cfg.publishEnabled
    ? '发表一条说说（文字 ≤300 字，可选图片 URL 列表）。用户说「发条说说」「发个动态」时用。每天最多 1 条。'
    : '【当前禁用】发表说说需要管理员在配置文件里设置 publishEnabled: true 并重启本服务。',
  { content: z.string(), images: z.array(z.string()).max(9).optional() },
  async ({ content, images }) => {
    if (!cfg.publishEnabled) return text('拒绝：发说说功能未启用。开启方法：在配置文件（qzone-mcp.json）里设置 "publishEnabled": true 后重启本服务；或设环境变量 QZONE_PUBLISH_ENABLED=true。', true);
    const body = String(content ?? '').trim();
    const invalid = validateText(body, cfg.maxPublishChars);
    if (invalid) return text(invalid, true);
    const blocked = guard('publish');
    if (blocked) return text(blocked, true);
    try {
      const params = { content: body };
      if (Array.isArray(images) && images.length) params.images = images;
      const res = await callOneBot('send_qzone_msg', params);
      audit({ tool: 'publish', chars: [...body].length, ok: res?.status === 'ok', retcode: res?.retcode });
      if (res?.status !== 'ok') return text({ failed: true, retcode: res?.retcode, wording: res?.wording }, true);
      record('publish');
      // 宿主（如 qq-bridge）靠这个文件判断「今天发过没有」，别漏写
      if (bridgeState) {
        writeJson(bridgeState.lastPublish, { tid: String(res?.data?.tid || res?.data?.msgid || ''), at: Date.now() });
      }
      // 发完说说顺便逛逛朋友空间（只读；要不要互动由她自己决定）
      const digest = cfg.patrol?.onPublish ? await runPatrol().catch(() => '') : '';
      const payload = { ok: true, action: 'publish', content: body };
      const base = JSON.stringify(payload, null, 2);
      return { content: [{ type: 'text', text: digest ? `${base}\n${digest}` : base }] };
    } catch (error) {
      return text(`发表失败：${error?.message ?? error}`, true);
    }
  }
);

await seedGroupUins();

// 自己是谁：配置没给就问 OneBot；拿不到不影响其它工具
if (!selfUin) {
  try {
    const body = await callOneBot('get_login_info');
    const uid = String(body?.data?.user_id ?? body?.user_id ?? '');
    if (/^\d{5,12}$/.test(uid)) {
      selfUin = uid;
      console.error(`[qzone-safe] 自己的号（自动识别）= ${selfUin}`);
    }
  } catch { /* 忽略：只是少一个便利 */ }
}

// 自检用：QZONE_PATROL_ON_START=1 时启动即跑一轮巡视（只读），方便验证真实环境
if (String(process.env.QZONE_PATROL_ON_START || '') === '1') {
  const digest = await runPatrol().catch((e) => `patrol 失败：${e?.message ?? e}`);
  console.error(`[qzone-safe][patrol-on-start] ${digest || '(没有新动态)'}`);
}
audit({ tool: 'startup', allowUins: [...cfg.allowUins], publishEnabled: cfg.publishEnabled });
console.error(`[qzone-safe] ready — allow=${cfg.allowUins.size} uins, publish=${cfg.publishEnabled}, endpoint=${cfg.onebot.baseUrl}`);
await server.connect(new StdioServerTransport());



