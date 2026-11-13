import type {
  Article,
  CandidateFields,
  Directory,
  Evidence,
  ParsedCandidate,
} from "./types.js";
import { candidateFieldsContract, type TimeValue } from "./types.js";
import { classifyNotice } from "./classification.js";
const unknownTime = (): TimeValue => ({ precision: "unknown", value: null });

/** Section numbers carry no content; a heading alone cannot support a value. */
const headingPrefix =
  /^(?:[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|[一二三四五六七八九十\d]+\s*[、.．]|第\s*[一二三四五六七八九十\d]+\s*[章节条部分])\s*/;
/** A clause carries content; these markers mean the text is a sentence, not a heading. */
const clauseMarker = /须|应|需|不得|不可|可以|按|每|如|若|未|由|限/;
// Unnumbered lines are headings only when the whole line is a known section label.
// 「参赛对象及资格」「参赛人员及资格」「参赛对象及组队要求」等官方常见变体
// 若不识别，整段资格小节不会被读取，范围恒为未知。
const scopeLabel =
  /(?:参赛对象|参赛人员|参赛范围|参赛资格|报名对象)(?:及(?:其)?[^。；，,\n：:]{1,8})?/;
const sectionLabel = new RegExp(
  `^(?:参赛规则|竞赛规则|比赛规则|参赛要求|作品要求|组队要求|${scopeLabel.source}|报名方式|报名时间|报名须知|比赛时间|竞赛时间|时间安排|活动安排|奖项设置|联系方式)$`,
);
const isSectionHeading = (text: string) => {
  const body = text
    .replace(headingPrefix, "")
    .replace(/[：:\s]+$/, "")
    .trim();
  if (sectionLabel.test(body)) return true;
  // Other unnumbered short lines may be plain sentences; never drop them.
  if (!headingPrefix.test(text)) return false;
  if (!body || body.length > 20) return false;
  // A remaining colon separates a label from content in the same paragraph.
  if (/[。；;，,：:]/.test(body)) return false;
  if (clauseMarker.test(body)) return false;
  return true;
};
const rulesHeading = /参赛规则|竞赛规则|比赛规则|参赛要求|作品要求|组队要求/;
const attachmentRuleReference = (text: string) =>
  /^(?:具体(?:规则|要求)?)?(?:详见|参见|参考|见|请查阅|请查看|详细查看)\s*(?:通知附件|附件)[^。；;，,\n]*[。；;]?$/.test(
    text
      .replace(headingPrefix, "")
      .replace(
        /^(?:参赛规则|竞赛规则|比赛规则|参赛要求|作品要求|组队要求)\s*[：:]?\s*/,
        "",
      )
      .trim(),
  );
// 只识别资格标签或资格断言，避免“范围最广”“取消参赛资格”和拼接表头
// 被当成另一条允许范围，覆盖已明确的全校/学院资格。
const scopeHeading = new RegExp(
  `${scopeLabel.source}(?=\\s*(?:[：:]|为|是|包括|包含|面向|仅|只|限|须|需|应|不|$))`,
);
/** 表格里的列标签：整段只有资格标签，下一段也不是资格表述。 */
const bareScopeColumnLabel =
  /^(?:参赛对象|参赛人员|参赛范围|参赛资格|报名对象)$/;
const eligibilityWording =
  /学院|学校|全校|全体|学生|本科生|专科生|研究生|年级|专业|班级|校区|学籍|教师|教职工/;
/**
 * 表格被拆成单元格后，单独的「参赛对象」只是列标签，不是小节标题；
 * 若据此读取后续单元格，会把表头碎片当成允许范围。
 */
const isScopeColumnLabel = (text: string, next?: string) => {
  if (headingPrefix.test(text)) return false;
  if (!bareScopeColumnLabel.test(text.replace(/[：:\s]+$/, "").trim()))
    return false;
  return !eligibilityWording.test(next ?? "");
};
/** Clauses that describe another field; they must not shape a scope value. */
const isOtherFieldClause = (text: string) =>
  /个人赛|团队赛|团体赛|组队|赛道|比赛时间|竞赛时间|报名时间|截止|材料|作品提交|联系人|电话|地点/.test(
    text,
  );
/** Explicit eligibility restrictions also apply when a clause mentions another field. */
const scopeRestriction =
  /(?:仅|只允许|只限|限于)[^。；\n]{0,30}(?:学院|学校|学生|本科|研究生|年级|专业|校区|教师|教职工)/;
const exclusionMarker =
  /除[^。；\n]{0,20}(?:外|以外)|不含|不包括|不面向|禁止|排除|不接受|不招收|(?:不|禁止|不得|不可|不予|非)[^。；，,\n]{0,12}(?:参加|参加|报名|参赛|申报|申请|参与)/;

/**
 * 按名称长度降序掩掉已知学院全名，一个完整学院名只匹配一次，
 * 避免把「公共管理学院」的后缀再当作两个学院。
 */
function maskCollegeNames(
  text: string,
  colleges: Directory,
  mask: string,
): { masked: string; found: Set<string> } {
  const found = new Set<string>();
  for (const college of [...colleges].sort(
    (a, b) => b.name.length - a.name.length,
  )) {
    if (!text.includes(college.name)) continue;
    found.add(college.id);
    text = text.replaceAll(college.name, mask);
  }
  return { masked: text, found };
}

function mentionedColleges(text: string, colleges: Directory): Directory {
  const { found } = maskCollegeNames(text, colleges, "\0");
  return colleges.filter((college) => found.has(college.id));
}

/**
 * 「学院」本身常用作组织泛称（「由学院研管办负责」「该学院负责组织」「参赛学院初赛」
 * 「每个学院每个赛道」「按学院要求提交」），这些不是在点名某个未收录的学院。
 * 只把没有泛称限定词的「X学院」当作未知学院名，避免把已点名的学院降成 other。
 * 判定按后缀匹配，所以「所在」「参加」这类更长的词已被「在」「加」覆盖。
 */
const genericCollegeQualifiers = [
  "各",
  "每",
  "每个",
  "各个",
  "该",
  "本",
  "贵",
  "我",
  "你",
  "其",
  "此",
  "上述",
  "以上",
  "相关",
  "有关",
  "所属",
  "参赛",
  "报名",
  "全院",
  "全校",
  "学院",
  "二级",
  "基层",
  "对口",
  "目标",
  "接收",
  "推荐",
  "录取",
  "报考",
  "招生",
  "申请",
  "在读",
  "跨",
  "多个",
  "其他",
  "其余",
  "同一",
  "不同",
  "由",
  "在",
  "向",
  "至",
  "到",
  "经",
  "按",
  "与",
  "和",
  "得",
  "的",
  "了",
  "是",
  "为",
  "成",
  "进",
  "加",
  "组织",
  "负责",
  "通知",
  "要求",
  "初赛",
  "复赛",
  "决赛",
  "大赛",
  "赛事",
  "活动",
  "培养",
  "上级",
  "下级",
  "兄弟",
  "合作",
];
/** 学院名从不以连接词结尾；先剥掉紧贴的连接词再判泛称。 */
const trailingConnector = /[和及与或、]+$/;
/** 「X学院」是否为未收录的学院名；泛称（各学院、该学院、由学院）不算。 */
function hasUnknownCollege(text: string, directory: Directory) {
  const masked = maskCollegeNames(text, directory, "\u0000").masked;
  for (const match of masked.matchAll(/([\p{Script=Han}A-Za-z]{1,6})学院/gu)) {
    const qualifier = match[1].replace(trailingConnector, "");
    if (
      qualifier &&
      !genericCollegeQualifiers.some((word) => qualifier.endsWith(word))
    )
      return true;
  }
  return false;
}

interface SectionRead {
  parts: { text: string; index: number }[];
  /** Set when the section would continue into another source; the value cannot be trusted. */
  blockedBySource: boolean;
  blockedAt?: number;
}

/**
 * Read every paragraph belonging to a section heading, stopping at the next heading
 * so a section never swallows the following one. Each paragraph keeps its own
 * location, so no joined text is passed off as a single source.
 */
const sectionBody = (
  paragraphs: string[],
  index: number,
  barriers?: Set<number>,
): SectionRead => {
  const parts: { text: string; index: number }[] = [];
  let blockedBySource = false;
  for (let next = index + 1; next < paragraphs.length; next++) {
    if (barriers?.has(next - 1)) blockedBySource = true;
    const text = paragraphs[next]?.trim();
    if (!text) continue;
    if (isSectionHeading(text)) break;
    if (blockedBySource)
      return { parts, blockedBySource: true, blockedAt: next };
    parts.push({ text, index: next });
  }
  return { parts, blockedBySource };
};

const participantSubject =
  /参赛者|参赛队|参赛学生|参赛人员|参赛选手|选手|个人|团队|作者|学生本人|每人|每组|每队|报名者/;
const organizerNoun =
  /学院|学校|我校|教务处|团委|党委|承办|主办|组委会|评审|专家|组织方|工作小组|教育部/g;
const organizerAction =
  /汇总|审核|筛选|评审|评选|择优|统一|推荐|上报|遴选|把关|报送|提交|递交|上交/;
const collectiveAction =
  /(?:汇总|审核|筛选|评审|评选|择优|统一|推荐|上报|遴选)[^。；\n]{0,12}(?:报送|提交|上报|递交)/;
const isMaterialClause = (text: string) =>
  /材料|作品|论文/.test(text) && /提交|报送|截止/.test(text);
const materialWindow =
  /(?:20\d{2}\s*[年./-]\s*)?\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?(?:\s*\d{1,2}[:：时]\d{2}\s*分?)?\s*(?:至|到|[-—–~～－])\s*(?:20\d{2}\s*[年./-]\s*)?\d{1,2}\s*[月./-]\s*\d{1,2}/;
const organizerMaterialReason =
  "materialsAt 主体为院校审核或报送，不能作为参赛者材料截止";

/**
 * Material deadlines belong to whoever must act: applicants submit, while colleges
 * aggregate, review and forward. A forwarding duty is not the applicant deadline.
 * A submission verb or deadline label alone does not identify the actor.
 */
const materialsActor = (clause: string): "participant" | "organizer" | null => {
  const participantAt = clause.search(participantSubject);
  for (const match of clause.matchAll(organizerNoun)) {
    // Include the name before "学院" in e.g. "向理学院", but not a preceding action.
    const recipient = /(?:向|至|到|交给|送交)([\p{Script=Han}\s]{0,20})$/u.exec(
      clause.slice(0, match.index),
    );
    if (recipient && !organizerAction.test(recipient[1])) continue;
    const after = clause.slice(match.index + match[0].length);
    const actionAt = after.search(organizerAction);
    const nextParticipantAt = after.search(participantSubject);
    if (
      actionAt >= 0 &&
      actionAt <= 16 &&
      !/[。；\n]/.test(after.slice(0, actionAt)) &&
      (nextParticipantAt === -1 || nextParticipantAt > actionAt)
    )
      return "organizer";
  }
  if (collectiveAction.test(clause) && participantAt === -1) return "organizer";
  if (participantAt !== -1) return "participant";
  return null;
};

export function extractDates(text: string, year: string | null): TimeValue[] {
  const result: TimeValue[] = [];
  const pattern =
    /(?<!\d)(?:(20\d{2})\s*[年./-]\s*)?(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：时](\d{2})\s*分?)?(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const yyyy = match[1] ?? year;
    if (!yyyy) continue;
    const date = `${yyyy}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const parsedDate = new Date(date + "T00:00:00Z");
    if (
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    )
      continue;
    if (match[4] === undefined) result.push({ precision: "date", value: date });
    else {
      const hours = Number(match[4]),
        minutes = Number(match[5]);
      if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0))
        continue;
      const value =
        hours === 24
          ? new Date(
              Date.parse(date + "T00:00:00+08:00") + 86400000,
            ).toISOString()
          : `${date}T${match[4].padStart(2, "0")}:${match[5]}:00+08:00`;
      result.push({ precision: "instant", value });
    }
  }
  return result;
}

/**
 * 赛事名：只剥离可确认的通知套语（前缀「关于举办／开展／组织参加」与后缀
 * 「的通知／预通知」）。保留发文单位、年份届次、校内选拔赛与子赛道，避免把
 * 不同比赛合并成同名。剥离后为空或只剩套语时回退标题原文。
 */
const noticeTitlePrefix = /^关于(?:举办|举行|开展|组织参加)/;
/**
 * 发文单位前缀（「食品学院关于举办…」）只去掉「关于举办」，单位本身保留：
 * 单位是否为赛事名组成部分无法可靠区分，删掉可能把不同单位的同名赛事合并。
 */
const issuingUnitPrefix = /^(.{2,30}?)关于(?:举办|举行|开展|组织参加)/;
const noticeTitleSuffix =
  /(?:的)?(?:报名通知|参赛通知|预通知|补充通知|变更通知|更正通知|通知)$/;
export function competitionName(title: string): string {
  const original = title.trim();
  let value = original;
  for (let round = 0; round < 3; round++) {
    const next = value
      // 有发文单位时只剥掉「关于举办」，单位保留。
      .replace(issuingUnitPrefix, "$1")
      .replace(noticeTitlePrefix, "")
      .replace(noticeTitleSuffix, "")
      .trim();
    if (next === value) break;
    value = next;
  }
  // 只剩套语或标点时不能用被清空的名称。
  return value.replace(/[\s\p{P}\p{S}]/gu, "").length ? value : original;
}

/**
 * 赛事种类／项目类型的显式标注。显式标注只是来源条件，取值还要过语义边界：
 * 选拔层级、赛段、组别、届次与通知种类都不是赛事种类。
 */
const eventKindLabel =
  /(?:赛事种类|竞赛类型|比赛类型|赛事类别|项目类型|竞赛类别|比赛类别)\s*[：:]\s*([^。；\n]{1,40})/;
/** 选拔层级与赛段：描述比赛进行到哪一步，不是种类。 */
const kindLevelOnly =
  /(?:选拔赛|选拔|初赛|复赛|决赛|预赛|半决赛|院赛|校赛|省赛|国赛|网评|路演)$|(?:院级|校级|省级|国家级|市级|校内|院内)(?:选拔|赛)/;
/** 组别与人群：描述谁能参加，不是种类。 */
const kindGroupOnly =
  /(?:组|组别)$|^(?:新生|老生|研究生|本科生|专科生|教师|教职工|专业|年级|班级)/;
/** 通知种类词不得混入赛事种类。 */
const kindNotificationOnly =
  /^(?:报名|补充|变更|延期|更正|获奖|公示|新闻|回顾)/;
const kindNoun =
  /竞赛|比赛|大赛|项目|活动|挑战杯|艺术|体育|创新|创业|职业|技能|学术|科技|学科|征文|设计/;
/**
 * 判断一个显式标注值能否作为赛事种类。返回 null 表示可用，否则给出拒绝原因。
 * 拿不准时不猜：宁可 unknown，也不把层级或组别当成种类。
 */
export function eventKindRejection(value: string): string | null {
  const annotations = [...value.matchAll(/[（(]([^()（）]+)[）)]/g)].map(
    (match) => match[1].trim(),
  );
  if (kindNotificationOnly.test(value)) return "通知种类不是赛事种类";
  if (
    kindLevelOnly.test(value) ||
    annotations.some((part) => kindLevelOnly.test(part))
  )
    return "选拔层级或赛段不是赛事种类";
  if (
    kindGroupOnly.test(value) ||
    annotations.some((part) => kindGroupOnly.test(part))
  )
    return "组别或人群不是赛事种类";
  if (!kindNoun.test(value)) return "无赛事种类依据";
  return null;
}
export function competitionKind(paragraphs: string[]): {
  value: string | null;
  paragraph: number;
  rejection: string | null;
} {
  for (let index = 0; index < paragraphs.length; index++) {
    const match = eventKindLabel.exec(paragraphs[index] ?? "");
    const value = match?.[1]?.trim().replace(/[，,、；;]$/, "");
    if (!value) continue;
    const rejection = eventKindRejection(value);
    if (rejection) return { value: null, paragraph: index, rejection };
    return { value, paragraph: index, rejection: null };
  }
  return { value: null, paragraph: -1, rejection: null };
}

/**
 * 参赛形式判定。mode 始终是原文片段，不改写措辞；否定与肯定分别判断作用范围，
 * 同一句里同时允许个人与团队才算 mixed，跨句互不覆盖或相互矛盾时保留冲突。
 */
const modeLabel =
  /^(?:参赛形式|参赛方式|比赛形式|竞赛形式|组队形式)\s*(?:[：:]|为|是)\s*/;
/** 可选其一的并列词；只有它们才把「个人 + 团队」解释为两者皆可。 */
const alternativeMarker = /或|及|和|以及|均可|皆可|任一|任选/;
/** 否定标记；用于判断与它相邻的形式是否被否定。 */
const negationMarker =
  /禁止|不得|不能|不可以|不可|不予|不允许|不接受|不准|非|不/;
/** 赛段限定；同一形式出现在不同赛段时不能合并。 */
const stageMarker = /初赛|复赛|决赛|预赛|半决赛|院赛|校赛|省赛|国赛/g;

/** 提交、报送、命名与物流说明属于报名或材料字段，不得作为参赛形式原文。 */
const submissionClause =
  /报名表|提交|报送|邮箱|发送|上传|交至|交到|递交|命名|填写|邮寄|纸质档|电子档|个工作日/;
/** 队长、领队与联络职责是组织分工，不是参赛形式。「负责人」可能是人数括注，不计入。 */
const dutyClause = /队长|领队|带队|工作人员|职责|事宜/;
/** 一句里出现报名/提交/职责说明时，其余片段必须自己说明参赛形式才算形式原文。 */
const participantVocabulary =
  /个人|团队|队伍|组队|集体|参赛|参加|报名|每组|每队|每人|每班/;
/** 纪律处分与条件后果句描述的是违规后果，不是参赛形式。 */
const conditionalModeClause =
  /否则|违规|违纪|纪律|处分|取消[^。；，,]{0,10}资格|追究|通报批评/;
/**
 * 剥离同一子句里的纪律后果，保留其前的形式声明：
 * 「参赛形式：以团队形式参赛，否则取消参赛资格」只有一个句号，整句排除会
 * 丢掉有效形式。后果从「否则／逾期／违规／取消…资格」一类标记处截断，
 * 标记必须在形式片段之后；截断后没有形式依据即返回 null，不虚构形式。
 *
 * 后果也可能在前（「违规者取消参赛资格，参赛形式为团队」）：整句不能因为
 * 后果标记就丢弃，改为按逗号切段、只留能独立表达形式的那几段。
 */
function stripConditionalConsequence(sentence: string): string | null {
  // 形式声明的位置：优先取「参赛形式／组队形式」标签，其次取第一处形式短语。
  // 不能用任意「参赛」的位置——「取消参赛资格」里的「参赛」会把起点推到后果词之后。
  const labelAt = sentence.search(modeLabel);
  // 「参赛形式」标签可能出现在后半句；substring 搜索要单独做，不能用带 ^ 的 modeLabel。
  const labelAnywhere = sentence.search(
    /(?:参赛形式|参赛方式|比赛形式|竞赛形式|组队形式)\s*(?:[：:]|为|是)/,
  );
  const formAt =
    labelAt >= 0
      ? labelAt
      : labelAnywhere >= 0
        ? labelAnywhere
        : sentence.search(
            /以(?:个人|团队)|个人赛|团队赛|团体赛|组队|集体作品|个人作品|每班/,
          );
  if (formAt < 0) return null;
  const markers = [
    ...sentence.matchAll(
      /否则|违规|违纪|纪律|处分|追究|通报批评|逾期|取消[^。；，,]{0,10}资格/g,
    ),
  ];
  // 形式声明在后果之后（「违规者取消参赛资格，参赛形式为团队」）时，前面那段
  // 后果与形式无关，直接按子句挑出形式段，而不是从后果处截断。
  const consequenceFirst = markers.some((match) => (match.index ?? 0) < formAt);
  if (consequenceFirst) {
    const forms = sentence
      .split(/[，,；;]/)
      .map((part) =>
        part
          .trim()
          .replace(/[。；;\n]+$/u, "")
          .trim(),
      )
      .filter(
        (part) =>
          part &&
          !conditionalModeClause.test(part) &&
          readModeMention(part, modeLabel.test(part)),
      );
    return forms.length ? forms.join("，") : null;
  }
  const cut = markers.find((match) => (match.index ?? 0) > formAt);
  if (cut) {
    // 截断点前的原文可能以逗号/分号/冒号结尾；它们不是形式原文的一部分。
    // 只保留能独立表达形式的前段，避免把半句后果或残留标点写进 mode。
    const head = sentence.slice(0, cut.index);
    const pieces = head
      .split(/[，,；;]/)
      .map((part) => part.trim())
      .filter((part) => part && readModeMention(part, modeLabel.test(part)));
    const candidate = pieces.length ? pieces.join("，") : head.trim();
    const normalized = candidate.replace(/[\s，,、；;：:]+$/u, "").trim();
    return normalized && readModeMention(normalized, modeLabel.test(normalized))
      ? normalized
      : null;
  }
  // 没有「形式在前」的后果：可能是「违规者取消参赛资格，参赛形式为团队」。
  // 只要整句确属后果句，就按子句挑出能独立表达形式的部分；挑不出才返回 null。
  if (!conditionalModeClause.test(sentence)) return null;
  const forms = sentence
    .split(/[，,；;]/)
    .map((part) =>
      part
        .trim()
        .replace(/[。；;\n]+$/u, "")
        .trim(),
    )
    .filter(
      (part) =>
        part &&
        !conditionalModeClause.test(part) &&
        readModeMention(part, modeLabel.test(part)),
    );
  return forms.length ? forms.join("，") : null;
}

interface ModeMention {
  individual: boolean;
  team: boolean;
  negated: boolean;
  alternative: boolean;
  stages: string[];
  /** 该子句里被显式否定的形式；只否定点名的形式，不牵连其他形式。 */
  deniesIndividual: boolean;
  deniesTeam: boolean;
}

const individualForm =
  /个人赛|个人参赛|以个人|个人作品|个人形式|个人项目|个人身份|个人/;
const teamForm =
  /团队赛|以团队|团体赛|以组为单位|每组\s*\d+人|组队|团队形式|队伍|团队|一队|每队|每班[^。；\n]{0,10}队|集体作品|集体参赛|集体项目|小组参赛/;

/**
 * 只把直接禁止参赛形式的表达作为否定依据。人数、教师数量、跨学院等
 * 限制不能因临近「团队」就变成禁止团队；「不限」表达放开而不是否定。
 */
function readModeMention(clause: string, labelled = false): ModeMention | null {
  // 「个人/团队」本身不声明参赛形式。必须有直接的参赛关系、形式标签，
  // 或能独立表达形式的条款；赛事标题不能给所有普通个人事务提供语境。
  if (
    !labelled &&
    !/参赛|以(?:个人|团队)(?:形式|身份)?参加|个人赛|团队赛|团体赛|(?:团队|队伍)人数|以组为单位|每组\s*\d+人|每班[^。；\n]{0,10}队|个人(?:或|及|和|以及)(?:自行)?(?:团队|组队)|个人作品或集体作品|集体作品或个人作品/.test(
      clause,
    )
  )
    return null;
  const labelledValue = clause.replace(modeLabel, "").trim();
  const pairedForms = /个人(?:或|及|和|以及)(?:自行)?(?:团队|组队)/.test(
    clause,
  );
  const individual =
    /个人赛|个人参赛|以个人(?:形式|身份|名义)?(?:参赛|参加)|个人(?:形式|身份)(?:报名|参赛)|个人作品|个人项目|(?:以)?个人名义(?:参赛|参加|报名)/.test(
      clause,
    ) ||
    pairedForms ||
    (labelled &&
      /^(?:以)?个人(?:形式|身份)?(?=或|及|和|均|皆|[，,。；;]|$)/.test(
        labelledValue,
      ));
  const team =
    /团队赛|团体赛|(?:以)?团队(?:形式)?(?:参赛|参加)|以组为单位|每组\s*\d+人|组队|团队形式|队伍参赛|(?:团队|队伍)人数|每班[^。；\n]{0,10}队|集体作品|集体参赛|集体项目|小组参赛/.test(
      clause,
    ) ||
    pairedForms ||
    (labelled &&
      /^(?:以)?团队(?=或|及|和|均|皆|[，,。；;]|$)/.test(labelledValue));
  if (!individual && !team) return null;
  const interpretation = clause.replace(/不限(?:于)?|不限制/g, "允许");
  const form = `(?:${individualForm.source}|${teamForm.source})`;
  const joinedForms = `${form}(?:\\s*(?:或|及|和|以及)\\s*(?:以)?${form})*`;
  const directNegation = new RegExp(
    `(?:${negationMarker.source})(?:以|采用|进行)?${joinedForms}`,
    "g",
  );
  const deniedAfterForm = new RegExp(
    `${joinedForms}\\s*(?:均|都|皆)?(?:${negationMarker.source})(?:报名|参赛|参与|参加|提交|报送|申报)`,
    "g",
  );
  let deniesIndividual = false;
  let deniesTeam = false;
  for (const match of [
    ...interpretation.matchAll(directNegation),
    ...interpretation.matchAll(deniedAfterForm),
  ]) {
    deniesIndividual ||= individualForm.test(match[0]);
    deniesTeam ||= teamForm.test(match[0]);
  }
  const negated = deniesIndividual || deniesTeam;
  return {
    individual,
    team,
    negated,
    alternative: alternativeMarker.test(clause),
    stages: [...new Set(clause.match(stageMarker) ?? [])],
    deniesIndividual,
    deniesTeam,
  };
}
export function competitionMode(text: string): {
  mode: string | null;
  modeKind: "individual" | "team" | "mixed" | null;
  /** 无法可靠归一时的人工可读原因；mode 仍保留原文。 */
  conflict: string | null;
} {
  const input = text.trim();
  if (!input) return { mode: null, modeKind: null, conflict: null };
  const sentences = input.match(/[^。；;\n]+[。；;\n]*/g) ?? [];
  // 纪律后果只在自己的子句范围内失效：同一句里「形式声明，否则…」先按后果
  // 截断，保留前面的形式原文；整句都不含形式时仍然不提取。
  //
  // 句末标点策略：句号是原文的一部分，mode 保留（既有契约）；
  // 分号/换行是「被切开的并列子句」，若它后面还有子句，说明这句只是前半句，
  // 不能把切句残留的分号写进 mode。
  const relevant = sentences.flatMap((sentence, index) => {
    const trimmed = sentence.trim();
    if (!trimmed) return [];
    const hasFollowingClause = index < sentences.length - 1;
    const content = (
      hasFollowingClause ? trimmed.replace(/[；;\n]+$/u, "") : trimmed
    ).trim();
    if (!content) return [];
    // 小节标题本身含「参赛/组队」字样，但不是形式原文。
    if (isSectionHeading(content)) return [];
    if (!conditionalModeClause.test(content))
      return readModeMention(content, modeLabel.test(content)) ? [content] : [];
    const kept = stripConditionalConsequence(content);
    return kept ? [kept] : [];
  });
  const original = relevant.join("").trim();
  if (!original) return { mode: null, modeKind: null, conflict: null };
  let removedOtherField = false;
  const phrases = relevant.map((sentence) => {
    const parts = sentence.split(/[，,]/);
    const kept = parts
      .map((part) => {
        // 报名表、提交、命名、交送与队长职责属于报名或材料字段，本身不声明
        // 参赛形式；同片段里用「并/且/同时」把形式与提交说明连在一起时只
        // 留下形式那一段（「以团队形式参赛并提交报名表」→「以团队形式参赛」）。
        if (submissionClause.test(part) || dutyClause.test(part))
          return part
            .split(/并|且|同时/)
            .map((piece) => piece.trim())
            .find(
              (piece) =>
                !!piece &&
                !!readModeMention(piece, modeLabel.test(piece)) &&
                !submissionClause.test(piece) &&
                !dutyClause.test(piece),
            );
        const otherField =
          /报名(?:表|时间|截止|信息)|提交|报送|邮箱|评分|赋分|逾期|截止/.test(
            part,
          );
        const form = readModeMention(part, modeLabel.test(part.trim()));
        const formDenial =
          /(?:不|不得|不可|禁止)[^。；]{0,12}(?:个人|团队|组队)/.test(part);
        return !otherField || form || formDenial ? part : null;
      })
      .filter((part): part is string => !!part);
    const keptText = kept.join("\n").trim();
    const unchanged =
      kept.length === parts.length && keptText === parts.join("\n").trim();
    if (unchanged) return sentence;
    removedOtherField = true;
    return keptText;
  });
  // 形式归一仍看完整肯定/否定语境；展示值只移除明确属于其他字段的原文子句。
  const joined = phrases.filter(Boolean).join("\n").trim();
  // 过滤把句子削到只剩「。」或不含任何参赛措辞时，说明本句只剩报名说明，
  // 不能拿残句充当参赛形式原文。
  const displayMode = removedOtherField
    ? participantVocabulary.test(joined)
      ? joined
      : null
    : original;
  const labelled = modeLabel.test(original);
  const body = original.replace(modeLabel, "").trim() || original;
  // 逐子句判断：句号分号按句拆，逗号两侧各自都能独立判定形式时才拆开，
  // 否则「独立参赛，不组队」会被切断成互不相关的两截。
  const clauses = body
    .split(/[。；;\n]/)
    .flatMap((sentence) => {
      const parts = sentence.split(/[，,]/).map((part) => part.trim());
      if (parts.length < 2) return [sentence.trim()];
      return parts.every((part) => readModeMention(part, labelled))
        ? parts
        : [sentence.trim()];
    })
    .filter(Boolean);
  const mentions = clauses
    .map((clause) => readModeMention(clause, labelled))
    .filter((mention): mention is ModeMention => !!mention);
  if (!mentions.length) return { mode: null, modeKind: null, conflict: null };

  // 同一子句可同时保留个人并禁止组队，不能因此丢掉未被否定的形式。
  const affirmed = mentions.filter(
    (mention) =>
      (mention.individual && !mention.deniesIndividual) ||
      (mention.team && !mention.deniesTeam),
  );
  const denied = mentions.filter((mention) => mention.negated);
  // 后置否定只抵消它点名的形式，不把已确认的形式一并推翻。
  const deniesIndividual = denied.some((mention) => mention.deniesIndividual);
  const deniesTeam = denied.some((mention) => mention.deniesTeam);
  const individualAffirmed =
    affirmed.some((mention) => mention.individual) && !deniesIndividual;
  const teamAffirmed = affirmed.some((mention) => mention.team) && !deniesTeam;
  // 同一子句里用并列词同时给出两种形式，才是可选其一。
  const mixedInOneClause = affirmed.some(
    (mention) =>
      mention.individual &&
      mention.team &&
      mention.alternative &&
      !deniesIndividual &&
      !deniesTeam,
  );
  const stages = new Set(affirmed.flatMap((mention) => mention.stages));
  const stageForms = new Set(
    affirmed.map((mention) =>
      JSON.stringify([
        mention.individual && !mention.deniesIndividual,
        mention.team && !mention.deniesTeam,
      ]),
    ),
  );

  if (stages.size > 1 && stageForms.size > 1)
    return {
      mode: displayMode,
      modeKind: null,
      conflict: "参赛形式按赛段分别规定，不能合并为单一形式",
    };
  if (!individualAffirmed && !teamAffirmed)
    return {
      mode: displayMode,
      modeKind: null,
      conflict: "参赛形式被否定，未形成可归一形式",
    };
  if (mixedInOneClause && individualAffirmed && teamAffirmed)
    return { mode: displayMode, modeKind: "mixed", conflict: null };
  // 跨子句同时肯定两种互不覆盖的要求，属矛盾而非可选。
  if (individualAffirmed && teamAffirmed)
    return {
      mode: displayMode,
      modeKind: null,
      conflict: "参赛形式存在互不覆盖的要求，须人工核对",
    };
  return {
    mode: displayMode,
    modeKind: individualAffirmed ? "individual" : "team",
    conflict: null,
  };
}

/** 新候选的空字段基线；非赛事等分支复用同一份字面量，避免多处漂移。 */
export const emptyCandidateFields = (scopeNote: string): CandidateFields => ({
  name: "",
  edition: null,
  eventKind: null,
  organizer: null,
  hosts: [],
  scope: { kind: "unknown", colleges: [], note: scopeNote },
  mode: null,
  modeKind: null,
  tracks: [],
  members: null,
  rules: [],
  stageNames: [],
  startsAt: unknownTime(),
  deadline: unknownTime(),
  materialsAt: unknownTime(),
  eventAt: unknownTime(),
});

/** 非赛事通知的空字段基线；runner、store 与证据解析共用同一份结论。 */
function isNonCompetition(article: Article) {
  const classification = classifyNotice(
    article.title,
    article.paragraphs,
    article.attachments.map((attachment) => attachment.title),
  );
  return classification.classification === "non_competition"
    ? classification
    : null;
}

/**
 * 非赛事通知的候选基线：空比赛字段 + 说明，供各入口复用。
 * `classification` 必须来自裁剪前的原文，不能由已裁剪的空正文重新推断。
 */
export function nonCompetitionCandidate(
  classification: ParsedCandidate["classification"],
): ParsedCandidate {
  return {
    classification,
    fieldsContract: candidateFieldsContract,
    fields: emptyCandidateFields("非赛事通知，不自动提取参赛范围"),
    evidence: [],
    fieldConflicts: [],
    missing: [],
    conflicts: [],
    warnings: ["非赛事通知不自动生成比赛字段，原文仍可人工核对"],
  };
}

export interface ParseCandidateOptions {
  /**
   * 通知种类不再写入候选字段；唯一来源是 classifyNotice 返回的
   * classification.notificationKind。未传入时只在内部按标题推断，用于
   * 「新闻／获奖不证明报名开放」这一条守卫，不写入 fields。
   */
  notificationKind?: string;
  /** Paragraph gaps where consecutive text belongs to different sources; never joined. */
  sourceBarriers?: Set<number>;
  /**
   * 已知分类结果（来自裁剪前的原文）。store 在非赛事分支会先清空正文再解析，
   * 只按标题重新分类可能把「…获奖新闻」判回 suspected 并再次生成比赛名，
   * 因此允许调用方传入已确认的分类，禁止用裁剪后的正文反推。
   */
  classification?: ParsedCandidate["classification"];
}

export function parseCandidate(
  article: Article,
  url: string,
  directory: Directory,
  options: ParseCandidateOptions = {},
): ParsedCandidate {
  const { notificationKind, sourceBarriers, classification: known } = options;
  // 非赛事通知由标题／年份生成比赛名称或届次，是离线入口与入库入口不一致的根因：
  // runner 调 parseCandidate、store 裁剪正文后再次调它，两条真实路径都拿不到
  // classification。基线判据必须下沉到这里，用同一份分类规则，而不是让调用方
  // 各自记得先分类。标题与发布日期仍由调用方保存在通知元数据里。
  const nonCompetition =
    known?.classification === "non_competition"
      ? known
      : isNonCompetition(article);
  if (nonCompetition) return nonCompetitionCandidate(nonCompetition);
  const evidence: Evidence[] = [
    { field: "name", excerpt: article.title, paragraph: -1, url },
  ];
  const missing: string[] = [],
    conflicts: string[] = [],
    warnings: string[] = [];
  /** 一旦参赛形式互不覆盖，就不再声称已可靠归一。 */
  let modeConflict = false;
  const years = [
    ...new Set(
      (article.title + "\n" + article.text).match(
        /20\d{2}(?=年|届|[.\-/]\d)/g,
      ) ?? [],
    ),
  ];
  const titleYear = /20\d{2}(?=年|届)/.exec(article.title)?.[0] ?? null;
  if (years.length > 1)
    conflicts.push(
      "年份冲突：" + years.join("、") + "；须区分届次、赛段和引用年份",
    );
  const eventKind = competitionKind(article.paragraphs);
  // 只有标题、没有可读正文时，标题不构成赛事名依据：标题里「关于…的通知」
  // 这类套语既可能是赛事也可能是任免、转正公示、开题报告。分类只能给出
  // 「疑似」，此时按标题切片编出赛事名会把非赛事通知伪装成已抽取结果。
  // 届次同理——年份来自标题而正文为空时不足以确定届次。
  const titleOnly = article.text.trim().length === 0;
  const fields: CandidateFields = {
    ...emptyCandidateFields(
      titleOnly ? "正文为空，仅凭标题不足以确定参赛范围" : "参赛范围待核对",
    ),
    // 契约里 name 是非空字符串；空正文时留空串表示「未提取」，而不是回退标题
    // 原文——后者会让任免、转正公示、开题报告这类通知看起来已有赛事名。
    name: titleOnly ? "" : competitionName(article.title),
    edition: titleOnly ? null : years.length <= 1 ? titleYear : null,
    eventKind: eventKind.value,
  };
  if (titleOnly)
    warnings.push(
      "正文为空，只有标题：不按标题生成赛事名与届次，原文仍可人工核对",
    );
  if (eventKind.value)
    evidence.push({
      field: "eventKind",
      excerpt: eventKind.value,
      paragraph: eventKind.paragraph,
      url,
    });
  else if (eventKind.rejection)
    // 显式标注存在但取值不属赛事种类：保留原文与原因，不写入字段。
    warnings.push("赛事种类标注被拒绝：" + eventKind.rejection);
  if (fields.edition)
    evidence.push({
      field: "edition",
      excerpt: article.title,
      paragraph: -1,
      url,
    });
  const add = (field: string, excerpt: string, paragraph: number) =>
    evidence.push({ field, excerpt, paragraph, url });
  const addRule = (text: string, paragraph: number) => {
    if (attachmentRuleReference(text)) {
      warnings.push("规则仅指向附件，未作为已提取正文规则");
      return;
    }
    fields.rules.push(text);
    add("rules", text, paragraph);
  };
  const addBlockedSectionEvidence = (
    field: "scope" | "rules",
    index: number,
    section: SectionRead,
  ) => {
    add(field, article.paragraphs[index], index);
    for (const part of section.parts) add(field, part.text, part.index);
    if (section.blockedAt !== undefined)
      add(field, article.paragraphs[section.blockedAt], section.blockedAt);
  };
  /**
   * 协议 3.3 的 scope：all / specified / other / unknown。
   * 否定、排除、禁入与未知学院一律不写入 colleges——它们是限制，不是允许范围。
   * 有明确限制但无法枚举成学院列表时用 other 并保留原文；有依据但无法判断范围
   * 之外的空白情形由调用方给 unknown。
   */
  const readScope = (
    text: string,
    colleges: Directory,
  ): {
    kind: "all" | "specified" | "other" | "unknown";
    colleges: string[];
    note: string;
    unresolvedCollege: boolean;
  } => {
    // 主办／承办／负责组织是组织关系，只说明谁干活，不说明谁可以参赛。
    // 明示全校时若把组织学院留在资格子句里，collegeNamed 会关掉全校语义，
    // 把「全校学生，理学院负责组织」错误收窄为 specified。
    const organizerRelation =
      /^(?:由|经)?[^。；，,\n]{0,20}?(?:学院|系|部|处|办公室|中心|团委|组委会|委员会)(?:负责|具体负责|统一负责|参与)?(?:组织|主办|承办|协办|汇总|安排|开展|实施|落实|推进|负责)[^。；，,\n]{0,12}$/;
    /**
     * 组织关系句里允许出现「组织学生参赛」「组织报名」「参与组织」等措辞：
     * 它们的主语仍是组织方，描述谁去动员，不构成参赛资格。因此先把这些
     * 组织动词后的对象短语剥掉，再判断是否含资格收窄措辞。
     */
    const organizerObjectPhrase =
      /(?:组织|动员|召集|通知|安排)(?:学生|同学|人员|参赛者|参赛人员|报名)?(?:参赛|参加|报名|参与)?/g;
    // 含参赛/资格措辞的子句可能在说参赛者，不能当纯组织关系剥掉；
    // 含否定或排除的子句更不是组织关系（「生命科学学院不接受报名」）。
    const eligibilityMarker =
      /仅|只|限|除外|不含|不接受|禁止|排除|不得|不可|不能|不予|除|非|均可|可参加|面向|对象|资格|范围/;
    const isOrganizerOnly = (clause: string) =>
      !eligibilityMarker.test(clause.replace(organizerObjectPhrase, "")) &&
      organizerRelation.test(clause);
    const stripOrganizerRelations = (value: string) =>
      value
        .replace(/[（(][^（()）]*[）)]/g, (inner) =>
          isOrganizerOnly(inner.trim()) ? "" : inner,
        )
        .split(/[，,。；;\n]/)
        .filter(
          (clause) =>
            !/^(?:主办|承办)(?:单位|学院)?\s*(?:[：:]|为|是)/.test(
              clause.trim(),
            ) &&
            !/^[^：:]{0,40}学院(?:(?:负责)?(?:主办|承办)|(?:为|是)(?:主办|承办)单位)$/.test(
              clause.trim(),
            ) &&
            !isOrganizerOnly(clause.trim()),
        )
        .join("；");
    const qualification = stripOrganizerRelations(text);
    const matched = mentionedColleges(qualification, colleges).map((c) => c.id);
    const unresolvedCollege = hasUnknownCollege(qualification, colleges);
    // 「不限」「不受…限制」是放开语义，不构成收窄。
    const qualifiedWithoutUnlimited = qualification.replace(
      /不限|不受[^。；，,]{0,20}限制/g,
      "",
    );
    // 身份核验、材料不全、逾期一类条件后果句不是群体资格排除，先剥掉括注、
    // 再测排除词；否则「身份不明者不可参加比赛」会把理学院学生降为 other。
    const identityCondition =
      /身份不明|资格不符|不符合|材料不全|证件不全|冒名|弄虚作假|舞弊|逾期|未按时|违反[^。；]{0,10}规定|纪律/;
    const conditionsStripped = qualifiedWithoutUnlimited.replace(
      /[（(][^（()）]*[）)]/g,
      (inner) => (identityCondition.test(inner) ? "" : inner),
    );
    const conditionalConsequence =
      /(?:者|人员|学生|选手|队伍)?(?:不合条件|身份不明|材料不全|资格不符|逾期)[^。；，,]{0,12}(?:不得|不可|不予|取消)/;
    const excluded = exclusionMarker.test(
      conditionsStripped.replace(conditionalConsequence, ""),
    );
    // 明示全校的措辞先用子句级短语判，再回退到原来的整体判断；
    // 含已知学院名的子句（「四川农业大学食品学院本科生」）不当作全校，
    // 相对指代（「我院/本院/该院/本学院」）也不能当作明示全校。
    const allScopePhrase =
      /全校|全体在校|所有在校|(?:我校|四川农业大学)[^。；，,\n]{0,10}?(?:本科生|专科生|研究生|在校生|学生)|(?:具有|拥有)四川农业大学(?:正式)?学籍/;
    const relativeCollegeReference = /我院|本院|该院|贵院|本学院|全学院/;
    const collegeNamed = colleges.some((college) =>
      qualification.includes(college.name),
    );
    const allPhrase =
      !collegeNamed &&
      !relativeCollegeReference.test(qualification) &&
      allScopePhrase.test(qualification);
    const narrowed = /仅|限|除|不含|校区/.test(conditionsStripped);
    const other = (note: string) => ({
      kind: "other" as const,
      colleges: [],
      note,
      unresolvedCollege,
    });
    if (unresolvedCollege || excluded) return other(text);
    // 年级／专业／班级属于人群口径，不因此把已命中的学院降级。
    if (allPhrase && !narrowed && !matched.length)
      return { kind: "all", colleges: [], note: text, unresolvedCollege };
    if (matched.length && !allPhrase)
      return {
        kind: "specified",
        colleges: matched,
        note: text,
        unresolvedCollege,
      };
    if (allPhrase) return other(text);
    // 看不到任何范围表述：无从断言，保持未知而不是猜成全校。
    if (
      !/学院|全校|全校师生|师生|学生|本科生|研究生|年级|专业|班级|校区/.test(
        qualification,
      )
    )
      return {
        kind: "unknown",
        colleges: [],
        note: "参赛范围待核对",
        unresolvedCollege,
      };
    return other(text);
  };
  article.paragraphs.forEach((paragraph, index) => {
    for (const college of mentionedColleges(paragraph, directory)) {
      if (
        paragraph.includes(college.name) &&
        (new RegExp(college.name + "[^。；]{0,20}承办").test(paragraph) ||
          new RegExp(
            "承办(?:单位)?[：:]\\s*(?:四川农业大学)?" + college.name,
          ).test(paragraph))
      ) {
        if (!fields.hosts.includes(college.id)) fields.hosts.push(college.id);
        add("hosts", paragraph, index);
      }
    }
    if (
      /承办/.test(paragraph) &&
      (hasUnknownCollege(paragraph, directory) ||
        !directory.some((c) => paragraph.includes(c.name)))
    )
      warnings.push("承办单位尚未匹配学院目录，待核对");
    if (/主办(?:单位)?[：:]|由[^。；]*主办/.test(paragraph)) {
      const organizerText =
        /主办(?:单位)?[：:]\s*([^。；]+)/.exec(paragraph)?.[1] ??
        /由([^。；]+?)主办/.exec(paragraph)?.[1];
      const mainOrganizers = organizerText?.replace(
        /^.*(?:指导|支持|协办)[，,]\s*/,
        "",
      );
      const nextLabel =
        mainOrganizers?.search(
          /(?:承办|协办|指导|支持|发布|参赛|报名|比赛时间|竞赛时间|活动目的|活动对象|活动安排)(?:单位|学院|对象|范围|资格)?[：:]/,
        ) ?? -1;
      const organizer = mainOrganizers
        ?.slice(0, nextLabel < 0 ? undefined : nextLabel)
        .replace(/[，,\s]+$/, "")
        .trim();
      if (organizer) {
        if (fields.organizer && fields.organizer !== organizer.trim()) {
          conflicts.push("主办单位有多个表述，待核对");
          fields.organizer = null;
        } else if (!conflicts.includes("主办单位有多个表述，待核对"))
          fields.organizer = organizer;
        add("organizer", paragraph, index);
      }
    }
    if (
      scopeHeading.test(paragraph) &&
      !isScopeColumnLabel(paragraph, article.paragraphs[index + 1])
    ) {
      const heading = isSectionHeading(paragraph);
      // A heading carries no scope text; read the whole section beneath it instead.
      const section = heading
        ? sectionBody(article.paragraphs, index, sourceBarriers)
        : null;
      if (heading && section?.blockedBySource) {
        // A scope heading whose body continues in another source cannot be joined.
        fields.scope = {
          kind: "unknown",
          colleges: [],
          note: "跨来源资格标题不能自动关联",
        };
        conflicts.push("资格标题与内容分属不同来源，须人工核对");
        // Preserve both sides for review without treating them as one supported value.
        addBlockedSectionEvidence("scope", index, section);
      } else if (heading && !section?.parts.length) {
        // A heading with no readable body cannot support a scope value at all.
        warnings.push("资格小节标题下未读取到正文，参赛范围待核对");
      } else {
        const paragraphs = section?.parts.length
          ? section.parts
          : [
              {
                text:
                  /(?:参赛对象|参赛范围|参赛资格|报名对象)[：:\s]*$/.test(
                    paragraph,
                  ) && article.paragraphs[index + 1]
                    ? paragraph + "\n" + article.paragraphs[index + 1]
                    : paragraph,
                index,
              },
            ];
        // A section can mix eligibility with mode or schedule; only eligibility clauses
        // may shape the scope value, but every kept clause still keeps its own citation.
        const eligibility = paragraphs.filter(
          (part) =>
            !isOtherFieldClause(part.text) ||
            scopeRestriction.test(part.text) ||
            exclusionMarker.test(part.text),
        );
        const kept = eligibility.length ? eligibility : paragraphs;
        const scopeText = kept
          .map((part) => part.text)
          .join("\n")
          .trim();
        // 没有任何资格依据（空文本）只能是未知；有依据但无法枚举才是 other。
        const scope = scopeText
          ? readScope(scopeText, directory)
          : {
              kind: "unknown" as const,
              colleges: [] as string[],
              note: "参赛范围待核对",
              unresolvedCollege: false,
            };
        const { unresolvedCollege, ...scopeValue } = scope;
        if (scopeValue.kind === "unknown" && fields.scope.kind !== "unknown") {
          // 写了「参赛资格：」但没有范围依据的条款（如只讲团队人数）
          // 不构成互相矛盾的资格，不得把已确认的全校/学院降为 other。
        } else if (
          fields.scope.kind !== "unknown" &&
          JSON.stringify(fields.scope) !== JSON.stringify(scopeValue)
        ) {
          // 同一条通知内多个条款不能合并：保留原文即可追溯，不猜成某一侧。
          conflicts.push("参赛资格有多个条款，须合并核对");
          fields.scope = {
            kind: "other",
            colleges: [],
            note: fields.scope.note + "\n" + scopeText,
          };
        } else if (scopeValue.kind !== "unknown") fields.scope = scopeValue;
        if (unresolvedCollege) warnings.push("资格条款含未知学院名称");
        // Each sentence keeps its own location and citation.
        for (const part of paragraphs) add("scope", part.text, part.index);
      }
    }
    const mode = competitionMode(paragraph);
    if (mode.mode) {
      // 原文按段累积，绝不改写措辞；归一结果只在与已确认形式一致时保留。
      fields.mode = fields.mode ? fields.mode + "\n" + mode.mode : mode.mode;
      if (mode.conflict) {
        if (!modeConflict) conflicts.push(mode.conflict);
        modeConflict = true;
        fields.modeKind = null;
      } else if (modeConflict) {
        // 已判定不可归一：保留原文，不再回填枚举。
      } else if (fields.modeKind && fields.modeKind !== mode.modeKind) {
        // 互不覆盖的多种形式不能合并成 mixed；保留原文并交由人工确认。
        conflicts.push("参赛形式存在互不覆盖的要求，须人工核对");
        modeConflict = true;
        fields.modeKind = null;
      } else fields.modeKind = mode.modeKind;
      add("mode", paragraph, index);
    }
    const members =
      /(?:每组|每队|团队人数|队伍人数)[^。；]{0,30}(?:\d+|[一二三四五六七八九十]+)\s*人/.exec(
        paragraph,
      )?.[0] ??
      /(?:集体作品|团体作品)[^。；]{0,40}?(?<!报名)(人数(?:限定|限制)?(?:为|在)?\s*(?:\d+|[一二三四五六七八九十]+)(?:\s*[-—~～至到]\s*(?:\d+|[一二三四五六七八九十]+))?\s*人)/.exec(
        paragraph,
      )?.[1];
    if (members) {
      if (fields.members && fields.members !== members) {
        conflicts.push("人数要求存在多个表述，须逐赛道核对");
        fields.members = null;
      } else if (!conflicts.some((c) => c.startsWith("人数要求")))
        fields.members = members;
      add("members", paragraph, index);
    }
    if (isSectionHeading(paragraph) && rulesHeading.test(paragraph)) {
      // A heading carries no rule text; read the whole section beneath it.
      const section = sectionBody(article.paragraphs, index, sourceBarriers);
      if (section.blockedBySource) {
        conflicts.push("参赛规则标题与内容分属不同来源，须人工核对");
        warnings.push("规则小节跨来源，未自动拼接");
        addBlockedSectionEvidence("rules", index, section);
      } else for (const part of section.parts) addRule(part.text, part.index);
    } else if (rulesHeading.test(paragraph) && !isSectionHeading(paragraph)) {
      addRule(paragraph, index);
    }
    for (const match of paragraph.matchAll(
      /(赛道(?:[一二三四五六七八九十\d]+)?)[：:]\s*([^。；]+)/g,
    )) {
      const prefix = /([\p{Script=Han}A-Za-z0-9“”"'·+-]+)$/u.exec(
        paragraph.slice(0, match.index),
      )?.[1];
      const named =
        prefix &&
        !/^(?:参赛|比赛|竞赛|赛事|本次|本届|设置|分为|包括)/.test(prefix);
      // “结构化赛道：每组...”左侧才是名称；裸“赛道：算法、应用”才读右侧列表。
      const names = named
        ? [prefix + match[1]]
        : match[2]
            .split(/[、，,]/)
            .map((name) => name.trim())
            .filter(
              (name) =>
                name &&
                !/^(?:请|须|应当|必须|不得|分为|将.{0,20}(?:分为|分成)|每(?:组|队|批)?\s*\d+\s*人|(?:提交|报送|参考)(?:附件|材料|作品))/.test(
                  name,
                ),
            );
      for (const name of names) {
        if (fields.tracks.some((track) => track.name === name)) continue;
        const trackIndex = fields.tracks.length;
        fields.tracks.push({
          name,
          modeKind: null,
          members: null,
          rules: null,
        });
        add(`tracks.${trackIndex}.name`, paragraph, index);
      }
    }
    for (const clause of paragraph.split(/[。；;\n，,]/)) {
      // 往届获奖限制与学历/学籍基准引用中的“决赛”不证明本届安排该阶段。
      if (/往年|往届|历届|以往|此前/.test(clause)) continue;
      if (
        /学历|学籍|博士资格|入学资格/.test(clause) &&
        !/赛程|阶段|安排|举行|举办|进行|晋级|进入|入围|评审|推报/.test(clause)
      )
        continue;
      for (const name of clause.match(/院赛|校赛|初赛|复赛|决赛/g) ?? [])
        if (!fields.stageNames.includes(name)) {
          fields.stageNames.push(name);
          add("stageNames", paragraph, index);
        }
    }
    const timeClauses = paragraph.split(/[。；;\n]/).flatMap((clause) => {
      const parts = clause.split(/[，,]/);
      // Split only independently dated material duties. Otherwise a comma may
      // separate the actor from its action, so preserve the original sentence.
      return isMaterialClause(clause) &&
        parts.length > 1 &&
        parts.every(
          (part) =>
            /提交|报送/.test(part) &&
            materialsActor(part) !== null &&
            extractDates(part, titleYear).length,
        )
        ? parts.map((text) => ({ text, material: true }))
        : [{ text: clause, material: isMaterialClause(clause) }];
    });
    for (const { text: clause, material: materialClause } of timeClauses) {
      // Expand only a material window's abbreviated end day for date parsing;
      // evidence continues to cite the unchanged original clause.
      const dateText = materialClause
        ? clause.replace(
            /((?:(20\d{2})年)?(\d{1,2})月\d{1,2}日)\s*([至到—–~～－-])\s*(\d{1,2})日/g,
            (_match, start, year, month, separator, day) =>
              `${start}${separator}${year ? year + "年" : ""}${month}月${day}日`,
          )
        : clause;
      const dates = years.length > 1 ? [] : extractDates(dateText, titleYear);
      const set = (
        field: "startsAt" | "deadline" | "materialsAt" | "eventAt",
        value: TimeValue,
      ) => {
        if (fields[field].value && fields[field].value !== value.value) {
          conflicts.push(field + " 存在多个时间表述");
          fields[field] = unknownTime();
        } else if (
          !conflicts.some(
            (c) => c.startsWith(field + " ") && c !== organizerMaterialReason,
          )
        )
          fields[field] = value;
        add(field, clause, index);
      };
      if (materialClause) {
        const actor = materialsActor(clause);
        if (actor === "organizer") {
          // This is a different duty; keep its evidence without blocking an
          // independently explicit participant deadline earlier or later in the text.
          conflicts.push(organizerMaterialReason);
          add("materialsAt", clause, index);
        } else if (actor === null) {
          const reason = "materialsAt 主体不明，保留原文待人工核对";
          if (dates.length) {
            fields.materialsAt = unknownTime();
            conflicts.push(reason);
          } else warnings.push(reason);
          add("materialsAt", clause, index);
        } else if (dates.length === 1 && !materialWindow.test(dateText))
          set("materialsAt", dates[0]);
        else if (
          dates.length === 2 &&
          materialWindow.test(dateText) &&
          dates[0].value &&
          dates[1].value &&
          Date.parse(dates[0].value) <= Date.parse(dates[1].value)
        )
          set("materialsAt", dates[1]);
        else if (dates.length > 1 || materialWindow.test(dateText)) {
          fields.materialsAt = unknownTime();
          conflicts.push("materialsAt 材料时间范围需人工核对");
          add("materialsAt", clause, index);
        }
      } else if (
        /报名|注册/.test(clause) &&
        // 学籍资格里的正式注册时间不是赛事报名；明确的平台/账号注册仍按报名流程处理。
        !(
          /注册/.test(clause) &&
          /学籍|全日制|在校|在读|入学资格/.test(clause) &&
          !/报名|平台|系统|账号|账户|注册参赛|参赛注册/.test(clause)
        )
      ) {
        if (dates.length === 2 && /至|到|—|~|～/.test(clause)) {
          set("startsAt", dates[0]);
          set("deadline", dates[1]);
        } else if (dates.length === 1 && /截止|截至|之前|前/.test(clause))
          set("deadline", dates[0]);
        else if (dates.length === 1 && /开始|启动/.test(clause))
          set("startsAt", dates[0]);
        else if (dates.length) warnings.push("报名时间含义待核对：" + clause);
      } else if (/比赛时间|竞赛时间|比赛于|竞赛于/.test(clause)) {
        if (dates.length === 1) set("eventAt", dates[0]);
        else if (dates.length > 1) conflicts.push("比赛时间范围需人工核对");
      }
      if (/本周|下周|即日起|另行通知|本月底/.test(clause))
        warnings.push("相对或待定时间不自动推算：" + clause);
    }
  });
  if (fields.stageNames.length > 1) {
    conflicts.push("含多个赛段，时间归属须逐段人工确认");
    fields.startsAt = unknownTime();
    fields.deadline = unknownTime();
    fields.materialsAt = unknownTime();
    fields.eventAt = unknownTime();
  }
  // 通知种类只用来说明「新闻／获奖不能证明报名开放」；它不写入候选字段。
  // 未由 classifyNotice 传入时按标题保守推断，仅用于这条守卫。
  const guardKind =
    notificationKind ??
    (/获奖|结果公示|名单公示|表彰/.test(article.title)
      ? "award"
      : /新闻|回顾|圆满|荣获|喜报/.test(article.title)
        ? "news"
        : "registration");
  if (guardKind === "award" || guardKind === "news") {
    fields.startsAt = unknownTime();
    fields.deadline = unknownTime();
    warnings.push("新闻或获奖信息不能证明报名开放");
  }
  for (const key of ["edition", "organizer"] as const)
    if (!fields[key]) missing.push(key);
  if (!fields.mode) missing.push("mode");
  if (!fields.eventKind) missing.push("eventKind");
  if (!fields.stageNames.length) missing.push("stageNames");
  if (!fields.hosts.length) missing.push("hosts（不得按发布网站推断）");
  if (fields.scope.kind === "unknown") missing.push("scope");
  for (const key of ["startsAt", "deadline", "materialsAt", "eventAt"] as const)
    if (fields[key].precision === "unknown") missing.push(key);
  if (article.attachments.length)
    warnings.push("附件仅记录链接，未解析或核实附件规则");
  if (fields.tracks.length)
    warnings.push("赛道人数、模式与规则归属须人工核对，候选不自动生成正式赛道");
  else missing.push("tracks");
  if (!fields.members) missing.push("members");
  if (!fields.rules.length) missing.push("rules");
  return {
    fieldsContract: candidateFieldsContract,
    fields,
    evidence,
    missing: [...new Set(missing)],
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
  };
}
