# mcp-qzone-safe

把 **QQ 空间**接给大模型的 MCP 服务：看说说、点赞、评论（含楼中楼回复）、发说说——**每一件都过闸门**。

> 为什么需要它：QQ 空间没有给 AI 用的接口。直接暴露太危险（乱评论、刷屏、@错人）。
> 这个 MCP 的设计前提是：**先保证不闯祸，再谈能做什么。**

## 工具

| 工具 | 作用 | 写操作 |
|---|---|---|
| `qzone_see_posts` | 看某个 QQ 号的最新说说 | ❌ |
| `qzone_comments` | 读某条说说的评论（含楼中楼） | ❌ |
| `qzone_like` | 点赞 | ✅ 限频 + 去重 |
| `qzone_comment` | 评论 / 回复某条评论 | ✅ 限频 + 去重 + 字数 |
| `qzone_publish` | 发说说 | ✅ **默认关闭** |
| `friend_list` / `friend_note` | 好友名册（她给每个人写的定义） | ✅ 本地文件 |

## 五道闸门

| 闸门 | 默认值 | 说明 |
|---|---|---|
| **白名单** | 空 | 只能对 `allowUins` 里的号操作；可自动并入指定群的成员 |
| **去重** | 24 小时 | 同一条说说只能赞一次 / 评一次 |
| **限频** | 赞 20/时、50/天；评论 3/时、10/天；发说说 1/天 | 评论比点赞严得多 |
| **长度** | 评论 120 字、说说 300 字 | 且拒绝 CQ 码 |
| **审计** | 全量 | 每次调用写 `<stateDir>/audit.jsonl` |

**发说说默认关闭**，必须显式 `publishEnabled: true` 才能用。

## 安装

```bash
npm install -g mcp-qzone-safe
```

需要有一个兼容 OneBot v11 的网关（例如 SnowLuma）在跑。

## 配置

配置文件默认 `~/.config/qzone-safe/config.json`（可用 `QZONE_CONFIG` 覆盖）：

```json
{
  "onebot": {
    "baseUrl": "http://127.0.0.1:3000",
    "token": "your-access-token"
  },
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

也可以用环境变量覆盖：

| 变量 | 说明 |
|---|---|
| `QZONE_ONEBOT_URL` | OneBot 地址，默认 `http://127.0.0.1:3000` |
| `QZONE_ONEBOT_TOKEN` | 访问令牌 |
| `QZONE_CONFIG` | 配置文件路径 |
| `QZONE_STATE_DIR` | 状态目录（审计/限频），默认 `~/.local/share/qzone-safe` |
| `QZONE_PUBLISH_ENABLED` | `true` 时打开发说说 |
| `QZONE_BRIDGE_STATE_DIR` | 可选：与宿主（如 qq-bridge）共用状态目录 |

## 接到 MCP 客户端

以 DSH 为例：

```yaml
- id: mcp-qzone-safe
  name: '@deepseek-ai/dsh-mcp'
  config:
    command: npx
    args: ['-y', 'mcp-qzone-safe']
    env:
      QZONE_ONEBOT_URL: http://127.0.0.1:3000
      QZONE_ONEBOT_TOKEN: ${SNOWLUMA_TOKEN}
```

## 关于楼中楼回复

QQ 空间的回复是**二级评论**，`get_qzone_msg_detail` 只把一级评论列在 `comments` 里，
回复藏在每条的 `replies` 下——**只看 `comment_num` 会以为“没回”**。

调用时要传：

```json
{
  "tid": "说说 id",
  "content": "回复内容",
  "comment_id": "1",      // 一级评论的 commentId（不是 "0"）
  "comment_uin": "123456" // 被回复评论的作者
}
```

`comment_id` 传错是最常见的失败原因（`-10049`）。

## 与宿主的联动（可选）

设置了 `QZONE_BRIDGE_STATE_DIR` 后，会同步这几个文件：

| 文件 | 作用 |
|---|---|
| `qzone-watch.json` | 记录“我回过谁”，避免重复回 |
| `qzone-pending-comment.json` | 待回复队列，回完自动移除 |
| `qzone-my-comments.json` | 我发过哪些评论，用来追踪别人的回复 |
| `friends.json` | 好友名册 |

不设置就完全独立运行，只是没有这些联动。

## 开发

```
src/config.js   配置解析（环境变量 > 文件 > 默认）
src/guard.js    限流/去重（纯函数，有单测）
src/format.js   说说/评论整理 + 文本校验（纯函数，有单测）
src/index.js    MCP 服务与工具
test/           node:test
```

```bash
npm test
```

## 许可

MIT © 2026 HOHOLI
## 遇到问题

先看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)：报错码、限频、白名单、风控都在里面。

## 验证过的场景（真跑）

| 层 | 命令 | 覆盖 | 结果 |
|---|---|---|---|
| 单元 | `npm test` | 限频/去重/文本校验/说说解析 | **8/8** |
| MCP 协议（真实 OneBot） | `QZONE_ONEBOT_URL=... QZONE_ONEBOT_TOKEN=... QZONE_TEST_UIN=<号> npm run selftest:mcp` | 列工具、读说说、读评论、白名单拦截、publish 关闭、好友名册 | **7/7** |

协议层测试**只调用读接口**（`qzone_see_posts` / `qzone_comments` / `friend_list`），
不会点赞、不会评论、不会发说说——避免在真实账号上留下痕迹。

**写操作的闸门由单元测试覆盖**：24 小时去重、每小时/每天上限、长度限制、CQ 码拒绝、
白名单校验。真实写操作请先用 `publishEnabled: false` + 小号自测。

### 实测发现的问题（写在这，避免重踩）

1. **楼中楼的 `comment_id` 不是 `"0"`** —— 必须传一级评论的真实 id（通常是 `"1"` 等），
   传 `"0"` 会得到 `-10049 该条内容已被删除`。
2. **回复的可见性** —— 回复挂在 `replies` 里，`comment_num` 只统计一级评论；
   只数 `comment_num` 会误以为「没回复」。
3. **`target_uin` 是说说主人，不是评论者** —— 传成评论者会直接失败。
4. **群里的人不等于好友** —— 白名单可以配置成「自动并入某个群的成员」（`groupUinsFrom`）。
## 写操作实测（真实 QQ 空间）

在真实账号上跑过一轮，确认「点赞 / 评论」确实落到空间上：

| 动作 | 结果 | 怎么验证的 |
|---|---|---|
| 评论别人的说说 | ✅ 成功 | 拉说说详情，评论区里能看到她写的那句 |
| 点赞别人的说说 | ✅ 成功 | `like_qzone` 返回 `status=ok`；再次点赞被 24h 去重挡住 |
| 发说说 | ✅ 成功 | 发布后 `qzone-last-publish.json` 更新，空间可见 |

### 实测抓到的 bug（已修）

1. **`qzone_comments` 没传 `target_uin`** —— 看别人的说说时桥接返回 `-8 原文已经被删除`，
   而那条说说其实好好的。现在 `target_uin` 作为可选参数透传。
2. **`qzone_like` 成功后没写限频记录** —— 同一条可以说无限重复点赞，每小时/每天上限形同虚设。
3. **评论去重 key 多了个空冒号**（`tid:`）—— 已改成直接用 tid。

> 这三条都是「单元测试全绿但真实环境会坏」的典型：mock 不会模拟桥接对参数的要求，
> 也发现不了「忘记写记录」这种逻辑遗漏。所以协议层测试必须连真实 OneBot。

## 兼容范围

| 项 | 要求 | 实测情况 |
|---|---|---|
| **操作系统** | Linux / Windows / macOS | 代码无平台依赖；仅在 Linux 实测 |
| **Node.js** | `>= 20` | 20 / 22 / 24 跑过单测；CI 覆盖 20、22 |
| **OneBot 网关** | **必须是 SnowLuma 系** | ✅ 实测 SnowLuma |

### OneBot 兼容性（重要）

QQ 空间的接口**不在 OneBot v11 标准里**。本插件用到 7 个 action：

| action | 标准？ |
|---|---|
| `get_login_info` | ✅ 标准 |
| `get_group_member_list` | ✅ 标准 |
| `get_qzone_msg_list` | ❌ 非标准 |
| `get_qzone_msg_detail` | ❌ 非标准 |
| `like_qzone` | ❌ 非标准 |
| `comment_qzone` | ❌ 非标准 |
| `send_qzone_msg` | ❌ 非标准 |

| 网关 | 能用吗 |
|---|---|
| **SnowLuma** | ✅ 实测可用 |
| NapCat / Lagrange / go-cqhttp | ❌ 大概率不行（没有空间 action） |
| 其它 SnowLuma 分支 | 🟡 看是否保留同名 action |

### AI 客户端

| 客户端 | 状态 |
|---|---|
| DSH 0.1.x / 0.2.x | ✅ 实测 |
| 其它 MCP 客户端 | 🟡 推断可用（只返回文本，不涉及图片） |

### 自测你的环境

```bash
node --test                                    # 单测（12 项）
QZONE_ONEBOT_URL=... QZONE_ONEBOT_TOKEN=... \
QZONE_TEST_UIN=你的号 node scripts/selftest-mcp.mjs   # 协议层（只读）
```