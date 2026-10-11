import { load } from "cheerio";
import type { Article, Page } from "./types.js";
import type { Source } from "./sources.js";
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
export const isCompetitionNotice = (title: string) =>
  /竞赛|比赛|大赛|挑战杯|创新创业|互联网\s*\+/.test(title);
export const containsApplicantList = (title: string) =>
  /报名(?:者|人员|学生)?(?:信息|名单|汇总)|参赛(?:者|人员|学生)?名单/.test(
    title,
  );
export function extractList(html: string, url: string, source: Source): Page {
  const $ = load(html);
  const rows =
    source.id === "information-engineering"
      ? $("div[id^='line_u']").filter(
          (_, e) =>
            $(e).find("h1.content-page-title a[rel=bookmark]").length > 0,
        )
      : $("ul.sub-list02.sub-list02T li").filter(
          (_, e) => $(e).find("a.gp-m15").length > 0,
        );
  if (!rows.length)
    throw new Error("列表选择器失效或空列表，不能视为零条新通知");
  const items = rows.toArray().map((element) => {
    const row = $(element);
    const anchor =
      source.id === "information-engineering"
        ? row.find("h1.content-page-title a[rel=bookmark]").first()
        : row.find("a.gp-m15").first();
    const href = anchor.attr("href"),
      title = clean(
        anchor.attr("title") ??
          (source.id === "life-sciences"
            ? anchor.find("h3").text() || anchor.text()
            : anchor.text()),
      );
    if (!href || !title) throw new Error("通知标题或 URL 缺失");
    const noticeUrl = normalizeUrl(new URL(href, url).toString(), source);
    if (!/^\/info\/\d+\/\d+\.htm$/.test(new URL(noticeUrl).pathname))
      throw new Error("通知链接结构变化，需核对适配器");
    return {
      url: noticeUrl,
      title,
      publishedAt: publishedDate(
        row
          .find(
            source.id === "information-engineering"
              ? ".spanTime"
              : ".news-time",
          )
          .text(),
      ),
    };
  });
  const pagination = $(".p_pages");
  if (!pagination.length) throw new Error("分页选择器失效，需核对适配器");
  const nextAnchor = pagination
    .find("a")
    .filter((_, e) => /^(下页|下一页|下一頁|Next|>)$/i.test(clean($(e).text())))
    .first();
  const next = nextAnchor.attr("href");
  return {
    items: [...new Map(items.map((item) => [item.url, item])).values()],
    next: next
      ? safeUrl(new URL(next, url).toString(), source).toString()
      : null,
  };
}

export function extractArticle(
  html: string,
  url: string,
  source: Source,
): Article {
  const $ = load(html);
  const title = clean(
    $(
      source.id === "information-engineering"
        ? "h1.page-title"
        : ".pageArticleTitle",
    )
      .first()
      .text(),
  );
  const content = $(
    source.id === "information-engineering"
      ? ".news-body #vsb_content .v_news_content"
      : "#vsb_content_4 .v_news_content",
  ).first();
  const meta = $(
    source.id === "information-engineering"
      ? ".news-meta time"
      : ".articleAuthor",
  ).text();
  if (!title || !content.length) throw new Error("正文选择器失效");
  content.find("script,style,noscript,.clickCount,#clickTimes").remove();
  const paragraphs = content
    .find("p,li,tr")
    .toArray()
    .map((e) => clean($(e).text()))
    .filter(Boolean);
  if (!paragraphs.length)
    paragraphs.push(...clean(content.text()).split(/\n+/).filter(Boolean));
  const text = paragraphs.join("\n");
  if (text.length < 20) throw new Error("通知正文为空或过短");
  const attachments: Article["attachments"] = [];
  const wrapper = $(
    source.id === "information-engineering"
      ? ".news-body"
      : ".pageArticle,.gp-article",
  ).first();
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
