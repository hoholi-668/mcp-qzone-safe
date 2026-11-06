// 限流与去重：纯函数，输入旧状态、输出新状态，方便单测。
//
// 状态形状：{ "like": [ts,...], "like:<tid>": [ts,...], "comment:<tid>:<uin>": [ts,...] }
// 所有时间戳按「最近 24 小时」裁剪。

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

function keyOf(kind, dedupeKey) {
  return dedupeKey ? `${kind}:${dedupeKey}` : kind;
}

/** 清掉超过 24 小时的记录，返回新对象。 */
export function pruneState(state, now = Date.now()) {
  const out = {};
  for (const [key, list] of Object.entries(state || {})) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter((t) => Number(t) >= now - DAY);
    if (kept.length) out[key] = kept;
  }
  return out;
}

/** 统计某 kind 在最近 24 小时 / 1 小时内的总次数。 */
export function countKind(state, kind, now = Date.now()) {
  let day = 0;
  let hour = 0;
  for (const [key, list] of Object.entries(state || {})) {
    if (key !== kind && !key.startsWith(`${kind}:`)) continue;
    for (const t of list || []) {
      if (Number(t) < now - DAY) continue;
      day += 1;
      if (Number(t) >= now - HOUR) hour += 1;
    }
  }
  return { day, hour };
}

/**
 * 检查是否允许执行。
 * @returns {{allowed:boolean, reason?:string}}
 */
export function checkRate(state, kind, dedupeKey, limits, now = Date.now()) {
  const key = keyOf(kind, dedupeKey);
  const entry = Array.isArray(state?.[key]) ? state[key] : [];
  const fresh = entry.filter((t) => Number(t) >= now - DAY);

  if (dedupeKey && fresh.length > 0) {
    const verb = kind === 'like' ? '赞过' : kind === 'comment' ? '评过' : '做过';
    return { allowed: false, reason: `拒绝：这条已经${verb}了（24 小时内不重复）` };
  }

  const { day, hour } = countKind(state, kind, now);
  const limit = limits[kind] || {};
  if (limit.perHour && hour >= limit.perHour) {
    return { allowed: false, reason: `拒绝：${kind} 每小时最多 ${limit.perHour} 次` };
  }
  if (limit.perDay && day >= limit.perDay) {
    return { allowed: false, reason: `拒绝：${kind} 每天最多 ${limit.perDay} 次` };
  }
  return { allowed: true };
}

/** 记一次成功（只在真正成功后调用，失败不占额度）。返回新状态。 */
export function recordRate(state, kind, dedupeKey, now = Date.now()) {
  const key = keyOf(kind, dedupeKey);
  const next = { ...state };
  const list = Array.isArray(next[key]) ? next[key].filter((t) => Number(t) >= now - DAY) : [];
  list.push(now);
  next[key] = list;
  return next;
}
