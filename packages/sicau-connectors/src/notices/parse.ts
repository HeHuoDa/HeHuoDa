import type {
  Article,
  CandidateFields,
  Directory,
  Evidence,
  ParsedCandidate,
} from "./types.js";
import type { TimeValue } from "./types.js";
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
const submitVerb = /提交|递交|上交/;

/**
 * Material deadlines belong to whoever must act: applicants submit, while colleges
 * aggregate, review and forward. A forwarding duty is not the applicant deadline.
 * "截止" alone does not identify the actor; a bare "报送" is a forwarding duty, so it
 * stays unknown instead of being guessed as the applicant deadline.
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
  if (/截止|截至/.test(clause) && submitVerb.test(clause)) return "participant";
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

export function parseCandidate(
  article: Article,
  url: string,
  directory: Directory,
  notificationKind?: CandidateFields["kind"],
  /** Paragraph gaps where consecutive text belongs to different sources; never joined. */
  sourceBarriers?: Set<number>,
): ParsedCandidate {
  const evidence: Evidence[] = [
    { field: "name", excerpt: article.title, paragraph: -1, url },
  ];
  const missing: string[] = [],
    conflicts: string[] = [],
    warnings: string[] = [];
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
  const kind: CandidateFields["kind"] =
    notificationKind ??
    (/获奖|结果公示|名单公示|表彰/.test(article.title)
      ? "award"
      : /补充|延期|更正|调整/.test(article.title)
        ? "supplement"
        : /报名|参赛|竞赛.*通知|比赛.*通知/.test(article.title)
          ? "registration"
          : "news");
  evidence.push({ field: "kind", excerpt: article.title, paragraph: -1, url });
  const fields: CandidateFields = {
    name: article.title,
    edition: years.length <= 1 ? titleYear : null,
    kind,
    organizer: null,
    hosts: [],
    scope: { kind: "unknown", colleges: [], note: "参赛范围待核对" },
    mode: null,
    tracks: [],
    members: null,
    rules: [],
    stageNames: [],
    startsAt: unknownTime(),
    deadline: unknownTime(),
    materialsAt: unknownTime(),
    eventAt: unknownTime(),
  };
  if (fields.edition)
    evidence.push({
      field: "edition",
      excerpt: article.title,
      paragraph: -1,
      url,
    });
  const add = (field: string, excerpt: string, paragraph: number) =>
    evidence.push({ field, excerpt, paragraph, url });
  const hasUnknownCollege = (text: string) => {
    for (const college of directory) text = text.replaceAll(college.name, "");
    return /[\p{Script=Han}A-Za-z]+学院/u.test(text.replace(/各学院/g, ""));
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
        add("scope", paragraph, index);
        for (const part of section.parts) add("scope", part.text, part.index);
        if (section.blockedAt !== undefined)
          add(
            "scope",
            article.paragraphs[section.blockedAt],
            section.blockedAt,
          );
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
        const scopeText = kept.map((part) => part.text).join("\n");
        const collegeIds = directory
          .filter((c) => scopeText.includes(c.name))
          .map((c) => c.id);
        const unknownCollege = hasUnknownCollege(scopeText);
        // Bare "不" is too broad; only explicit exclusion wording narrows eligibility.
        const excludedEligibility = exclusionMarker.test(
          scopeText.replace(/不限|不受[^。；，,]{0,20}限制/g, ""),
        );
        const scope =
          unknownCollege || excludedEligibility
            ? { kind: "complex" as const, colleges: [], note: scopeText }
            : /全校|我校全日制在校本科生|四川农业大学全日制在校本科生/.test(
                  scopeText,
                ) && !/仅|限|除|不含|校区/.test(scopeText.replace(/不限/g, ""))
              ? { kind: "all" as const, colleges: [], note: scopeText }
              : collegeIds.length
                ? {
                    kind: "colleges" as const,
                    colleges: collegeIds,
                    note: scopeText,
                  }
                : { kind: "complex" as const, colleges: [], note: scopeText };
        if (
          fields.scope.kind !== "unknown" &&
          JSON.stringify(fields.scope) !== JSON.stringify(scope)
        ) {
          conflicts.push("参赛资格有多个条款，须合并核对");
          fields.scope = {
            kind: "complex",
            colleges: [],
            note: fields.scope.note + "\n" + scopeText,
          };
        } else fields.scope = scope;
        if (
          unknownCollege ||
          (/学院/.test(scopeText) &&
            !collegeIds.length &&
            !/全校|各学院/.test(scopeText))
        )
          warnings.push("资格条款含未知学院名称");
        // Each sentence keeps its own location and citation.
        for (const part of paragraphs) add("scope", part.text, part.index);
      }
    }
    const modeText = paragraph.replace(
      /(?:禁止|不得|不能|不可|不予|不允许|不接受|不准|不|非)(?:以)?(?:个人参赛|个人赛|个人|团队参赛|团队赛|团队|组队)/g,
      "",
    );
    const individual = /个人赛|个人参赛|以个人/.test(modeText),
      team =
        /团队赛|以团队|团体赛|以组为单位|每组\s*\d+人|(?:须|需|可以|应)组队/.test(
          modeText,
        );
    if (individual || team) {
      const mode =
        individual && team ? "mixed" : individual ? "individual" : "team";
      fields.mode = fields.mode && fields.mode !== mode ? "mixed" : mode;
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
        fields.tracks.push({ name, mode: null, members: null, rules: null });
        add(`tracks.${trackIndex}.name`, paragraph, index);
      }
    }
    for (const name of paragraph.match(/院赛|校赛|初赛|复赛|决赛/g) ?? [])
      if (!fields.stageNames.includes(name)) {
        fields.stageNames.push(name);
        add("stageNames", paragraph, index);
      }
    for (const clause of paragraph.split(/[。；;\n]/)) {
      const dates = years.length > 1 ? [] : extractDates(clause, titleYear);
      const set = (
        field: "startsAt" | "deadline" | "materialsAt" | "eventAt",
        value: TimeValue,
      ) => {
        if (fields[field].value && fields[field].value !== value.value) {
          conflicts.push(field + " 存在多个时间表述");
          fields[field] = unknownTime();
        } else if (!conflicts.some((c) => c.startsWith(field + " ")))
          fields[field] = value;
        add(field, clause, index);
      };
      if (/材料|作品|论文/.test(clause) && /提交|报送|截止/.test(clause)) {
        const actor = materialsActor(clause);
        if (actor === "organizer") {
          conflicts.push(
            "materialsAt 主体为院校审核或报送，不能作为参赛者材料截止",
          );
          add("materialsAt", clause, index);
        } else if (actor === null) {
          conflicts.push("materialsAt 主体不明，保留原文待人工核对");
          add("materialsAt", clause, index);
        } else if (dates.length === 1) set("materialsAt", dates[0]);
        else if (dates.length > 1) conflicts.push("材料时间范围需人工核对");
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
  if (kind === "award" || kind === "news") {
    fields.startsAt = unknownTime();
    fields.deadline = unknownTime();
    warnings.push("新闻或获奖信息不能证明报名开放");
  }
  for (const key of ["edition", "organizer", "mode"] as const)
    if (!fields[key]) missing.push(key);
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
    fields,
    evidence,
    missing: [...new Set(missing)],
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
  };
}
