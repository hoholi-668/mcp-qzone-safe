// 配置解析：全部可移植，不绑定任何目录结构。
//
// 优先级：环境变量 > 配置文件 > 默认值。
// 配置文件默认在 ~/.config/qzone-safe/config.json，可用 QZONE_CONFIG 覆盖。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function defaultConfigPath(env = process.env) {
  if (env.QZONE_CONFIG) return env.QZONE_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'qzone-safe', 'config.json');
}

export function defaultStateDir(env = process.env) {
  if (env.QZONE_STATE_DIR) return env.QZONE_STATE_DIR;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'qzone-safe');
}

/**
 * 解析最终配置。
 * @param {Record<string,string|undefined>} env
 * @param {object} fileCfg 配置文件内容
 */
export function resolveConfig(env = process.env, fileCfg = {}) {
  const stateDir = defaultStateDir(env);
  const limits = {
    like: { perHour: 20, perDay: 50, ...(fileCfg.limits?.like ?? {}) },
    comment: { perHour: 3, perDay: 10, ...(fileCfg.limits?.comment ?? {}) },
    publish: { perHour: 1, perDay: 1, ...(fileCfg.limits?.publish ?? {}) }
  };
  const allowUins = new Set(
    (Array.isArray(fileCfg.allowUins) ? fileCfg.allowUins : [])
      .map((u) => String(u).trim())
      .filter((u) => /^\d{5,12}$/.test(u))
  );
  return {
    onebot: {
      baseUrl: String(env.QZONE_ONEBOT_URL || fileCfg.onebot?.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
      token: String(env.QZONE_ONEBOT_TOKEN || fileCfg.onebot?.token || '')
    },
    allowUins,
    // 她自己：永远允许操作（读+写自己的空间），不必进 allowUins
    selfUin: String(env.QZONE_SELF_UIN || fileCfg.selfUin || fileCfg.patrol?.selfUin || ''),
    groupUinsFrom: (Array.isArray(fileCfg.groupUinsFrom) ? fileCfg.groupUinsFrom : []).map(String),
    limits,
    maxCommentChars: Number(fileCfg.maxCommentChars ?? 120),
    maxPublishChars: Number(fileCfg.maxPublishChars ?? 300),
    publishEnabled: fileCfg.publishEnabled === true
      || String(env.QZONE_PUBLISH_ENABLED || '').toLowerCase() === 'true',
    stateDir,
    auditPath: path.join(stateDir, 'audit.jsonl'),
    ratePath: path.join(stateDir, 'rate.json'),
    // 可选：外部系统的状态目录（例如 qq-bridge 的 state/）。不配则相关同步全部跳过。
    bridgeStateDir: env.QZONE_BRIDGE_STATE_DIR || fileCfg.bridgeStateDir || '',
    // 「发完说说顺便逛逛朋友空间」：默认开启，搭在已有的回合里，不产生额外唤醒。
    patrol: {
      enabled: fileCfg.patrol?.enabled !== false,
      onPublish: fileCfg.patrol?.onPublish !== false,
      maxFriends: Math.max(1, Number(fileCfg.patrol?.maxFriends ?? 3)),
      perFriend: Math.max(1, Number(fileCfg.patrol?.perFriend ?? 2)),
      selfUin: String(env.QZONE_SELF_UIN || fileCfg.selfUin || ''),
      excludeUins: (Array.isArray(fileCfg.patrol?.excludeUins) ? fileCfg.patrol.excludeUins : []).map(String)
    }
  };
}

export function loadConfig(env = process.env) {
  const fileCfg = readJson(defaultConfigPath(env), {});
  return resolveConfig(env, fileCfg);
}

