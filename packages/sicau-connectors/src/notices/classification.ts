import { containsApplicantList, containsPersonalNameList } from "./html.js";

export const noticeRuleVersion = "competition-rules-4";
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
  const list =
    containsApplicantList([title, ...paragraphs].join("\n")) ||
    containsPersonalNameList(title);
  // 赛事词表覆盖官网常见命名；「对抗赛」「辩论赛」「技能赛」等以「赛」结尾的
  // 具体赛事形式此前被漏掉，导致标题显式点明赛事却被当作正文旁证降级。
  const competitionPattern =
    /竞赛|比赛|大赛|挑战杯|互联网\s*\+|运动会|锦标赛|联赛|对抗赛|辩论赛|演讲比赛|技能赛|选拔赛|邀请赛|公开赛|擂台赛/;
  const ambiguousPattern =
    /征文|作品征集|活动赛|创新创业|职业规划|艺术节|体育节/;
  const competition = competitionPattern.test(text);
  // 标题是发布方对通知性质的自我声明，正文常列举、引用、举例（招生宣传的成果、
  // 实验室招新的方向、项目类型清单）。标题没有赛事词时，正文命中只作旁证，
  // 最多判到疑似并进入人工复核，不足以单独确认赛事。
  const competitionInTitle = competitionPattern.test(title);
  const ambiguous = ambiguousPattern.test(text);
  const excluded =
    /体质健康测试|体质测试|体测|考试|讲座|培训|沙龙|分享会|报告会|招聘|志愿活动|图书借阅|入团|入党|发展团员|团员发展|党员发展|团课|党校|推优|研修班|交互班|训练营/.test(
      title,
    ) && !/竞赛|比赛|大赛/.test(title);
  // 结果公示仍排除；普通评选只在标题没有其他赛事线索时排除，正文提及旧比赛不算。
  // 「遴选」类公示（如「…院赛遴选的公示」）同样是结果公示，不因含赛事词而失效。
  // 评审对象决定性质：标题里点明了具体赛事（「数学比赛作品评审」）时，评的是赛事作品，
  // 仍属赛事进程；只有泛称（「优秀作品评选」「项目评审」）才是纯评奖。
  // 「遴选」在标题里有两种含义：「…遴选的公示」是结果公示，应排除；
  // 「…遴选的通知」是组织遴选的工作通知，属赛事进程，不能当评奖排除。
  const evaluationAction = /评选|评定|评审|拟评|拟推荐|遴选|评比|推荐/.test(
    title,
  );
  const announcesSelectionResult = /遴选(?:的|结果)?公示|遴选(?:结果)$/.test(
    title,
  );
  const evaluatesEntryOfCompetition =
    /作品(?:评审|评选|评比)|参赛作品(?:评审|评选)/.test(title) &&
    competitionPattern.test(title);
  const selectionByCompetition =
    /推荐参加|推荐参赛|遴选.*(?:队伍|参赛|作品)/.test(title);
  const resultNotice =
    /结果公示|获奖名单|获奖情况|评审结果|评选结果|评定结果|名单公示|的公示|公示$/.test(
      title,
    ) ||
    announcesSelectionResult ||
    (evaluationAction &&
      !evaluatesEntryOfCompetition &&
      !selectionByCompetition &&
      !/关于举办|关于组织参加/.test(title) &&
      // 「遴选…的通知」是组织遴选的工作通知，不是结果公示
      !/遴选的通知|遴选工作/.test(title) &&
      !ambiguousPattern.test(title));
  const explicitRegistration = /报名/.test(title);
  const bodyAward =
    !explicitRegistration &&
    /(?:获奖|评审|竞赛|比赛)(?:结果|名单)[^。；\n]{0,12}公示|现将[^。；\n]{0,100}(?:结果|名单)公示/.test(
      text,
    );
  const bodyNews =
    !explicitRegistration &&
    /(?:竞赛|比赛|大赛)[^。；\n]{0,40}(?:圆满结束|圆满落幕|成功举办|顺利举办|落下帷幕|隆重举行)|(?:竞赛|比赛)新闻回顾/.test(
      text,
    );
  // 标题本身是赛后回顾（「…圆满落幕」「…成功举办」）时，无论正文提及多少赛事细节，
  // 都不是可报名赛事；这类通知只在页面上作历史记录，不能进入报名正例。
  const titleRecap =
    /圆满落幕|圆满结束|成功举办|顺利举办|落下帷幕|隆重举行|赛后|回顾|喜报|荣获/.test(
      title,
    );
  const notificationKind =
    /获奖|结果公示|名单公示|表彰|获奖新闻/.test(title) || bodyAward
      ? "award"
      : /新闻|回顾|圆满|荣获|喜报/.test(title) || bodyNews
        ? "news"
        : // 变更只在标题里判定：正文常出现「政策如有调整」这类泛指，按整篇匹配会把
          // 首次发布的助学金、职业规划大赛通知误判成补充通知。
          /补充|延期|延长|更正|调整|规则(?:修改|变更)|变更/.test(title)
          ? "supplement"
          : /报名|参赛/.test(text) ||
              (!/评选|评定|评审/.test(title) &&
                /竞赛.*通知|比赛.*通知/.test(text))
            ? "registration"
            : "news";
  if (list) exclusions.push("applicant-list");
  if (excluded) exclusions.push("非报名活动，赛事关联需人工核对");
  if (resultNotice) exclusions.push("结果公示或评选通知，不是可报名赛事");
  if (titleRecap) exclusions.push("赛后回顾报道，不是可报名赛事");
  if (competition) reasons.push("原文含赛事标识");
  if (competition && !competitionInTitle && notificationKind !== "supplement")
    reasons.push("赛事仅出现在正文，按旁证处理");
  if (ambiguous) reasons.push("征集或活动语义不足以确认赛事");
  // 补充/延期/更正通知的标题从不点名赛事，但它明确指向某场已有赛事的变更，
  // 属赛事进程而非「正文旁证」，不受标题优先约束。
  // 正文已明确判为获奖公示或赛后回顾时，性质已由正文确定，也不按旁证降级。
  const titleDeclaresCompetition =
    competitionInTitle ||
    notificationKind === "supplement" ||
    bodyAward ||
    bodyNews;
  const classification: Classification =
    list || resultNotice || titleRecap
      ? "non_competition"
      : excluded
        ? competition || ambiguous || attachmentTitles.length > 0
          ? "suspected"
          : "non_competition"
        : competition && titleDeclaresCompetition
          ? "definite"
          : competition ||
              ambiguous ||
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
