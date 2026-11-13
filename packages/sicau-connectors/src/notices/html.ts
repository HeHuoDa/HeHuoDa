import { load } from "cheerio";
import type { Article, Page } from "./types.js";
import { channelById, type Source } from "./sources.js";
import { normalizeUrl, normalizeAttachmentUrl, safeUrl } from "./http.js";

export function publishedDate(value: string, pattern?: string): string | null {
  const match = (
    pattern
      ? new RegExp(pattern)
      : /\b(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/
  ).exec(value);
  if (!match) return null;
  // 默认按年、月、日的捕获顺序；日期分块顺序不同的站点用 year/month/day 命名组声明。
  const year = match.groups?.year ?? match[1];
  const month = match.groups?.month ?? match[2];
  const day = match.groups?.day ?? match[3];
  if (
    !year ||
    !month ||
    !day ||
    !/^20\d{2}$/.test(year) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{1,2}$/.test(day)
  )
    return null;
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
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
  // 「填写报名信息」这类普通表述不算名单；只有名单、汇总或信息表才按个人资料拦截。
  /报名(?:者|人员|学生)?(?:名单|汇总)|报名(?:者|人员|学生)?信息(?:表|汇总)|参赛(?:者|人员|学生)?名单/.test(
    title,
  );
/**
 * 标题层面的个人名单判定：报名者名单之外，评优、奖助学金、拟发展等公示同样逐条列人名。
 * 只看标题，避免正文里「名单另行公布」这类表述误伤正常赛事通知。
 */
export const containsPersonalNameList = (title: string) =>
  containsApplicantList(title) ||
  /(?:拟发展|拟推荐|拟推|拟评|拟聘|拟表彰|发展对象|发展团员|入团积极分子|入党积极分子|评优|评奖|奖学金|助学金|奖助学金|补贴|资助|补助|优秀学生|优秀学生干部|优秀班集体|先进个人|标兵)[^。；\n]{0,12}(?:名单|公示|结果)/.test(
    title,
  );
/**
 * 名单对象：报名／参赛人员的名单、汇总表、信息表、明细、清单等逐条记录个人资料的材料。
 * 「表」必须显式出现（写成 `信息表|汇总表`，不能用 `信息表?|汇总表?`）：后者把「表」
 * 变成可选，会连「提交报名信息」一起命中，让普通报名说明被当成名单表头。
 */
const applicantListObject =
  /报名(?:者|人员|学生)?(?:名单|汇总表|汇总|信息表|明细|清单)|参赛(?:者|人员|学生)?(?:名单|明细|清单)/;
/**
 * 空表／模板语义：名单对象紧接这些词时，后面的「如下」修饰的是表样，不是公布动作。
 * 「报名人员信息表（空表如下）」是在下发表样，不是发布了名单。
 * 只在该名单对象自己的间隔内生效，不做全文豁免；后文逐条列名仍照旧拦截。
 */
const templateSampleWords = /空表|模板|样表|空白表/;
/**
 * 名单对象后紧跟公布动作（如下／公示／公布／附后／见附件），或名单表头冒号后直接给姓名
 * （「名单：张三、李四」）。「报送／填写／收齐参赛名单汇总表」只是报名流程，
 * 没有公布动作，不构成发布名单。
 *
 * 公布类动作（如下／公示／公布／公告）允许跨过括号：官方常写成
 * 「参赛名单（公布如下）：张三、李四」「报名人员信息表（如下）：…」，
 * 把括号整体排除在间隔外会漏拦这类真实名单。
 * 但间隔内出现空表／模板／样表／空白表时，该动作修饰表样而非公布，不拦截。
 * 附件引用类动作（见附件／附后／附上）仍不跨括号：「参赛名单汇总表（模板见附件）」
 * 是在下发表样，跨过括号去匹配「见附件」会把报名说明误判成名单。
 */
const listPublishedAfter = new RegExp(
  `(?:${applicantListObject.source})` +
    `(?:(?!(?:${templateSampleWords.source}))[^。；\\n]){0,10}?` +
    `(?:如下|公示|公布|公告)` +
    `|(?:${applicantListObject.source})[^。；\\n（）()]{0,10}?(?:见附件|附后|附上)` +
    `|(?:名单|明细|信息表|汇总表)\\s*(?:如下)?\\s*[：:]\\s*(?:[\\u4e00-\\u9fff]{2,4})(?:[、，,；;\\s]|$)`,
);
/** 公布动作在名单对象之前（「现公布参赛名单」）；「现将…名单报送」不属于公布。 */
const listPublishedBefore = new RegExp(
  `(?:现公布|现公示|现予公布|现予公示|予以公布|予以公示|现对[^。；\\n]{0,8}?(?:名单|明细))[^。；\\n]{0,8}?(?:${applicantListObject.source}|名单)`,
);
/** 只有名单对象、没有报名流程动词的整段标题式行（多半是表格拆行后的表头）。 */
const bareListHeading = new RegExp(
  `^(?:附件\\s*\\d*\\s*[：:、.]?\\s*)?(?:${applicantListObject.source})$`,
);
/** 「附件1：参赛人员名单」「参赛名单汇总表.xlsx」这类以名单对象结尾的短标题行。 */
const namedListHeading = new RegExp(
  `^(?:附件\\s*\\d*\\s*[：:、.]?\\s*)?[^，,。；;\\n]{0,20}${applicantListObject.source}\\s*(?:\\.(?:pdf|docx?|xlsx?))?$`,
);
/** 姓名＋学号／姓名＋序号一类的表格数据行（表格被拆成独立段落时逐行出现）。 */
const rosterRow =
  /^\s*(?:\d{1,3}\s*[、.．:：]?\s*)?(?:[\u4e00-\u9fff]{2,4})(?:\s|[\u3000]|\d{6,20})/;
const identityRow = /(?:学号|学生编号)\s*[:：]?\s*\d{6,20}|\d{8,20}/;
/** 短姓名行：表格拆行后单独成段的姓名（2–4 个汉字，无其他内容）。 */
const plainNameLine = /^[\u4e00-\u9fff]{2,4}$/;
/** 名单表头后紧跟的「如下：」也算发布，即使冒号后没有姓名。 */
const listHeadingThenColon = new RegExp(
  `(?:名单|明细|信息表|汇总表)\\s*(?:如下|附后|见附件)?\\s*[：:]\\s*$`,
);
/** 名单对象后紧跟冒号（「名单如下：张三」「参赛学生名单：」）。 */
const listObjectThenColon = new RegExp(
  `(?:${applicantListObject.source}|名单|明细|信息表|汇总表)\\s*(?:如下|附后|见附件)?\\s*[：:]`,
);
/**
 * 报名流程动词只与名单对象相邻时才算「要求报送」。整段任何位置出现报送都豁免，
 * 会把「现将名单公布如下：张三…请各班报送材料」这类真名单误放行。
 */
const listWorkflowPhrase = new RegExp(
  `(?:${applicantListObject.source})[^。；\\n]{0,6}?(?:报送|提交|上交|填写|收齐|收集|统计|上报|递交|交给|发至|发到|传至)` +
    `|(?:报送|提交|上交|填写|收齐|收集|统计|上报|递交|交给|发至|发到|传至)[^。；\\n]{0,6}?(?:${applicantListObject.source})`,
);
/**
 * 正文是否在发布真实名单（逐条列人名），而不是在报名说明里要求报送名单表。
 * 三种形态都算发布：公布动作句、名单表头后跟姓名，以及表格被拆行后
 * 「名单表头 + 姓名/学号行」的组合——后者没有公布动词，但确实是名单正文。
 */
export function bodyPublishesApplicantList(text: string): boolean {
  const clauses = text
    .split(/[。；;\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (
    clauses.some(
      (clause) =>
        listPublishedAfter.test(clause) || listPublishedBefore.test(clause),
    )
  )
    return true;
  // 表格形态：某一行只写名单对象，且同段另有姓名行或学号行。流程句只在
  // 它自己那一句里抵消名单对象，不能整段否决后面的逐条记录。
  const headingAt = clauses.findIndex(
    (clause) =>
      bareListHeading.test(clause) ||
      namedListHeading.test(clause) ||
      // 「附件1：参赛人员名单」「名单如下：」这类标题式行同样开启名单段。
      listHeadingThenColon.test(clause) ||
      // 名单对象后紧跟冒号，且该句就是整段（表格首行常见形态）。
      listObjectThenColon.test(clause),
  );
  // 正文里单独一行就点名「参赛人员名单」且带附件序号/表格扩展名时，
  // 本身就是名单材料，不论后面有没有姓名行。
  const namedListMaterial = clauses.some(
    (clause) =>
      namedListHeading.test(clause) &&
      (/^附件\s*\d*\s*[：:、.]/.test(clause) ||
        /\.(?:pdf|docx?|xlsx?)$/i.test(clause)),
  );
  if (namedListMaterial) return true;
  if (headingAt < 0) return false;
  // 流程句只否定它自己点名的那一段，不能覆盖同段或后续的真实姓名／学号证据。
  // 「请班长报送参赛名单汇总表」与后一段「参赛学生名单」表格可以并存：
  // 前者是报名流程，后者是已发布的逐条记录，两者不是一个判断对象。
  return clauses.slice(headingAt + 1).some((clause) => {
    const evidence = listWorkflowPhrase.test(clause)
      ? clause.replace(listWorkflowPhrase, "")
      : clause;
    return (
      rosterRow.test(evidence) ||
      identityRow.test(evidence) ||
      plainNameLine.test(evidence)
    );
  });
}
/**
 * 名单隐私边界：标题点名名单，或正文实际发布名单。
 * 分类、采集与保存都使用这一份判据，避免只修其中一处导致离线与入库结论不一致。
 */
export function publishesApplicantList(title: string, body: string): boolean {
  return (
    containsApplicantList(title) ||
    containsPersonalNameList(title) ||
    bodyPublishesApplicantList(body)
  );
}
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
          publishedAt: publishedDate(
            row.find(selectors.date).text(),
            channel.listDatePattern ?? channel.datePattern,
          ),
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
  let nextUrl = next
    ? safeUrl(new URL(next, url).toString(), source).toString()
    : null;
  if (channel.pagination) {
    const config = channel.pagination;
    const currentText = $(config.current).first().text().trim(),
      totalText = $(config.total).first().text().trim();
    const current = Number(currentText),
      total = Number(totalText);
    if (
      !/^\d+$/.test(currentText) ||
      !/^\d+$/.test(totalText) ||
      current < 1 ||
      total < current ||
      total > 100000
    )
      throw new NoticeParseError("pagination", "页码规则失效或超出范围");
    nextUrl = null;
    if (current < total) {
      const target = new URL(url);
      if (config.target.kind === "query")
        target.searchParams.set(config.target.parameter, String(current + 1));
      else
        target.pathname = config.target.template.replace(
          "{page}",
          String(current + 1),
        );
      nextUrl = safeUrl(target.toString(), source).toString();
    }
  }
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
  const { selectors, datePattern } = channelById(source, channelId);
  const $ = checkPage(html);
  const title = clean($(selectors.title).first().text());
  const content = $(selectors.content).first();
  const meta = $(selectors.meta).text();
  if (!title || !content.length)
    throw new NoticeParseError("article-selector", "正文选择器失效");
  const embeddedPdfs: Article["attachments"] = [];
  // 只读取VSB的静态参数，不执行脚本；下载仍须通过逐站核准的附件路径。
  content.find("script").each((_, element) => {
    for (const match of $(element)
      .text()
      .matchAll(/\bshowVsbpdfIframe\(\s*(["'])([^"'\\\r\n]+)\1\s*,/g)) {
      try {
        const link = normalizeAttachmentUrl(
          new URL(match[2], url).toString(),
          source,
        );
        if (/\.pdf$/i.test(new URL(link).pathname))
          embeddedPdfs.push({ title, url: link });
      } catch {
        // 未核准地址不能让空白正文被当作有效通知。
      }
    }
  });
  content.find("script,style,noscript,.clickCount,#clickTimes").remove();
  const paragraphs = content
    .find("p,li,tr")
    .toArray()
    .map((e) => clean($(e).text()))
    .filter(Boolean);
  if (!paragraphs.length)
    paragraphs.push(...clean(content.text()).split(/\n+/).filter(Boolean));
  const text = paragraphs.join("\n");
  if (text.length < 20 && !embeddedPdfs.length)
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
    publishedAt: publishedDate(meta, datePattern),
    text,
    paragraphs,
    attachments: [
      ...new Map(
        [...attachments, ...embeddedPdfs].map((a) => [a.url, a]),
      ).values(),
    ],
  };
}
