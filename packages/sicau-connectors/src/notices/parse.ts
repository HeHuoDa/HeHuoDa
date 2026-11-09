import type {
  Article,
  CandidateFields,
  Directory,
  Evidence,
  ParsedCandidate,
} from "./types.js";
import { candidateFieldsContract, type TimeValue } from "./types.js";
const unknownTime = (): TimeValue => ({ precision: "unknown", value: null });

/** Section numbers carry no content; a heading alone cannot support a value. */
const headingPrefix =
  /^(?:[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|[一二三四五六七八九十\d]+\s*[、.．]|第\s*[一二三四五六七八九十\d]+\s*[章节条部分])\s*/;
/** A clause carries content; these markers mean the text is a sentence, not a heading. */
const clauseMarker = /须|应|需|不得|不可|可以|按|每|如|若|未|由|限/;
// Unnumbered lines are headings only when the whole line is a known section label.
const sectionLabel =
  /^(?:参赛规则|竞赛规则|比赛规则|参赛要求|作品要求|组队要求|参赛对象(?:及要求)?|参赛范围|参赛资格|报名对象|报名方式|报名时间|报名须知|比赛时间|竞赛时间|时间安排|活动安排|奖项设置|联系方式)$/;
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
const scopeHeading = /参赛对象|参赛范围|参赛资格|报名对象/;
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
    /(?:(20\d{2})\s*[年./-]\s*)?(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：时](\d{2})\s*分?)?/g;
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
  /^(?:参赛形式|参赛方式|比赛形式|竞赛形式|组队形式)\s*[：:]\s*/;
/** 可选其一的并列词；只有它们才把「个人 + 团队」解释为两者皆可。 */
const alternativeMarker = /或|及|和|以及|均可|皆可|任一|任选/;
/** 否定标记；用于判断与它相邻的形式是否被否定。 */
const negationMarker =
  /禁止|不得|不能|不可以|不可|不予|不允许|不接受|不准|非|不/;
/** 赛段限定；同一形式出现在不同赛段时不能合并。 */
const stageMarker = /初赛|复赛|决赛|预赛|半决赛|院赛|校赛|省赛|国赛/g;

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
function readModeMention(clause: string): ModeMention | null {
  const individual = individualForm.test(clause);
  const team = teamForm.test(clause);
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
  const original = text.trim();
  if (!original) return { mode: null, modeKind: null, conflict: null };
  const body = original.replace(modeLabel, "").trim() || original;
  // 逐子句判断：句号分号按句拆，逗号两侧各自都能独立判定形式时才拆开，
  // 否则「独立参赛，不组队」会被切断成互不相关的两截。
  const clauses = body
    .split(/[。；;\n]/)
    .flatMap((sentence) => {
      const parts = sentence.split(/[，,]/).map((part) => part.trim());
      if (parts.length < 2) return [sentence.trim()];
      return parts.every((part) => readModeMention(part))
        ? parts
        : [sentence.trim()];
    })
    .filter(Boolean);
  const mentions = clauses
    .map((clause) => readModeMention(clause))
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
      mode: original,
      modeKind: null,
      conflict: "参赛形式按赛段分别规定，不能合并为单一形式",
    };
  if (!individualAffirmed && !teamAffirmed)
    return {
      mode: original,
      modeKind: null,
      conflict: "参赛形式被否定，未形成可归一形式",
    };
  if (mixedInOneClause && individualAffirmed && teamAffirmed)
    return { mode: original, modeKind: "mixed", conflict: null };
  // 跨子句同时肯定两种互不覆盖的要求，属矛盾而非可选。
  if (individualAffirmed && teamAffirmed)
    return {
      mode: original,
      modeKind: null,
      conflict: "参赛形式存在互不覆盖的要求，须人工核对",
    };
  return {
    mode: original,
    modeKind: individualAffirmed ? "individual" : "team",
    conflict: null,
  };
}

export function parseCandidate(
  article: Article,
  url: string,
  directory: Directory,
  /**
   * 通知种类不再写入候选字段；参数保留以兼容既有调用点，
   * 通知种类唯一来源是 classifyNotice 返回的 classification.notificationKind。
   * 未传入时（直接调用 parseCandidate）只在内部按标题推断，用于「新闻／获奖
   * 不证明报名开放」这一条守卫，不写入 fields。
   */
  notificationKind?: string,
  /** Paragraph gaps where consecutive text belongs to different sources; never joined. */
  sourceBarriers?: Set<number>,
): ParsedCandidate {
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
  const fields: CandidateFields = {
    name: competitionName(article.title),
    edition: years.length <= 1 ? titleYear : null,
    eventKind: eventKind.value,
    organizer: null,
    hosts: [],
    scope: { kind: "unknown", colleges: [], note: "参赛范围待核对" },
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
  };
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
  const hasUnknownCollege = (text: string) => {
    for (const college of directory) text = text.replaceAll(college.name, "");
    return /[\p{Script=Han}A-Za-z]+学院/u.test(text.replace(/各学院/g, ""));
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
    // 承办/主办是组织关系，不能拿同段的承办学院缩小或污染资格。
    const qualification = text
      .split(/[，,。；;\n]/)
      .filter(
        (clause) =>
          !/^(?:主办|承办)(?:单位|学院)?\s*(?:[：:]|为|是)/.test(
            clause.trim(),
          ) &&
          !/^[^：:]{0,40}学院(?:(?:负责)?(?:主办|承办)|(?:为|是)(?:主办|承办)单位)$/.test(
            clause.trim(),
          ),
      )
      .join("；");
    const matched = colleges
      .filter((c) => qualification.includes(c.name))
      .map((c) => c.id);
    const unresolvedCollege = hasUnknownCollege(qualification);
    // 「不限」「不受…限制」是放开语义，不构成收窄。
    const withoutUnlimited = qualification.replace(
      /不限|不受[^。；，,]{0,20}限制/g,
      "",
    );
    const excluded = exclusionMarker.test(withoutUnlimited);
    const allPhrase =
      /全校|我校全日制在校本科生|四川农业大学全日制在校本科生/.test(
        qualification,
      );
    const narrowed = /仅|限|除|不含|校区/.test(withoutUnlimited);
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
    for (const college of directory) {
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
      (hasUnknownCollege(paragraph) ||
        !directory.some((c) => paragraph.includes(c.name)))
    )
      warnings.push("承办单位尚未匹配学院目录，待核对");
    if (/主办(?:单位)?[：:]|由[^。；]*主办/.test(paragraph)) {
      const organizerText =
        /主办(?:单位)?[：:]\s*([^。；]+)/.exec(paragraph)?.[1] ??
        /由([^。；]+?)主办/.exec(paragraph)?.[1];
      const organizer = organizerText
        ?.split(
          /[，,]\s*(?=(?:承办|协办|发布|参赛|报名|比赛时间|竞赛时间)(?:单位|学院|对象|范围|资格)?[：:])/,
        )[0]
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
    if (scopeHeading.test(paragraph)) {
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
        if (
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
        } else fields.scope = scopeValue;
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
      )?.[0];
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
      } else
        for (const part of section.parts) {
          fields.rules.push(part.text);
          add("rules", part.text, part.index);
        }
    } else if (rulesHeading.test(paragraph) && !isSectionHeading(paragraph)) {
      fields.rules.push(paragraph);
      add("rules", paragraph, index);
    }
    for (const match of paragraph.matchAll(
      /赛道(?:[一二三四五六七八九十\d]+)?[：:]\s*([^。；]+)/g,
    )) {
      const names = match[1]
        .split(/[、，,]/)
        .map((name) => name.trim())
        .filter(Boolean);
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
    for (const name of paragraph.match(/院赛|校赛|初赛|复赛|决赛/g) ?? [])
      if (!fields.stageNames.includes(name)) {
        fields.stageNames.push(name);
        add("stageNames", paragraph, index);
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
      } else if (/报名|注册/.test(clause)) {
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
