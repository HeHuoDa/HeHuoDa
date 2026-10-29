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

/** Pure rules over safe text; list exclusion always precedes competition matches. */
export function classifyNotice(
  title: string,
  paragraphs: string[],
): NoticeClassification {
  const text = [title, ...paragraphs].join("\n");
  const exclusions: string[] = [];
  const reasons: string[] = [];
  const list = containsApplicantList(text);
  const competition =
    /竞赛|比赛|大赛|挑战杯|互联网\s*\+|运动会|锦标赛|联赛/.test(text);
  const ambiguous = /征文|作品征集|活动赛|创新创业|职业规划|艺术节|体育节/.test(
    text,
  );
  const excluded =
    /体质测试|体测|考试|讲座|培训|招聘|志愿活动|图书借阅/.test(title) &&
    !/竞赛|比赛|大赛/.test(title);
  const notificationKind = /获奖|结果公示|名单公示|表彰|获奖新闻/.test(title)
    ? "award"
    : /新闻|回顾|圆满|荣获|喜报/.test(title)
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
      ? competition || ambiguous
        ? "suspected"
        : "non_competition"
      : competition
        ? "definite"
        : ambiguous || /补充通知|延期通知|规则变更/.test(title)
          ? "suspected"
          : "non_competition";
  if (!reasons.length && !exclusions.length)
    exclusions.push("未发现赛事依据，仅保留最小分类记录");
  return {
    classification,
    notificationKind,
    ruleVersion: noticeRuleVersion,
    reasons,
    exclusions,
    needsReview: classification !== "non_competition",
    priority:
      classification === "non_competition"
        ? 3
        : classification === "suspected"
          ? 2
          : /registration|supplement/.test(notificationKind)
            ? 0
            : 1,
  };
}
