# mcp-qzone-safe

> 把 **QQ 空间**接给大模型：看说说、点赞、评论（含楼中楼）、发说说——**每一件都过闸门**。
> 设计前提是「先保证不闯祸，再谈能做什么」。

[![CI](https://img.shields.io/github/actions/workflow/status/hoholi-668/mcp-qzone-safe/test.yml?branch=main&label=CI)](https://github.com/hoholi-668/mcp-qzone-safe/actions)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

QQ 空间没有给 AI 用的接口。直接把网关暴露给模型太危险：乱评论、刷屏、@ 错人、把私人说说翻出来。
这个 MCP 服务把「能做什么」和「不许做什么」写死在代码里，模型只能在前者范围内活动。

---

## 它解决什么问题

| 风险 | 这里的处理 |
|---|---|
| 模型乱评论不认识的人 | **白名单**：只能对名单里的号操作 |
| 同一条说说被反复点赞/评论 | **24 小时去重** |
| 半夜刷屏 | **限频**：评论 3/时、10/天；发说说 1/天 |
| 评论里塞 CQ 码 / 超长文本 | **字数上限 + CQ 码拒绝** |
| 把私人说说当成自己的 | **不传 `target_uin` 默认看自己**，别人必须显式指定 |
| 「发说说」误触发 | **默认关闭**，要显式打开 |

---

## 30 秒上手

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

## 七个工具

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

## 核心机制

### 1. 五道闸门

| 闸门 | 默认值 | 说明 |
|---|---|---|
| **白名单** | 空 | 只能对 `allowUins` 里的号操作；可自动并入指定群成员（`groupUinsFrom`） |
| **去重** | 24 小时 | 同一条说说只能赞一次 / 评一次 |
| **限频** | 赞 20/时、50/天；评论 3/时、10/天；发说说 1/天 | 评论比点赞严得多 |
| **长度** | 评论 120 字、说说 300 字 | 且拒绝 CQ 码 |
| **发布开关** | `false` | 不开就永远发不出去 |

**自己永远放行**：不传 `target_uin` 时按「看自己的空间」处理，不需要把自己的号塞进白名单。

### 2. 楼中楼：`comment_id` 不能传 `"0"`

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

### 3. 好友名册（她写给每个人）

`friend_note` 传哪项就更新哪项：

| 字段 | 说明 |
|---|---|
| `uin` | 好友 QQ 号（必填） |
| `name` | 称呼 |
| `relation` | 关系（同事/朋友/家人…） |
| `tone` | 该怎么跟他说话（语气、分寸） |
| `note` | 备注，追加不覆盖 |

### 4. 与宿主联动（可选）

设置 `QZONE_BRIDGE_STATE_DIR` 后同步这些文件：

| 文件 | 作用 |
|---|---|
| `qzone-watch.json` | 记录「我回过谁」，避免重复回 |
| `qzone-pending-comment.json` | 待回复队列，回完自动移除 |
| `qzone-my-comments.json` | 我发过哪些评论，用来追踪别人的回复 |
| `friends.json` | 好友名册 |

不设置就完全独立运行。

---

## 配置项

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

## 兼容范围

| 项 | 要求 | 实测 |
|---|---|---|
| 操作系统 | Linux / Windows / macOS | 代码无平台依赖；Linux 实测 |
| Node.js | `>= 20` | 20 / 22 / 24；CI 覆盖 20、22 |
| OneBot 网关 | SnowLuma / NapCat | **两家都 ✅ 实测**（各 7/7，fixture 已录） |

### 支持哪些网关

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

## 实测数据

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

## 双后端回归（SnowLuma / NapCat）

两家网关的 action 名一致，但返回字段的写法可能有细微差别。为了不让「换网关」变成运气问题，
这里把**真实响应录下来**，在 CI 里对两套 fixture 跑同一组解析断言：

`ash
# 1. 录一份（只读，不改任何数据）
node scripts/record-backend.mjs \
  --backend snowluma \
  --url http://127.0.0.1:3000 --token <token> \
  --uin <你的号> --out test/backends/snowluma.json

# 2. 跑回归（不需要网关）
node --test
`

**录制时会自动脱敏**：说说正文、QQ 号、tid、图片地址全部替换成占位值，只保留结构。
所以 fixture 可以安全地进公开仓库。

新增一个后端只需要多录一份 	est/backends/<名字>.json，测试会自动为它生成断言。

## 踩坑记录

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

## 自测与开发

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

## 许可

MIT © 2026 HOHOLI
