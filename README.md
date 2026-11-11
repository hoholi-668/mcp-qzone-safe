# mcp-qzone-safe
[![npm](https://img.shields.io/npm/v/mcp-qzone-safe.svg)](https://www.npmjs.com/package/mcp-qzone-safe)

<p>
  <a href="https://github.com/hoholi-668/mcp-qzone-safe/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/hoholi-668/mcp-qzone-safe/test.yml?branch=main&label=CI&style=flat-square"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-4b6fff?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square">
</p>

**English** · [中文文档](#中文文档)

> **A safety-gated MCP server for QQ Zone (QQ空间).** Read posts, like, comment (including nested
> replies), and publish — every action goes through permission, rate-limit, dedupe and audit gates.
>
> ⚠️ **Maintenance status:** the gateway ecosystem is shrinking — SnowLuma's repo went private and
> NapCat announced its end (last release 2026-10-30). **Existing deployments keep working**; check
> that you own a OneBot gateway implementing the QZone actions before a new deployment.

**Use this if you** want an AI to interact with QQ Zone without letting it spam, mis-@ people, or
read private posts — or if you are building an agent that needs a **default-deny** action whitelist.

**Works with:** any MCP client (DSH, Claude Desktop, Cursor, Cline) **plus** an OneBot v11 gateway
that implements these actions (`get_qzone_msg_list`, `get_qzone_msg_detail`, `like_qzone`,
`comment_qzone`, `send_qzone_msg`, …).

## Tools

| Tool | What it does |
|---|---|
| `qzone_see_posts` | List recent posts (self or allowlisted users) |
| `qzone_comments` | Read comments and nested replies |
| `qzone_like` | Like a post (deduped, rate-limited) |
| `qzone_comment` | Comment or reply (CQ-code rejected, length-checked) |
| `qzone_publish` | Publish a post (**disabled by default**) |
| `friend_list` / `friend_note` | Local allowlist management with notes |

## Configuration

| Env var | Meaning |
|---|---|
| `QZONE_ONEBOT_URL` | Gateway HTTP endpoint (e.g. `http://127.0.0.1:3000`) |
| `QZONE_ONEBOT_TOKEN` | Gateway access token |
| `QZONE_CONFIG` | Path to `qzone-mcp.json` (allowlist, publish toggle, limits) |
| `QZONE_STATE_DIR` | Where dedupe/rate-limit state is stored |

## Verified

- 20 unit tests, including **two recorded gateway fixtures** (SnowLuma 2.2.0-node and NapCat) — CI
  replays both, so a parser regression on either backend fails the build.
- Live protocol self-test: **7/7** against both backends, with **zero code changes** when switching.

## Known limits

- QZone actions are **not** part of OneBot v11 — a plain gateway won't work without them.
- Publishing is off by default on purpose; enable it explicitly.

## FAQ

**Which gateway do I need?**
One that implements the QZone actions (`get_qzone_msg_list`, `like_qzone`, …). The SnowLuma / NapCat lineage does; both are unmaintained now, so existing deployments are the realistic audience.

**Will it spam or comment on the wrong post?**
Every write goes through five gates: allowlist, rate limit, dedupe, text validation (rejects CQ codes / over-length), and audit.

**Why is publishing disabled by default?**
Publishing is the highest-impact action. Enabling it is an explicit decision, not a default.

**Nested replies?**
Pass the first-level comment id as `comment_id`; a literal `"0"` fails with `-10049`.

**Do I have to change code to switch backends?**
No. Point `QZONE_ONEBOT_URL` / token at the other gateway; both recorded fixtures are replayed in CI.

## License

MIT

---

# 中文文档

> ⚠️ **维护状态：功能可用，但依赖的网关生态正在萎缩。**
> SnowLuma 仓库已私有化、NapCat 已宣布终止（2026-10-30 最后一个 release）。
> **存量环境可以继续用**；新部署前请先确认你有一个实现了 QQ 空间 action 的 OneBot 网关。

### 这套插件

| 插件 | 作用 | 依赖 |
|---|---|---|
| [mcp-video-learn](https://github.com/hoholi-668/mcp-video-learn) | 视频 / 动图 → 九宫格 + 字幕 | ffmpeg |
| [mcp-roster](https://github.com/hoholi-668/mcp-roster) | 人物名册与权限（默认拒绝） | 无 |
| [conversation-pacing](https://github.com/hoholi-668/conversation-pacing) | 群聊发言节奏：什么时候说、说给谁 | 无 |
| [dsh-qq-persona](https://github.com/hoholi-668/dsh-qq-persona) | 「不像客服」的人格模板 | 无 |
| [mcp-qzone-safe](https://github.com/hoholi-668/mcp-qzone-safe) | QQ 空间操作（**需要 OneBot 网关，存量环境**） | OneBot 网关 |

> 除 qzone 外，其余插件都不依赖任何 IM 网关——任何 MCP 客户端（DSH / Claude / Cursor）都能直接接。

### 它解决什么问题

| 风险 | 这里的处理 |
|---|---|
| 模型乱评论不认识的人 | **白名单**：只能对名单里的号操作 |
| 同一条说说被反复点赞/评论 | **24 小时去重** |
| 半夜刷屏 | **限频**：评论 3/时、10/天；发说说 1/天 |
| 评论里塞 CQ 码 / 超长文本 | **字数上限 + CQ 码拒绝** |
| 把私人说说当成自己的 | **不传 `target_uin` 默认看自己**，别人必须显式指定 |
| 「发说说」误触发 | **默认关闭**，要显式打开 |

---

### 30 秒上手

```bash
# 本项目未发布 npm
git clone https://github.com/hoholi-668/mcp-qzone-safe.git
cd mcp-qzone-safe
npm install
node src/index.js          # 出现 ready 就说明能启动
```

前置条件：一个实现了 QQ 空间扩展 action 的 OneBot 网关——**SnowLuma** 或 **NapCat**（见下方「兼容范围」）。

配置（默认 `~/.config/qzone-safe/config.json`，可用 `QZONE_CONFIG` 覆盖）：

```json
{
  "onebot": { "baseUrl": "http://127.0.0.1:3000", "token": "your-access-token" },
  "allowUins": ["123456789"],
  "groupUinsFrom": ["987654321"],
  "limits": {
    "like":    { "perHour": 20, "perDay": 50 },
    "comment": { "perHour": 3,  "perDay": 10 },
    "publish": { "perHour": 1,  "perDay": 1 }
  },
  "maxCommentChars": 120,
  "maxPublishChars": 300,
  "publishEnabled": false
}
```

接进 MCP 客户端（以 DSH 为例）：

```yaml
- id: mcp-qzone-safe
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: qzone-safe
    transport: stdio
    command: node
    args: ['/绝对路径/mcp-qzone-safe/src/index.js']
    env:
      QZONE_ONEBOT_URL: http://127.0.0.1:3000
      QZONE_ONEBOT_TOKEN: ${SNOWLUMA_TOKEN}
      QZONE_CONFIG: /path/to/qzone-mcp.json
```

**装好之后不用记工具名**：

```
你认识哪些人？都叫什么
朋友们最近都发什么了
我空间有人评论我吗
给主人最新那条说说点个赞
```

---

### 七个工具

| 工具 | 作用 | 写操作 |
|---|---|---|
| `qzone_see_posts` | 看某个号的最新说说；**不传 `target_uin` = 看自己** | ❌ |
| `qzone_comments` | 读某条说说的评论（含楼中楼） | ❌ |
| `qzone_like` | 点赞 | ✅ 限频 + 去重 |
| `qzone_comment` | 评论 / 回复某条评论 | ✅ 限频 + 去重 + 字数 |
| `qzone_publish` | 发说说 | ✅ **默认关闭** |
| `friend_list` | 好友名册（谁写过定义、谁没写） | 本地文件 |
| `friend_note` | 给好友写定义（名字/关系/语气/备注） | 本地文件 |

---

### 核心机制

#### 1. 五道闸门

| 闸门 | 默认值 | 说明 |
|---|---|---|
| **白名单** | 空 | 只能对 `allowUins` 里的号操作；可自动并入指定群成员（`groupUinsFrom`） |
| **去重** | 24 小时 | 同一条说说只能赞一次 / 评一次 |
| **限频** | 赞 20/时、50/天；评论 3/时、10/天；发说说 1/天 | 评论比点赞严得多 |
| **长度** | 评论 120 字、说说 300 字 | 且拒绝 CQ 码 |
| **发布开关** | `false` | 不开就永远发不出去 |

**自己永远放行**：不传 `target_uin` 时按「看自己的空间」处理，不需要把自己的号塞进白名单。

#### 2. 楼中楼：`comment_id` 不能传 `"0"`

QQ 空间的回复是**二级评论**，`get_qzone_msg_detail` 只把一级评论列在 `comments` 里，回复藏在每条的 `replies` 下
——只看 `comment_num` 会以为「没回」。

```json
{
  "target_uin": "说说主人的号",
  "tid": "说说 id",
  "content": "回复内容",
  "comment_id": "1",
  "comment_uin": "被回复评论的作者"
}
```

| 参数 | 说明 |
|---|---|
| `comment_id` | 要回复的那条评论 id（从 `qzone_comments` 拿） |
| `comment_uin` | 那条评论的作者 QQ 号 |
| `reply_name` / `reply_uin` | 可选，部分网关需要，正常留空 |

`comment_id` 传错是最常见的失败原因（`-10049`）。

#### 3. 好友名册（她写给每个人）

`friend_note` 传哪项就更新哪项：

| 字段 | 说明 |
|---|---|
| `uin` | 好友 QQ 号（必填） |
| `name` | 称呼 |
| `relation` | 关系（同事/朋友/家人…） |
| `tone` | 该怎么跟他说话（语气、分寸） |
| `note` | 备注，追加不覆盖 |

#### 4. 与宿主联动（可选）

设置 `QZONE_BRIDGE_STATE_DIR` 后同步这些文件：

| 文件 | 作用 |
|---|---|
| `qzone-watch.json` | 记录「我回过谁」，避免重复回 |
| `qzone-pending-comment.json` | 待回复队列，回完自动移除 |
| `qzone-my-comments.json` | 我发过哪些评论，用来追踪别人的回复 |
| `friends.json` | 好友名册 |

不设置就完全独立运行。

---

### 配置项

| 变量 | 说明 |
|---|---|
| `QZONE_ONEBOT_URL` | OneBot 地址，默认 `http://127.0.0.1:3000` |
| `QZONE_ONEBOT_TOKEN` | 访问令牌 |
| `QZONE_CONFIG` | 配置文件路径 |
| `QZONE_STATE_DIR` | 状态目录（审计/限频） |
| `QZONE_PUBLISH_ENABLED` | `true` 时打开「发说说」 |
| `QZONE_BRIDGE_STATE_DIR` | 可选：与宿主共用状态目录 |
| `QZONE_SELF_UIN` | 你自己的 QQ 号；不设则在启动时用 `get_login_info` 自动识别 |
| `QZONE_PATROL_ON_START` | 设 `1` 时启动即跑一轮只读巡视，便于验证真实环境 |

---

### 兼容范围

| 项 | 要求 | 实测 |
|---|---|---|
| 操作系统 | Linux / Windows / macOS | 代码无平台依赖；Linux 实测 |
| Node.js | `>= 20` | 20 / 22 / 24；CI 覆盖 20、22 |
| OneBot 网关 | SnowLuma / NapCat | **两家都 ✅ 实测**（各 7/7），但**均已停更**——存量可用，新部署需自备网关 |

#### 支持哪些网关

QQ 空间的接口**不在 OneBot v11 标准里**。本插件用到 7 个 action：

| action | 标准？ |
|---|---|
| `get_login_info` / `get_group_member_list` | ✅ 标准 |
| `get_qzone_msg_list` / `get_qzone_msg_detail` | ❌ 非标准 |
| `like_qzone` / `comment_qzone` / `send_qzone_msg` | ❌ 非标准 |

| 网关 | 能用吗 | 说明 |
|---|---|---|
| **SnowLuma** | ✅ 实测 | 本插件最初适配的网关 |
| **NapCat** | ✅ 实测（2026-11-10） | 同名 action，**零代码改动**直接 7/7 |
| Lagrange / go-cqhttp | ❌ 不行 | 没有 QQ 空间 action |
| 其它 SnowLuma 分支 | 🟡 看是否保留同名 action |  |

**AI 客户端**：DSH 实测；其它 MCP 客户端推断可用（只返回文本）。

---

### 实测数据

| 层 | 命令 | 覆盖 | 结果 |
|---|---|---|---|
| 单元 | `npm test` | 限频/去重/文本校验/说说解析 + **双后端 fixture 回归** | **20/20** |
| MCP 协议（真实 OneBot） | `npm run selftest:mcp` | 列工具、读说说、读评论、白名单拦截、publish 关闭、好友名册 | **7/7** |

协议层测试**只调用读接口**，不会在真实账号上点赞/评论/发说说。

**写操作在真实账号上单独验证过**：

| 动作 | 结果 | 怎么验证 |
|---|---|---|
| 评论 | ✅ | 拉说说详情，评论区能看到那段话 |
| 点赞 | ✅ | `status=ok`；重复点赞被 24h 去重挡住 |
| 发说说 | ✅ | 发布后 `qzone-last-publish.json` 更新，空间可见 |

---

### 双后端回归（SnowLuma / NapCat）

两家网关的 action 名一致，但返回字段的写法可能有细微差别。为了不让「换网关」变成运气问题，
这里把**真实响应录下来**，在 CI 里对两套 fixture 跑同一组解析断言：

```bash
# 1. 录一份（只读，不改任何数据）
node scripts/record-backend.mjs \
  --backend snowluma \
  --url http://127.0.0.1:3000 --token <token> \
  --uin <你的号> --out test/backends/snowluma.json

# 2. 跑回归（不需要网关）
node --test
```

**录制时会自动脱敏**：说说正文、QQ 号、tid、图片地址全部替换成占位值，只保留结构。
所以 fixture 可以安全地进公开仓库。

新增一个后端只需要多录一份 `test/backends/<名字>.json`，测试会自动为它生成断言
（fixture 里的 `backendInfo` 会记录实测的网关名称与版本）。

**实测版本**：SnowLuma `2.2.0-node`（Protocol v11）、NapCat（镜像 `base`，构建于 2026-10-30）。

**实测结论（2026-11-10）**：SnowLuma 与 NapCat 的响应字段**前者是后者的子集**——
NapCat 只多了 OneBot 标准外层的 `echo` / `message` / `stream` / `wording`，以及 `data.total_known`；
我们解析用的字段（`msglist` / `comments` / `comment_id` / `tid`）两边完全一致。
所以插件指向 NapCat **不需要改任何代码**，只改 `QZONE_ONEBOT_URL` 和 token。

### 踩坑记录

| 现象 | 根因 | 修法 |
|---|---|---|
| `-10049 该条内容已被删除` | 楼中楼 `comment_id` 传了 `"0"` | 传一级评论真实 id（通常 `"1"`） |
| 以为没人回复 | `comment_num` 只统计一级评论 | 回复在 `replies` 里，要遍历 |
| 看别人说说报 `-8 原文已被删除` | `target_uin` 是**说说主人**，不是评论者 | 显式传说说主人的号 |
| 看不了自己的空间 | 白名单语义被误用（自己不在名单里） | 自己永远放行 + `selfUin` 自动识别 |
| 「我空间有人评论吗」不调工具 | `target_uin` 必填，模型不知道自己的号 | 改成可选，不传默认看自己 |
| 同一条可以重复点赞 | 点赞成功后没写限频记录 | 补写限频 + 去重 key 修正 |
| 把群友当好友 | 群成员 ≠ 好友 | 白名单可配置 `groupUinsFrom` 自动并入 |

---

### 自测与开发

```bash
node --test                                     # 单测 12 项
QZONE_ONEBOT_URL=... QZONE_ONEBOT_TOKEN=... \
QZONE_TEST_UIN=你的号 node scripts/selftest-mcp.mjs   # 协议层 7 项（只读）
```

```
src/config.js   配置解析（环境变量 > 文件 > 默认）
src/guard.js    限流 / 去重（纯函数，有单测）
src/format.js   说说/评论整理 + 文本校验（纯函数，有单测）
src/index.js    MCP 服务与工具
test/           node:test
```

遇到问题先看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)：报错码、限频、白名单、风控都在里面。

---

### 许可

MIT © 2026 HOHOLI

---

### FAQ

**需要什么网关？**
实现了空间 action 的 OneBot（`get_qzone_msg_list`、`like_qzone` 等）。SnowLuma / NapCat 系有，但**都已停更**——现实用户是存量部署。

**会不会乱评论、评错人？**
每个写操作过五道闸门：白名单、限频、去重、文本校验（拒 CQ 码/超长）、审计。

**为什么发说说默认关闭？**
影响最大的动作，必须显式开启，不做默认。

**楼中楼怎么回？**
`comment_id` 传一级评论 id；传 `"0"` 会报 `-10049`。

**换后端要改代码吗？**
不用。改 `QZONE_ONEBOT_URL` 和 token 即可；两套 fixture 都在 CI 里回放。

## 检索关键词（给搜索引擎）

QQ空间 MCP · OneBot v11 · QZone API · 说说/评论/点赞 · 默认拒绝 · SnowLuma · NapCat
