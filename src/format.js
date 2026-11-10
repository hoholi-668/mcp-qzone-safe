// 把 OneBot 返回的说说/评论整理成模型好读的形状（纯函数，可单测）。

export function summarizePosts(body, { maxContent = 200 } = {}) {
  const list = body?.data?.msglist ?? [];
  return {
    total: body?.data?.total ?? null,
    count: list.length,
    posts: list.map((p) => ({
      tid: p.tid,
      content: String(p.content ?? '').replace(/\s+/g, ' ').trim().slice(0, maxContent),
      time: p.time,
      commentCount: p.comment_num ?? null,
      images: Array.isArray(p.images) ? p.images.length : 0,
      isPrivate: p.is_private ?? null
    })),
    note: 'QQ 空间接口对 pos>0 的翻页支持有问题，这里只取最新几条。'
  };
}

export function summarizeComments(body, tid, { maxContent = 300, maxReply = 120 } = {}) {
  const d = body?.data ?? {};
  const comments = Array.isArray(d.comments) ? d.comments : [];
  return {
    tid: d.tid ?? tid,
    content: String(d.content ?? '').slice(0, maxContent),
    commentCount: d.comment_num ?? comments.length,
    comments: comments.map((c) => ({
      commentId: String(c.comment_id ?? c.id ?? ''),
      name: c.name ?? '',
      uin: c.uin ?? null,
      time: c.time ?? null,
      content: String(c.content ?? '').slice(0, maxContent),
      replies: Array.isArray(c.replies)
        ? c.replies.map((r) => ({
            name: r.name ?? '',
            uin: r.uin ?? null,
            content: String(r.content ?? '').slice(0, maxReply)
          }))
        : []
    }))
  };
}

/**
 * 校验评论文本：非空、不超字数、不带 CQ 码。
 * 返回 null 表示通过，否则返回拒绝原因。
 */
export function validateText(body, maxChars, { allowEmpty = false } = {}) {
  const text = String(body ?? '').trim();
  if (!text && !allowEmpty) return '拒绝：内容为空';
  // 先判 CQ 码：否则一条超长 CQ 码会报成“超字数”，让人摸不着头脑
  if (/\[CQ:/i.test(text)) return '拒绝：内容里不能带 CQ 码';
  if ([...text].length > maxChars) return `拒绝：超过 ${maxChars} 字`;
  return null;
}



/**
 * 从 comment_qzone 的返回里取新评论 id。
 * 不同网关字段名不同：SnowLuma 用 comment_id，部分实现用 commentId / commentid，
 * 还有的把结果塞进 data.comment.comment_id。
 */
export function pickCommentId(body) {
  const d = body?.data ?? {};
  const v = d.comment_id ?? d.commentId ?? d.commentid ?? d.comment?.comment_id ?? '';
  return String(v);
}

/**
 * 从 send_qzone_msg 的返回里取说说 id。
 * NapCat 返回 { tid, time }；SnowLuma 可能用 msgid 等别名。
 */
export function pickPublishTid(body) {
  const d = body?.data ?? {};
  const v = d.tid ?? d.tid_str ?? d.msgid ?? d.msg_id ?? '';
  return String(v);
}
