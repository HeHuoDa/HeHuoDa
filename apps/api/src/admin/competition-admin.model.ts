import { isDeepStrictEqual } from "node:util";
import type {
  CollegeRecord,
  EditionRecord,
} from "../competitions/competition.model.js";
import { commandHash } from "../ingestion/store.js";
import {
  mergeEdition,
  type ImportCompetition,
} from "../competitions/import.js";
import { manualNoticeUrlError } from "../competitions/source-url.js";

// 管理端正式比赛命令的纯逻辑：基线、应用、差异与发布底线，不持有数据库连接。

export type CompetitionAction = "save" | "publish" | "hide";
export const competitionActions = ["save", "publish", "hide"] as const;

export interface AdminCompetitionChange {
  field: string;
  previous: unknown;
  current: unknown;
  removed?: string[];
}

export interface PublishBlock {
  code:
    | "STAGE_MISSING"
    | "STAGE_INCOMPLETE"
    | "TRACK_MISSING"
    | "SOURCE_MISSING"
    | "SOURCE_UNLINKED"
    | "SOURCE_INVALID"
    | "CHECKED_AT_MISSING"
    | "CHECKED_AT_INVALID";
  message: string;
}

/**
 * 正式基线：目标记录（不存在时为空）与学院目录。
 * 与采集审核的 formalBaseline 同构，两条写入口可互认“记录是否已变化”。
 */
export function baselineOf(
  record: EditionRecord | null,
  colleges: CollegeRecord[],
): string {
  return commandHash({ record: record ?? null, colleges });
}

/** 只应用本次命令携带的字段，缺省字段保持原值；合并语义与导入完全一致。 */
export function applyCommand(
  before: EditionRecord | null,
  action: CompetitionAction,
  patch: ImportCompetition,
): EditionRecord {
  // 发布状态只能由 publish/hide 改变：save 写了些什么都不能顺手把记录推向公开端，
  // 否则发布底线（赛段/赛道/来源/人工核对日期）会被一条保存命令绕过。
  const publication =
    action === "publish"
      ? "published"
      : action === "hide"
        ? "hidden"
        : (before?.publication ?? "draft");
  return mergeEdition(before ?? undefined, { ...patch, publication });
}

/** save 请求里出现发布状态即视为命令不合法，在应用前就拒绝。 */
export function savePublicationInvalid(
  before: EditionRecord | null,
  patch: ImportCompetition,
): string | null {
  if (patch.publication === undefined) return null;
  const current = before?.publication ?? "draft";
  return patch.publication === current
    ? null
    : "保存草稿不能改变发布状态，请使用 publish 或 hide 命令";
}

function relationDiffs(
  before: EditionRecord | null,
  after: EditionRecord,
): AdminCompetitionChange[] {
  const changes: AdminCompetitionChange[] = [];
  for (const stage of after.stages) {
    const previous = before?.stages.find((value) => value.id === stage.id);
    for (const [field, oldValues, newValues] of [
      ["hosts", previous?.hosts ?? [], stage.hosts],
      ["scope.colleges", previous?.scope.colleges ?? [], stage.scope.colleges],
      ["sourceIds", previous?.sourceIds ?? [], stage.sourceIds],
    ] as const) {
      if (isDeepStrictEqual(oldValues, newValues)) continue;
      changes.push({
        field: `stages.${stage.id}.${field}`,
        previous: oldValues,
        current: newValues,
        removed: oldValues.filter((value) => !newValues.includes(value)),
      });
    }
  }
  return changes;
}

/** 字段级差异；关系集合按成员列出新增与移除，便于管理端直接展示。 */
export function compareChanges(
  before: EditionRecord | null,
  after: EditionRecord,
): AdminCompetitionChange[] {
  const changes: AdminCompetitionChange[] = [];
  const previous = before as unknown as Record<string, unknown> | null;
  for (const field of [
    "name",
    "edition",
    "category",
    "organizer",
    "origin",
    "publication",
  ] as const)
    if (previous?.[field] !== after[field])
      changes.push({
        field,
        previous: previous?.[field] ?? null,
        current: after[field],
      });
  for (const field of ["stages", "tracks", "notices"] as const)
    if (!isDeepStrictEqual(before?.[field] ?? [], after[field]))
      changes.push({
        field,
        previous: before?.[field] ?? [],
        current: after[field],
      });
  return [...changes, ...relationDiffs(before, after)];
}

const today = (now: string) => now.slice(0, 10);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/**
 * 发布底线：至少一个完整赛段、一条赛道、一条合法来源及人工核对日期。
 * 草稿阶段允许未知时间与缺失关系，因此这条规则只在 publish 时判定。
 */
export function publishBlocks(
  record: EditionRecord,
  now: string,
): PublishBlock[] {
  const blocks: PublishBlock[] = [];
  if (!record.stages.length)
    blocks.push({ code: "STAGE_MISSING", message: "发布至少需要一个赛段" });
  else if (
    record.stages.some(
      (stage) =>
        !stage.name.trim() ||
        !stage.organizer.trim() ||
        !stage.registration.trim() ||
        (stage.scope.kind === "colleges" && !stage.scope.colleges.length),
    )
  )
    blocks.push({
      code: "STAGE_INCOMPLETE",
      message: "赛段缺少名称、组织单位、报名说明或参赛范围",
    });
  if (!record.tracks.length)
    blocks.push({ code: "TRACK_MISSING", message: "发布至少需要一条赛道" });
  if (!record.notices.length)
    blocks.push({ code: "SOURCE_MISSING", message: "发布至少需要一条来源" });
  else {
    if (record.notices.some((notice) => manualNoticeUrlError(notice.url)))
      blocks.push({
        code: "SOURCE_INVALID",
        message: "来源链接必须是公开 HTTPS 域名地址",
      });
    const limit = today(now);
    if (record.notices.some((notice) => !notice.checkedAt))
      blocks.push({
        code: "CHECKED_AT_MISSING",
        message: "发布前须填写人工核对日期",
      });
    else if (
      record.notices.some(
        (notice) => !validDate(notice.checkedAt!) || notice.checkedAt! > limit,
      )
    )
      blocks.push({
        code: "CHECKED_AT_INVALID",
        message: "人工核对日期必须是有效且不晚于今天的日期",
      });
  }
  if (record.stages.some((stage) => !stage.sourceIds.length))
    blocks.push({
      code: "SOURCE_UNLINKED",
      message: "每个赛段至少关联一条本届来源",
    });
  return blocks;
}
