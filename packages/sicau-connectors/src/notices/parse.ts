import type {
  Article,
  CandidateFields,
  Directory,
  Evidence,
  ParsedCandidate,
} from "./types.js";
import type { TimeValue } from "./types.js";
const unknownTime = (): TimeValue => ({ precision: "unknown", value: null });

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
  const kind: CandidateFields["kind"] = /获奖|结果公示|名单公示|表彰/.test(
    article.title,
  )
    ? "award"
    : /补充|延期|更正|调整/.test(article.title)
      ? "supplement"
      : /报名|参赛|竞赛.*通知|比赛.*通知/.test(article.title)
        ? "registration"
        : "news";
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
      const organizer =
        /主办(?:单位)?[：:]\s*([^。；]+)/.exec(paragraph)?.[1] ??
        /由([^。；]+?)主办/.exec(paragraph)?.[1];
      if (organizer) {
        if (fields.organizer && fields.organizer !== organizer.trim()) {
          conflicts.push("主办单位有多个表述，待核对");
          fields.organizer = null;
        } else fields.organizer = organizer.trim();
        add("organizer", paragraph, index);
      }
    }
    if (/参赛对象|参赛范围|参赛资格|报名对象/.test(paragraph)) {
      const scopeText =
        /(?:参赛对象|参赛范围|参赛资格|报名对象)[：:\s]*$/.test(paragraph) &&
        article.paragraphs[index + 1]
          ? paragraph + "\n" + article.paragraphs[index + 1]
          : paragraph;
      const collegeIds = directory
        .filter((c) => scopeText.includes(c.name))
        .map((c) => c.id);
      const unknownCollege = hasUnknownCollege(scopeText);
      const scope = unknownCollege
        ? { kind: "complex" as const, colleges: [], note: scopeText }
        : /全校|我校全日制在校本科生|四川农业大学全日制在校本科生/.test(
              scopeText,
            ) && !/仅|限|除|不含|校区/.test(scopeText.replace(/不限/g, ""))
          ? { kind: "all" as const, colleges: [], note: scopeText }
          : collegeIds.length && !/除|不含/.test(scopeText)
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
      add("scope", scopeText, index);
    }
    const individual = /个人赛|个人参赛|以个人/.test(paragraph),
      team =
        /团队赛|以团队|团体赛|以组为单位|每组\s*\d+人|(?:须|需|可以|应)组队/.test(
          paragraph.replace(/不组队|禁止组队|不以团队/g, ""),
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
    if (
      /参赛规则|竞赛规则|比赛规则|参赛要求|作品要求|组队要求/.test(paragraph)
    ) {
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
        if (dates.length === 1) set("materialsAt", dates[0]);
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
