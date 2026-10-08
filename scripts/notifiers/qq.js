// Qmsg 酱 3.0：QQ 群/好友消息推送（走 QQ 官方 BOT，免费，无需服务器）。
// Webhook 格式：https://qmsg.zendee.cn/v3/send/{你的Key}?group=目标QQ群号
//   不传 group 则推送到绑定机器人的 QQ 单聊；传 group 推送到对应 QQ 群（需先在控制台绑定群）。
// 接口文档：https://qmsg.zendee.cn/docs  （GET/POST /v3/send/{key} 或 POST /v3/jsend/{key}，JSON { msg, group }）
import { postJson } from "./http.js";
import { buildInitMarkdown, buildReportMarkdown } from "./markdown.js";

// Qmsg 单条消息上限 1800 字符，留少量余量（按字符截断）
const MAX_MSG_CHARS = 1750;

/** 按字符数截断（先退到行边界，避免截出半行 markdown） */
export function truncateChars(text, maxChars = MAX_MSG_CHARS) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  const str = lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
  return `${str}\n\n…（内容过长已截断）`;
}

/** 从 Webhook 地址解析 Qmsg Key 与目标（group 为群号，缺省则推送到单聊） */
function extractTarget(webhook) {
  const url = new URL(webhook);
  const match = url.pathname.match(/\/v3\/send\/([^/]+)/);
  return {
    key: match ? match[1] : "",
    group: url.searchParams.get("group") || "",
    origin: url.origin,
  };
}

const buildQmsgPayload = ({ title, text }) => ({
  msg: truncateChars(`${title}\n\n${text}`),
});

export const qq = {
  name: "qq",
  matches: (webhook) => /qmsg\.zendee\.cn/.test(webhook),
  buildReport: (data) => buildQmsgPayload(buildReportMarkdown(data)),
  buildInit: (data) => buildQmsgPayload(buildInitMarkdown(data)),
  async send({ webhook, payload }) {
    const { key, group, origin } = extractTarget(webhook);
    if (!key) {
      throw new Error(
        "Qmsg Webhook 格式错误，应为 https://qmsg.zendee.cn/v3/send/{你的Key}?group=目标QQ群号",
      );
    }
    if (!payload?.msg) throw new Error("Qmsg 消息内容为空");
    const body = { msg: payload.msg };
    if (group) body.group = group;
    try {
      await postJson(`${origin}/v3/jsend/${key}`, body, {
        parseResult: (res, data) => {
          // 文档：统一返回 JSON，success=true 表示成功（HTTP 状态不一定 200）
          if (data && data.success === true) return null;
          const hint = data?.message || data?.msg || "";
          return new Error(`Qmsg 返回错误 code=${data?.code ?? res.status}${hint ? `: ${hint}` : ""}`);
        },
      });
    } catch (err) {
      throw new Error(`QQ 消息发送失败: ${err.message}`);
    }
    console.log("📨 QQ 消息发送成功");
  },
};
