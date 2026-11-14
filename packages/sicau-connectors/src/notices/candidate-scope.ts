import type {
  CandidateFields,
  Evidence,
  ParsedCandidate,
  TimeValue,
} from "./types.js";

/**
 * #206 阶段一的字段输出范围。
 *
 * 本期只对七个字段给出确定值：赛事名、届次、主办单位、参赛成员（人数）、
 * 参赛范围、承办/协办单位、赛道名称。其余九个字段保留在契约里（历史候选、
 * 人工修正与正式记录仍然可读可写），但新提取不再给出确定值，避免把
 * 「多赛段时间归属」「整句参赛形式」「小节标题」当成已确认结果。
 */
export const retainedCandidateFields = [
  "name",
  "edition",
  "organizer",
  "members",
  "scope",
  "hosts",
  "tracks",
] as const;

/** 契约保留、本期不自动提取的字段；顺序与契约声明一致。 */
export const retiredCandidateFields = [
  "eventKind",
  "mode",
  "modeKind",
  "rules",
  "stageNames",
  "startsAt",
  "deadline",
  "materialsAt",
  "eventAt",
] as const;

export type RetiredCandidateField = (typeof retiredCandidateFields)[number];

const scopeNotice =
  "本期只自动提取赛事名、届次、主办单位、参赛成员、参赛范围、承办单位与赛道名称七字段；" +
  "赛事种类、参赛形式归一、规则、赛段名称与四类时间本期不自动提取";

/** 退役字段留下的提示只说明情况，不再要求人工按字段清理。 */
const retiredNoticePatterns: RegExp[] = [
  /^(?:eventKind|mode|modeKind|rules|stageNames|startsAt|deadline|materialsAt|eventAt)[ ：]/,
  /^赛事种类标注被拒绝：/,
  /^规则仅指向附件/,
  /^规则小节跨来源/,
  /^参赛规则标题与内容分属不同来源/,
  /^参赛形式存在互不覆盖的要求/,
  /^报名时间含义待核对：/,
  /^相对或待定时间不自动推算：/,
  /^含多个赛段，时间归属须逐段人工确认$/,
  // 「比赛时间范围需人工核对」不带字段名前缀，但确实只与本期不自动提取的
  // 比赛时间相关，需单独列出。
  /^比赛时间范围需人工核对/,
  /时间归属须逐段人工确认/,
];

const isRetiredNotice = (value: string) =>
  retiredNoticePatterns.some((pattern) => pattern.test(value));

/** 证据字段可能是 `tracks.0.rules` 这样的子路径，只按根字段判断归属。 */
const evidenceFieldRoot = (field: string) => field.split(".")[0] ?? field;

const retiredSet = new Set<string>(retiredCandidateFields);

/**
 * 赛道内只有名称是本期字段；`tracks.0.modeKind` 这类子路径同样属于退役范围。
 * 根字段 `tracks` 本身是保留字段，不能只用根判断。
 */
const retiredTrackSubFields = new Set(["modeKind", "members", "rules"]);
const isRetiredTrackSubField = (field: string) => {
  const [, , sub] = field.split(".");
  return Boolean(sub && retiredTrackSubFields.has(sub));
};

/** 契约统一的「未知时间」值；候选收敛与解析共用同一份字面量。 */
export const unknownTime = (): TimeValue => ({
  precision: "unknown",
  value: null,
});

export function isRetiredCandidateField(field: string): boolean {
  return retiredSet.has(evidenceFieldRoot(field));
}

/**
 * 把候选收敛到本期七字段输出范围。所有提取入口（正文解析、证据解析、
 * 附件合并、重新提取）都经过这里，避免离线结论与入库结论不一致。
 *
 * 只改新提取结果：历史候选的入库数据、人工修正与正式比赛记录不经过本函数。
 */
export function applyCandidateScope(
  candidate: ParsedCandidate,
): ParsedCandidate {
  const fields: CandidateFields = {
    ...candidate.fields,
    eventKind: null,
    mode: null,
    modeKind: null,
    rules: [],
    stageNames: [],
    startsAt: unknownTime(),
    deadline: unknownTime(),
    materialsAt: unknownTime(),
    eventAt: unknownTime(),
    tracks: (candidate.fields.tracks ?? []).map((track) => ({
      name: track.name,
      modeKind: null,
      members: null,
      rules: null,
    })),
  };
  // 退役字段的取值清空，但原文证据必须保留：历史与新增证据都不得因本期
  // 展示策略被隐藏，管理员仍可据此人工填写正式记录。
  const evidence: Evidence[] = candidate.evidence;
  const missing = candidate.missing.filter((entry) => {
    const key = entry.replace(/（.*$/, "");
    return !retiredSet.has(key);
  });
  const conflicts = candidate.conflicts.filter(
    (entry) => !isRetiredNotice(entry),
  );
  const warnings = candidate.warnings.filter(
    (entry) => !isRetiredNotice(entry),
  );
  if (!warnings.includes(scopeNotice)) warnings.push(scopeNotice);
  return {
    ...candidate,
    fields,
    evidence,
    missing,
    conflicts,
    warnings,
    ...(candidate.fieldConflicts
      ? {
          fieldConflicts: candidate.fieldConflicts.filter(
            (entry) =>
              !isRetiredCandidateField(entry.field) &&
              !isRetiredTrackSubField(entry.field),
          ),
        }
      : {}),
  };
}
