// Qmsg 酱 3.0：QQ 群/好友消息推送（走 QQ 官方 BOT，免费，无需服务器）。
// Webhook 格式：https://qmsg.zendee.cn/v3/send/{你的Key}?group=目标QQ群号
//   不传 group 则推送到绑定机器人的 QQ 单聊；传 group 推送到对应 QQ 群（需先在控制台绑定群）。
// 接口文档：https://qmsg.zendee.cn/docs  （GET/POST /v3/send/{key} 或 POST /v3/jsend/{key}，JSON { msg, group }）
import { postJson } from "./http.js";
import { formatMinutes } from "../diff.js";
import { formatZhDate, sanitize } from "../text.js";
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

// QQ 客户端不渲染 Markdown，星号/井号会原样显示；这里构建纯文本卡片：
// 标题只出现一次（由 title 带出），正文用 emoji + 缩进突出关键信息。
const MAX_PLAYED_GAMES = 15;
const MAX_ACHIEVEMENT_NAMES = 8;
const MAX_LIBRARY_NAMES = 10;

// 字符画分隔线与区块前缀，用于纯文本卡片的视觉分区
const DIVIDER = "━━━━━━━━━━━━━━━━";
const BLOCK = "▎";

/** 每日战报 → QQ 纯文本 { title, text }；入参结构同 buildReportMarkdown */
export function buildQqReport({ personaName, reportDate, diff, achievements, generatedAt, timeZone, windowNote = "", extras = {} }) {
  const { titleText = "", mvp = null, milestoneLines = [], lastPlayed = null } = extras;
  const played = diff.playedToday ?? [];
  const withNew = (achievements ?? []).filter((a) => a.added.length > 0);
  const totalNew = withNew.reduce((sum, a) => sum + a.added.length, 0);
  const lines = [DIVIDER];

  if (played.length > 0) {
    lines.push(`👤 ${sanitize(personaName)} ｜ 🔥 ${titleText || "今日有游玩"}`);
    lines.push(`⏱ 当日游玩 ${formatMinutes(diff.totalTodayMinutes)} · ${played.length} 款游戏`);
    lines.push(DIVIDER, `${BLOCK}🎮 今日游玩`);
    played.slice(0, MAX_PLAYED_GAMES).forEach((g, i) => {
      const isMvp = mvp && g.appId === mvp.appId;
      const share = isMvp && mvp.sharePercent != null ? ` · 今日 ${mvp.sharePercent}%` : "";
      const badge = isMvp ? " 🏅" : "";
      lines.push(`${i + 1}. ${sanitize(g.name)}${badge}`);
      lines.push(`   +${formatMinutes(g.todayMinutes)} · 累计 ${formatMinutes(g.totalMinutes)}${share}`);
    });
    if (played.length > MAX_PLAYED_GAMES) lines.push(`… 共 ${played.length} 款有时长增量，仅列前 ${MAX_PLAYED_GAMES} 款`);
  } else {
    lines.push(`👤 ${sanitize(personaName)} ｜ 📚 休息日`);
    lines.push("当日未启动任何游戏");
    if (lastPlayed) lines.push(`上次游玩：${sanitize(lastPlayed.name)} · ${lastPlayed.lastDate}`);
  }

  if (withNew.length > 0) {
    lines.push("", `${BLOCK}🏆 新解锁成就 ${totalNew} 个`);
    withNew.forEach((a) => {
      const names = a.added
        .slice(0, MAX_ACHIEVEMENT_NAMES)
        .map((item) => `「${sanitize(item.displayName)}」`)
        .join("、");
      const more = a.added.length > MAX_ACHIEVEMENT_NAMES ? ` 等 ${a.added.length} 个` : "";
      lines.push(`   · ${sanitize(a.gameName)} ${a.unlockedCount}/${a.total}：${names}${more}`);
    });
  }

  if (milestoneLines.length > 0) {
    lines.push("", `${BLOCK}🎖 今日里程碑`);
    milestoneLines.forEach((line) => lines.push(`   · ${line}`));
  }

  if (diff.newLibraryGames?.length > 0) {
    const names = diff.newLibraryGames
      .slice(0, MAX_LIBRARY_NAMES)
      .map((g) => sanitize(g.name))
      .join("、");
    const more = diff.newLibraryGames.length > MAX_LIBRARY_NAMES ? ` 等 ${diff.newLibraryGames.length} 款` : "";
    lines.push("", `${BLOCK}📦 新增入库 ${diff.newLibraryGames.length} 款`, `   ${names}${more}`);
  }

  lines.push("", DIVIDER);
  lines.push(`📊 库存 ${diff.library.gameCount} 款 ｜ 总时长 ${formatMinutes(diff.library.totalMinutes)}`);
  lines.push(`🕐 数据来自 Steam · ${windowNote}生成于 ${generatedAt}（${timeZone}）`);

  return { title: `🎮 Steam 每日战报 · ${formatZhDate(reportDate)}`, text: lines.join("\n") };
}

/** 首次运行存档消息 → QQ 纯文本 */
export function buildQqInit({ personaName, library, perfectCount }) {
  const lines = [
    DIVIDER,
    `👤 ${sanitize(personaName)} 的玩家档案已建立 📂`,
    `📚 库存 ${library.gameCount} 款游戏 · 总时长 ${formatMinutes(library.totalMinutes)}`,
  ];
  if (typeof perfectCount === "number") lines.push(`🏆 全成就 ${perfectCount} 款`);
  lines.push(DIVIDER, "✅ 明天开始，每日战报准时送达");
  return { title: "🎮 战报存档已创建", text: lines.join("\n") };
}

export const qq = {
  name: "qq",
  matches: (webhook) => /qmsg\.zendee\.cn/.test(webhook),
  buildReport: (data) => buildQmsgPayload(buildQqReport(data)),
  buildInit: (data) => buildQmsgPayload(buildQqInit(data)),
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
