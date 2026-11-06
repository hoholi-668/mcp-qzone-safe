// 「发完说说顺便逛逛朋友空间」的选择与去重逻辑（纯函数，可单测）。
//
// 触发点：她成功发出一条说说后（她本来就醒着），顺便看看好友有没有新动态。
// 这样不需要额外的定时器，也不产生额外唤醒。
//
// 去重：记录「已经给她看过的 tid」，下次只显示新的，避免反复推同一条。

/**
 * 轮询挑人：从上一次巡到的位置继续，避免总是看同几个人。
 * @param {string[]} uins 可巡视的号（已去重，不含自己）
 * @param {number} lastIndex 上次巡到的下标
 * @param {number} max 本次最多看几个人
 */
export function pickPatrolTargets(uins, lastIndex, max = 3) {
  const list = Array.isArray(uins) ? uins.filter(Boolean) : [];
  if (!list.length) return { targets: [], nextIndex: 0 };
  const start = Number.isFinite(lastIndex) ? Math.max(0, Math.round(lastIndex)) : 0;
  const n = Math.max(1, Math.min(list.length, Math.round(max) || 3));
  const targets = [];
  for (let i = 0; i < n; i += 1) targets.push(list[(start + i) % list.length]);
  return { targets, nextIndex: (start + n) % list.length };
}

/**
 * 从某人最近几条说说里挑出「没看过的」。
 * @param {Array<{tid:string}>} posts
 * @param {string[]} seenTids
 */
export function pickNewPosts(posts, seenTids, max = 2) {
  const seen = new Set((Array.isArray(seenTids) ? seenTids : []).map(String));
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    const tid = String(p?.tid || '');
    if (!tid || seen.has(tid)) continue;
    out.push({ tid, content: String(p?.content || '').replace(/\s+/g, ' ').slice(0, 120), time: p?.time ?? null });
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}

/** 把本轮看到的 tid 追加进已见列表，保留最近 500 条。 */
export function mergeSeen(seenTids, newTids) {
  const merged = [...new Set([...(Array.isArray(seenTids) ? seenTids : []).map(String), ...(Array.isArray(newTids) ? newTids : []).map(String)])];
  return merged.slice(-500);
}

/**
 * 生成给模型看的巡视摘要。
 * @param {Array<{uin:string,name:string,posts:Array<{tid:string,content:string}>}>} results
 */
export function formatPatrolDigest(results) {
  const lines = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r?.posts?.length) continue;
    lines.push(`${r.name || r.uin} 有新说说：`);
    for (const p of r.posts) lines.push(`  · ${p.content}（tid ${p.tid}，可点赞/评论）`);
  }
  return lines.length ? ['', '【朋友的新动态】（刚发的，可以顺手点赞或评论，也可以只看）', ...lines].join('\n') : '';
}
