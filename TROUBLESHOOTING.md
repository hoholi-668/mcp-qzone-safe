# 排错手册

> QQ 空间的坑分两类：**参数传错**（桥接给的报错很隐晦）和**平台风控**。

---

## 连不上 OneBot

### 全部工具都返回「请求失败 / ECONNREFUSED」

**原因**：OneBot 网关没起来，或地址/端口不对。

```bash
# 先确认网关活着
curl -X POST http://127.0.0.1:3000/get_login_info -H "Authorization: Bearer YOUR_TOKEN"
```

**检查**：

```bash
export QZONE_ONEBOT_URL=http://127.0.0.1:3000
export QZONE_ONEBOT_TOKEN=你的token
```

### 返回 401 / 403

**原因**：token 不对，或网关要求别的鉴权头。

**处理**：token 从网关配置里复制完整（不要带空格/换行）。

---

## 「原文已经被删除」但说说还在（code -8）

**原因**：`get_qzone_msg_detail` 缺 `target_uin`，桥接以为你在查不存在的说说。

**处理**：

```json
{ "tid": "xxx", "target_uin": "说说主人的QQ号", "num": 10 }
```

**注意**：`target_uin` 是**说说主人**，不是评论者。传成评论者也会失败。

---

## 回复评论失败（code -10049）

**原因**：楼中楼的 `comment_id` 不是 `"0"`，必须传一级评论的真实 id。

**处理**：

1. 先 `qzone_comments` 拿到 `commentId`（通常是 `"1"`、`"2"` 这类）
2. 再评论时带上：

```json
{ "tid": "...", "target_uin": "...", "content": "...", "comment_id": "1", "comment_uin": "被回复人的QQ号" }
```

---

## 评论成功但「看不到」

**原因**：回复挂在 `replies` 里，`comment_num` 只统计一级评论。

```json
{
  "comments": [
    { "content": "一级评论", "replies": [ { "content": "她的回复" } ] }
  ]
}
```

**处理**：看 `replies` 数组，别只看数量。

---

## 被限频拒绝

**这是正常行为**，不是 bug。

| 限制 | 默认值 |
|---|---|
| 同一条说说点赞 | 24 小时一次 |
| 同一条说说评论 | 24 小时一次 |
| 点赞 | 20/小时、50/天 |
| 评论 | 3/小时、10/天 |
| 发说说 | 1/天 |

**要看还有多少额度**：删掉/查看 `state/rate.json`（或 `QZONE_STATE_DIR` 下的同名文件）。

---

## 白名单拒绝

**症状**：`拒绝：xxx 不在白名单内`

**处理**：把 QQ 号加进 `config.json` 的 `allowUins`，或用 `groupUinsFrom` 自动并入群成员。

**注意**：默认拒绝是安全边界，别为了省事全放开。

---

## 发说说被拒

### 「发说说功能未启用」

```json
{ "publishEnabled": true }
```

或环境变量 `QZONE_PUBLISH_ENABLED=true`。

### 「内容太长 / 含 CQ 码」

| 限制 | 值 |
|---|---|
| 说说 | ≤ 300 字 |
| 评论 | ≤ 120 字 |
| CQ 码 | 禁止（`[CQ:...]`） |

**处理**：去掉 CQ 码，缩短内容。

---

## 好友名册是空的

**原因**：没有配置宿主的 state 目录。

```bash
export QZONE_BRIDGE_STATE_DIR=/opt/qq-bridge/state
```

**注意**：只有配了才会读 `friends.json` / 写 `qzone-*` 状态文件。

---

## 平台风控

### 点赞/评论后立刻被删或提示操作频繁

**原因**：QQ 空间有频率风控，比本插件的限制更严。

**处理**：

1. 降低频率（把 `limits` 调到 5/小时以下）
2. 不要对新加的陌生人立刻操作
3. 连续失败就停一天

**预防**：**只用小号**，别用主号跑自动化。

---

## 巡视（发完说说看朋友动态）不工作

| 检查项 | 怎么查 |
|---|---|
| 配置开了吗 | `config.json` 的 `patrol.enabled` |
| 好友列表空吗 | `allowUins` 是否有内容 |
| 状态文件有记录吗 | `state/qzone-patrol.json` 里的 `seen` |
| 是不是都看过了 | 全都见过时不会有新内容（正常） |

**手动验证**：

```bash
QZONE_PATROL_ON_START=1 node src/index.js
```

会打印「朋友的新动态」或「没有新动态」。

---

## 还是不行

1. 看审计日志：`state/audit.jsonl`（每次调用都有一条）
2. 直接调一次 OneBot：

```bash
curl -X POST http://127.0.0.1:3000/send_qzone_msg \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"测试"}'
```

3. 直连成功、插件失败 → 提 issue，附上：报错文本、`target_uin`、`tid`、用的哪个 OneBot 实现。
