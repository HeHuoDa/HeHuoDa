import { containsApplicantList } from "./html.js";

export const noticeRuleVersion = "competition-rules-1";
export type Classification = "definite" | "suspected" | "non_competition";
export interface NoticeClassification {
  classification: Classification;
  notificationKind: "registration" | "supplement" | "award" | "news";
  ruleVersion: string;
  reasons: string[];
  exclusions: string[];
  needsReview: boolean;
  priority: number;
}

export function classificationPriority(
  classification: Classification,
  kind: NoticeClassification["notificationKind"],
) {
  return classification === "non_competition"
    ? 3
    : classification === "suspected"
      ? 2
      : kind === "registration" || kind === "supplement"
        ? 0
        : 1;
}

/** Pure rules over safe text; list exclusion always precedes competition matches. */
export function classifyNotice(
  title: string,
  paragraphs: string[],
  attachmentTitles: string[] = [],
): NoticeClassification {
  const text = [title, ...paragraphs, ...attachmentTitles].join("\n");
  const exclusions: string[] = [];
  const reasons: string[] = [];
  // An excluded attachment blocks that attachment, not an otherwise safe parent notice.
  const list = containsApplicantList([title, ...paragraphs].join("\n"));
  const competition =
    /竞赛|比赛|大赛|挑战杯|互联网\s*\+|运动会|锦标赛|联赛/.test(text);
  const ambiguous = /征文|作品征集|活动赛|创新创业|职业规划|艺术节|体育节/.test(
    text,
  );
  const excluded =
    /体质测试|体测|考试|讲座|培训|招聘|志愿活动|图书借阅/.test(title) &&
    !/竞赛|比赛|大赛/.test(title);
  const explicitRegistration = /报名/.test(title);
  const bodyAward =
    !explicitRegistration &&
    /(?:获奖|评审|竞赛|比赛)(?:结果|名单)[^。；\n]{0,12}公示|现将[^。；\n]{0,100}(?:结果|名单)公示/.test(
      text,
    );
  const bodyNews =
    !explicitRegistration &&
    /(?:竞赛|比赛)[^。；\n]{0,40}(?:圆满结束|成功举办|落下帷幕)|(?:竞赛|比赛)新闻回顾/.test(
      text,
    );
  const notificationKind =
    /获奖|结果公示|名单公示|表彰|获奖新闻/.test(title) || bodyAward
      ? "award"
      : /新闻|回顾|圆满|荣获|喜报/.test(title) || bodyNews
        ? "news"
        : /补充|延期|延长|更正|调整|规则(?:修改|变更)|变更/.test(text)
          ? "supplement"
          : /报名|参赛|竞赛.*通知|比赛.*通知/.test(text)
            ? "registration"
            : "news";
  if (list) exclusions.push("applicant-list");
  if (excluded) exclusions.push("非报名活动，赛事关联需人工核对");
  if (competition) reasons.push("原文含赛事标识");
  if (ambiguous) reasons.push("征集或活动语义不足以确认赛事");
  const classification: Classification = list
    ? "non_competition"
    : excluded
      ? competition || ambiguous || attachmentTitles.length > 0
        ? "suspected"
        : "non_competition"
      : competition
        ? "definite"
        : ambiguous ||
            attachmentTitles.length > 0 ||
            /补充通知|延期通知|规则变更/.test(title)
          ? "suspected"
          : "non_competition";
  if (attachmentTitles.length)
    reasons.push("附件待核对，不按缺少正文关键字排除");
  if (!reasons.length && !exclusions.length)
    exclusions.push("未发现赛事依据，仅保留最小分类记录");
  return {
    classification,
    notificationKind,
    ruleVersion: noticeRuleVersion,
    reasons,
    exclusions,
    needsReview: classification !== "non_competition",
    priority: classificationPriority(classification, notificationKind),
  };
}
