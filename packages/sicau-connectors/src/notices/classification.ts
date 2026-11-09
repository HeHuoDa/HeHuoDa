import { containsApplicantList, containsPersonalNameList } from "./html.js";

export const noticeRuleVersion = "competition-rules-9";
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
  // 「推荐/遴选」既可能是评优（推荐优秀学生），也可能是赛事选拔（推荐参赛队伍）。
  // 只要标题里同时出现推荐类动作与参赛/队伍/作品，就按赛事选拔处理，
  // 不因语序不同（「推荐参加…」与「推荐…参赛队伍」）漏判；「参加」分支
  // 仍要求标题点明赛事，并排除参加评优评奖的表述。
  const participationTarget =
    /(?:推荐|遴选)[^｜|]{0,20}参加([^｜|]+)/.exec(title)?.[1] ?? "";
  const selectionByCompetition =
    /(?:推荐|遴选)[^｜|]{0,20}(?:参赛|队伍|作品)/.test(title) ||
    /(?:参赛|队伍)[^｜|]{0,20}(?:推荐|遴选)/.test(title) ||
    (competitionPattern.test(participationTarget) &&
      !/评选|评定|评比|评审|表彰/.test(title));
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
  // #205：标题声明的主体与对象决定通知是不是「面向学生开放的参赛报名」。
  // 执裁实践的主体是提供执裁服务的师生，对象是已举行的赛事，属实践回顾；
  // 招新、岗位招募、社会实践组队、假期与离校管理的主体是学院或学生组织，对象是部门、
  // 岗位或事务，赛事只是成果举例或旁证。两者都不构成本项目要收的报名赛事。
  // 判定只看标题：标题一旦自己点明赛事（竞赛/比赛/大赛…）就不适用，保证
  // 「招募…竞赛参赛队伍」「推荐…参加…竞赛」这类真实参赛通知不被一刀切排除。
  const officiatingPractice =
    /执裁|担任裁判|裁判工作/.test(title) &&
    !/报名|参赛|作品|选拔队伍/.test(title) &&
    !/关于举办|关于组织|组织参加/.test(title);
  const nonCompetitionBusiness =
    /招新|纳新|招募|招聘|社会实践|假期|离校|助理/.test(title) &&
    !competitionPattern.test(title) &&
    !ambiguousPattern.test(title) &&
    // 「招募…参赛队伍」「…队员招募」仍是真实参赛通知，不能因「招募」二字排除。
    !/参赛|队伍|队员|作品/.test(title);
  const semanticNonCompetition = officiatingPractice || nonCompetitionBusiness;
  // 附件标题若自己写明赛事名与具体事项（如「数学竞赛延期通知.pdf」），仍是一份
  // 待核对的赛事依据，不被标题的业务性质吞掉；此时保留疑似，交人工核对。
  const semanticNonCompetitionDecisive =
    semanticNonCompetition && attachmentTitles.length === 0;
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
          : // 执裁实践是已结束活动的回顾，正文里的「参赛」「报名」指他人已发生的行为，
            // 不得据此把通知种类记成面向学生的报名通知。其余非赛事业务的报名仍按
            // 事实记为报名通知：通知种类描述通知本身，与内容是否属于赛事相互独立。
            officiatingPractice
            ? "news"
            : /报名|参赛/.test(text) ||
                (!/评选|评定|评审/.test(title) &&
                  /竞赛.*通知|比赛.*通知/.test(text))
              ? "registration"
              : "news";
  if (list) exclusions.push("applicant-list");
  if (officiatingPractice) exclusions.push("执裁实践回顾，不是可报名赛事");
  if (nonCompetitionBusiness)
    exclusions.push("非赛事业务通知，正文赛事提及仅作旁证");
  if (excluded) exclusions.push("非报名活动，赛事关联需人工核对");
  if (resultNotice || bodyAward)
    exclusions.push("结果公示或评选通知，不是可报名赛事");
  if (titleRecap || bodyNews) exclusions.push("赛后回顾报道，不是可报名赛事");
  if (competition) reasons.push("原文含赛事标识");
  if (competition && !competitionInTitle && notificationKind !== "supplement")
    reasons.push("赛事仅出现在正文，按旁证处理");
  if (ambiguous) reasons.push("征集或活动语义不足以确认赛事");
  // 补充/延期/更正通知的标题从不点名赛事，但它明确指向某场已有赛事的变更，
  // 属赛事进程而非「正文旁证」，不受标题优先约束。
  // 正文已明确判为获奖公示或赛后回顾时，由下方排除分支处理。
  const titleDeclaresCompetition =
    competitionInTitle || notificationKind === "supplement";
  // protocol v2 B1：definite 还要求正文有「可核对安排」，只有标题或只有转发语
  // 不足以确认。可核对安排指时间、地点、参赛对象、报名方式、赛程或联系方式一类
  // 具体事实。判据看内容形态而非长度：短句「报名截止：2026年11月1日。」同样算安排；
  // 纯转发语、空正文、或只有附件链接才算不满足。
  const bodyText = paragraphs.join("\n").trim();
  const onlyForwarding =
    bodyText.length === 0 ||
    /^(?:现将(?:通知|文件|有关事项)?(?:转发)?如下[。，,]?|请(?:关注|查看)附件[。]?|详见附件[。]?)$/.test(
      bodyText,
    );
  const hasCheckableArrangement =
    (!onlyForwarding &&
      /报名|截止|截至|参赛对象|参赛资格|参赛范围|参赛要求|时间|地点|赛程|赛制|日程|邮箱|QQ|群号|联系方式|联系人|提交|报送|评审|评分|审核|答辩|奖励|名额|赛道|组别|作品要求|比赛规则|竞赛内容|活动安排/.test(
        bodyText,
      )) ||
    // 附件标题本身写明赛事名与具体事项（如「数学竞赛延期通知.pdf」）时，
    // 也是可核对依据，不因为正文只有「详见附件」就降级。
    attachmentTitles.some((attachmentTitle) =>
      competitionPattern.test(attachmentTitle),
    );
  const classification: Classification =
    list || resultNotice || titleRecap || bodyAward || bodyNews
      ? "non_competition"
      : // 标题已明确是非赛事业务时，优先按标题判定：正文的赛事提及只作旁证，
        // 不能被 `excluded` 分支重新提升成疑似。附件写明赛事事项时不走这条。
        semanticNonCompetitionDecisive
        ? "non_competition"
        : excluded
          ? competition || ambiguous || attachmentTitles.length > 0
            ? "suspected"
            : "non_competition"
          : competition && titleDeclaresCompetition && hasCheckableArrangement
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
