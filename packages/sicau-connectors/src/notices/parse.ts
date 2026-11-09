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
const noticeTitlePrefix =
  /^关于(?:举办|举行|开展|组织参加|参加|做好|印发)(?:举办|举行|开展|组织)?/;
/**
 * 发文单位前缀（「食品学院关于举办…」）只去掉「关于举办」，单位本身保留：
 * 单位是否为赛事名组成部分无法可靠区分，删掉可能把不同单位的同名赛事合并。
 */
const issuingUnitPrefix =
  /^(.{2,30}?)(?:关于|就)(?:举办|举行|开展|组织参加|参加|做好|印发)(?:举办|举行|开展|组织)?/;
const noticeTitleSuffix =
  /(?:的)?(?:报名|参赛|组织|遴选|评选|举办)?(?:预通知|补充通知|变更通知|更正通知|通知)$/;
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

/** 赛事种类／项目类型的显式标注；不从此处以外的标题形态派生。 */
const eventKindLabel =
  /(?:赛事种类|竞赛类型|比赛类型|赛事类别|项目类型|竞赛类别|比赛类别)\s*[：:]\s*([^。；\n]{1,40})/;
export function competitionKind(paragraphs: string[]): {
  value: string | null;
  paragraph: number;
} {
  for (let index = 0; index < paragraphs.length; index++) {
    const match = eventKindLabel.exec(paragraphs[index] ?? "");
    const value = match?.[1]?.trim().replace(/[，,、；;]$/, "");
    if (value) return { value, paragraph: index };
  }
  return { value: null, paragraph: -1 };
}

/** 否定式先剔除再归一，避免「不组队」被读成团队。 */
const negationPattern =
  /(?:禁止|不得|不能|不可|不予|不允许|不接受|不准|不|非)(?:以)?(?:个人参赛|个人赛|个人|团队参赛|团队赛|团队|组队)/g;
const individualPattern = /个人赛|个人参赛|以个人|个人作品/;
const teamPattern =
  /团队赛|以团队|团体赛|以组为单位|每组\s*\d+人|(?:须|需|可以|应)组队|组队|团队形式|队伍/;
/** 并列的两种形式（「个人作品或集体作品」）是可选其一，归 mixed。 */
const collectivePattern = /集体作品|集体参赛|集体项目/;
export function competitionMode(text: string): {
  mode: string | null;
  modeKind: "individual" | "team" | "mixed" | null;
} {
  const positive = text
    .replace(negationPattern, "")
    // 剔除否定词后会留下悬空的逗号与句末标点，但不重写措辞本身。
    .replace(/[，,、]{2,}/g, "，")
    .replace(/^[，,、。；;\s]+|[，,、。；;\s]+$/g, "")
    .trim();
  const individual = individualPattern.test(positive);
  // 「集体作品」在「个人作品或集体作品」里是团队侧的等价表述。
  const team = teamPattern.test(positive) || collectivePattern.test(positive);
  // 同一句同时允许个人与团队即 mixed；交替出现（多个条款）由调用方判冲突。
  const modeKind =
    individual && team
      ? "mixed"
      : individual
        ? "individual"
        : team
          ? "team"
          : null;
  if (!modeKind) return { mode: null, modeKind: null };
  return { mode: positive, modeKind };
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
    const matched = colleges
      .filter((c) => text.includes(c.name))
      .map((c) => c.id);
    const unresolvedCollege = hasUnknownCollege(text);
    // 「不限」「不受…限制」是放开语义，不构成收窄。
    const withoutUnlimited = text.replace(/不限|不受[^。；，,]{0,20}限制/g, "");
    const excluded = exclusionMarker.test(withoutUnlimited);
    const allPhrase =
      /全校|我校全日制在校本科生|四川农业大学全日制在校本科生/.test(text);
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
        text,
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
        if (
          fields.scope.kind !== "unknown" &&
          JSON.stringify(fields.scope) !== JSON.stringify(scope)
        ) {
          // 同一条通知内多个条款不能合并：保留原文即可追溯，不猜成某一侧。
          conflicts.push("参赛资格有多个条款，须合并核对");
          fields.scope = {
            kind: "other",
            colleges: [],
            note: fields.scope.note + "\n" + scopeText,
          };
        } else fields.scope = scope;
        if (scope.unresolvedCollege) warnings.push("资格条款含未知学院名称");
        // Each sentence keeps its own location and citation.
        for (const part of paragraphs) add("scope", part.text, part.index);
      }
    }
    const mode = competitionMode(paragraph);
    if (mode.modeKind) {
      if (modeConflict) {
        // 已判定为不可归一：继续保留原文，不再猜测枚举。
        fields.mode = fields.mode ? fields.mode + "\n" + mode.mode : mode.mode;
      } else if (fields.modeKind && fields.modeKind !== mode.modeKind) {
        // 互不覆盖的多种形式不能合并成 mixed；保留原文并交由人工确认。
        conflicts.push("参赛形式存在多个不一致表述，须人工核对");
        modeConflict = true;
        fields.modeKind = null;
        fields.mode = fields.mode ? fields.mode + "\n" + mode.mode : mode.mode;
      } else {
        fields.modeKind = mode.modeKind;
        fields.mode = fields.mode ? fields.mode + "\n" + mode.mode : mode.mode;
      }
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
