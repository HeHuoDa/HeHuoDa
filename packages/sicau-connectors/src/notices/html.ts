import { load } from "cheerio";
import type { Article, Page } from "./types.js";
import { channelById, type Source } from "./sources.js";
import { normalizeUrl, safeUrl } from "./http.js";

export function publishedDate(value: string): string | null {
  const match = /\b(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/.exec(value);
  if (!match) return null;
  const result = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(result);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === result
    ? result
    : null;
}
const clean = (value: string) =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
export class NoticeParseError extends Error {
  constructor(
    readonly code:
      | "blocked-page"
      | "list-selector"
      | "pagination"
      | "article-selector"
      | "empty-article",
    message: string,
  ) {
    super(message);
  }
}
function checkPage(html: string) {
  const $ = load(html);
  if (
    /验证码|访问验证|安全验证|登录验证|访问被拒绝|Access Denied/i.test(
      $("title,h1").text(),
    ) ||
    $("input[type=password],input[name=captcha],iframe[src*='captcha']").length
  )
    throw new NoticeParseError("blocked-page", "站点返回拦截页，停止解析");
  return $;
}
export const isCompetitionNotice = (title: string) =>
  /竞赛|比赛|大赛|挑战杯|创新创业|互联网\s*\+/.test(title);
export const containsApplicantList = (title: string) =>
  /报名(?:者|人员|学生)?(?:信息|名单|汇总)|参赛(?:者|人员|学生)?名单/.test(
    title,
  );
export function extractList(
  html: string,
  url: string,
  source: Source,
  channelId?: string,
): Page {
  const channel = channelById(source, channelId);
  const { selectors } = channel;
  const $ = checkPage(html);
  const rows = $(selectors.rows).filter(
    (_, e) => $(e).find(selectors.link).length > 0,
  );
  const confirmedEmpty =
    !rows.length && !!selectors.empty && $(selectors.empty).length > 0;
  if (!rows.length && !confirmedEmpty)
    throw new NoticeParseError(
      "list-selector",
      "列表选择器失效或空列表，不能视为零条新通知",
    );
  const skipped: { title: string; reason: string }[] = [];
  const items = rows.toArray().flatMap((element) => {
    const row = $(element);
    const anchor = row.find(selectors.link).first();
    const href = anchor.attr("href"),
      title = clean(
        anchor.attr("title") ??
          (selectors.linkTitle
            ? anchor.find(selectors.linkTitle).text() || anchor.text()
            : anchor.text()),
      );
    try {
      if (!href || !title) throw new Error("通知标题或 URL 缺失");
      const noticeUrl = normalizeUrl(new URL(href, url).toString(), source);
      if (!new RegExp(channel.noticePath).test(new URL(noticeUrl).pathname))
        throw new Error("通知链接结构变化，需核对适配器");
      return [
        {
          url: noticeUrl,
          title,
          publishedAt: publishedDate(row.find(selectors.date).text()),
        },
      ];
    } catch (error) {
      skipped.push({
        title,
        reason: error instanceof Error ? error.message : "通知条目无效",
      });
      return [];
    }
  });
  if (!items.length && !confirmedEmpty)
    throw new NoticeParseError(
      "list-selector",
      "全部通知条目无效：" + skipped[0]?.reason,
    );
  const pagination = $(selectors.pagination);
  if (!pagination.length)
    throw new NoticeParseError("pagination", "分页选择器失效，需核对适配器");
  const nextAnchor = pagination
    .find("a")
    .filter((_, e) =>
      new RegExp(selectors.nextText, "i").test(clean($(e).text())),
    )
    .first();
  const next = nextAnchor.attr("href");
  const nextUrl = next
    ? safeUrl(new URL(next, url).toString(), source).toString()
    : null;
  if (
    nextUrl &&
    (!new RegExp(channel.listPath).test(new URL(nextUrl).pathname) ||
      normalizeUrl(nextUrl, source) === normalizeUrl(url, source) ||
      confirmedEmpty)
  )
    throw new NoticeParseError(
      "pagination",
      "分页路径越界、循环或空态与下一页冲突，需核对适配器",
    );
  return {
    ...(skipped.length ? { skipped } : {}),
    items: [...new Map(items.map((item) => [item.url, item])).values()],
    next: nextUrl,
  };
}

export function extractArticle(
  html: string,
  url: string,
  source: Source,
  channelId?: string,
): Article {
  const { selectors } = channelById(source, channelId);
  const $ = checkPage(html);
  const title = clean($(selectors.title).first().text());
  const content = $(selectors.content).first();
  const meta = $(selectors.meta).text();
  if (!title || !content.length)
    throw new NoticeParseError("article-selector", "正文选择器失效");
  content.find("script,style,noscript,.clickCount,#clickTimes").remove();
  const paragraphs = content
    .find("p,li,tr")
    .toArray()
    .map((e) => clean($(e).text()))
    .filter(Boolean);
  if (!paragraphs.length)
    paragraphs.push(...clean(content.text()).split(/\n+/).filter(Boolean));
  const text = paragraphs.join("\n");
  if (text.length < 20)
    throw new NoticeParseError("empty-article", "通知正文为空或过短");
  const attachments: Article["attachments"] = [];
  const wrapper = $(selectors.attachments).first();
  (wrapper.length ? wrapper : content).find("a[href]").each((_, element) => {
    const anchor = $(element),
      href = anchor.attr("href")!;
    if (/download\.jsp|\.(pdf|docx?|xlsx?|zip|rar)(?:[?#]|$)/i.test(href)) {
      const link = new URL(href, url);
      if (link.protocol === "https:" && !link.username && !link.password)
        attachments.push({
          title: clean(anchor.text()) || "附件",
          url: link.toString(),
        });
    }
  });
  return {
    title,
    publishedAt: publishedDate(meta),
    text,
    paragraphs,
    attachments,
  };
}
