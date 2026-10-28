import Joi from "joi";
import type { Pool, PoolClient } from "pg";
import { isDeepStrictEqual } from "node:util";
import { readCatalog, type RecordData } from "./catalog.js";
import { unknownTime } from "./time.js";
import type {
  CollegeRecord,
  StageRecord,
  NoticeRecord,
  TrackRecord,
} from "./competition.model.js";

export class ImportValidationError extends Error {}

const id = Joi.string()
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
const text = Joi.string()
  .max(10000)
  .pattern(/^[^<>]*$/);
const requiredText = text.required();
const date = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) =>
    new Date(value).toISOString().slice(0, 10) === value
      ? value
      : helpers.error("any.invalid"),
  );
const time = Joi.object({
  precision: Joi.string().valid("instant", "date", "unknown").required(),
  value: Joi.when("precision", {
    switch: [
      {
        is: "instant",
        then: Joi.string()
          .pattern(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
          )
          .custom((v, h) =>
            Number.isFinite(Date.parse(v)) &&
            new Date(v.slice(0, 10)).toISOString().slice(0, 10) ===
              v.slice(0, 10)
              ? v
              : h.error("any.invalid"),
          )
          .required(),
      },
      { is: "date", then: date.required() },
    ],
    otherwise: Joi.valid(null).required(),
  }),
});
const ids = Joi.array().items(id).unique();
const scope = Joi.object({
  kind: Joi.string().valid("all", "colleges", "complex", "unknown"),
  colleges: ids,
  note: text.allow(""),
});
const stage = Joi.object({
  id: id.required(),
  name: text,
  organizer: text,
  hosts: ids,
  scope,
  startsAt: time,
  deadline: time,
  materialsAt: time,
  eventAt: time,
  timeNote: text.allow(""),
  conflict: Joi.boolean(),
  registration: text,
  order: Joi.number().integer().min(0),
  sourceIds: ids,
});
const notice = Joi.object({
  id: id.required(),
  title: text,
  publisher: text,
  url: Joi.string().max(2000),
  publishedAt: date.allow(null),
  checkedAt: date.allow(null),
  kind: Joi.string().valid("registration", "supplement", "award", "news"),
});
const track = Joi.object({
  id: id.required(),
  name: text,
  mode: Joi.string().valid("individual", "team", "mixed"),
  members: text,
  rules: text,
});
const competition = Joi.object({
  id: id.required(),
  name: text,
  edition: text,
  category: text,
  organizer: text,
  origin: Joi.string().valid("official", "historical", "demo"),
  publication: Joi.string().valid("draft", "published", "hidden"),
  stages: Joi.array().items(stage).unique("id"),
  tracks: Joi.array().items(track).unique("id"),
  notices: Joi.array().items(notice).unique("id"),
});
const batchSchema = Joi.object({
  colleges: Joi.array()
    .items(
      Joi.object({
        id: id.required(),
        name: requiredText,
        order: Joi.number().integer().min(0).required(),
      }),
    )
    .unique("id")
    .unique("order"),
  competitions: Joi.array().items(competition).unique("id"),
}).required();

export type ImportStage = Partial<Omit<StageRecord, "scope">> & {
  id: string;
  scope?: Partial<StageRecord["scope"]>;
};
export type ImportCompetition = Partial<
  Omit<RecordData, "stages" | "tracks" | "notices">
> & {
  id: string;
  stages?: ImportStage[];
  tracks?: (Partial<TrackRecord> & { id: string })[];
  notices?: (Partial<NoticeRecord> & { id: string })[];
};
export interface ImportBatch {
  colleges?: CollegeRecord[];
  competitions?: ImportCompetition[];
}
export interface ImportOptions {
  preview?: boolean;
  confirmPublished?: boolean;
  production?: boolean;
}
export function validateInput(input: unknown): ImportBatch {
  const result = batchSchema.validate(input, {
    abortEarly: false,
    convert: false,
  });
  if (result.error)
    throw new ImportValidationError(
      result.error.details.map((d) => d.message).join("; "),
    );
  return result.value as ImportBatch;
}
function mergeById<T extends { id: string }>(
  existing: T[],
  updates: (Partial<T> & { id: string })[],
  merge: (a: T | undefined, b: Partial<T> & { id: string }) => T,
): T[] {
  const result = new Map(existing.map((v) => [v.id, v]));
  for (const update of updates)
    result.set(update.id, merge(result.get(update.id), update));
  return [...result.values()];
}
function mergeEdition(
  old: RecordData | undefined,
  patch: ImportCompetition,
): RecordData {
  const base: RecordData = old ?? {
    id: patch.id,
    name: "",
    edition: "",
    category: "",
    organizer: "",
    origin: "official",
    publication: "draft",
    stages: [],
    tracks: [],
    notices: [],
  };
  return {
    ...base,
    ...patch,
    publication: patch.publication ?? base.publication,
    tracks: mergeById(
      base.tracks,
      patch.tracks ?? [],
      (a, b) => ({ ...a, ...b }) as TrackRecord,
    ),
    notices: mergeById(
      base.notices,
      patch.notices ?? [],
      (a, b) =>
        ({ publishedAt: null, checkedAt: null, ...a, ...b }) as NoticeRecord,
    ),
    stages: mergeById<StageRecord>(
      base.stages,
      (patch.stages as (Partial<StageRecord> & { id: string })[]) ?? [],
      (a, b) =>
        ({
          startsAt: unknownTime(),
          deadline: unknownTime(),
          materialsAt: unknownTime(),
          eventAt: unknownTime(),
          timeNote: "",
          conflict: false,
          hosts: [],
          sourceIds: [],
          order: 0,
          ...a,
          ...b,
          scope: {
            kind: "unknown",
            note: "参赛范围待核对",
            ...a?.scope,
            ...b.scope,
            colleges: b.scope?.colleges ?? a?.scope.colleges ?? [],
          },
        }) as StageRecord,
    ),
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function needString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw new ImportValidationError(label + "缺少必要字段");
}
function validateEdition(
  record: RecordData,
  collegeIds: Set<string>,
  production: boolean,
) {
  for (const key of ["name", "edition", "category", "organizer"] as const)
    needString(record[key], record.id + "." + key);
  if (production && record.origin === "demo")
    throw new ImportValidationError("生产禁止导入 demo");
  for (const n of record.notices) {
    for (const key of ["title", "publisher", "kind", "url"] as const)
      needString(n[key], n.id + "." + key);
    let url: URL;
    try {
      url = new URL(n.url);
    } catch {
      throw new ImportValidationError(n.id + " URL 无效");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !(
        url.hostname === "sicau.edu.cn" ||
        url.hostname.endsWith(".sicau.edu.cn")
      )
    )
      throw new ImportValidationError(
        n.id + " 官方 URL 必须使用学校 HTTPS 域名",
      );
  }
  for (const t of record.tracks)
    for (const key of ["name", "mode", "members", "rules"] as const)
      needString(t[key], t.id + "." + key);
  for (const s of record.stages) {
    for (const key of ["name", "organizer", "registration"] as const)
      needString(s[key], s.id + "." + key);
    for (const c of [...s.hosts, ...s.scope.colleges])
      if (!collegeIds.has(c))
        throw new ImportValidationError(s.id + " 引用未知学院 " + c);
    for (const source of s.sourceIds)
      if (!record.notices.some((n) => n.id === source))
        throw new ImportValidationError(
          s.id + " 引用不存在或跨届来源 " + source,
        );
    if (s.scope.kind === "colleges" && !s.scope.colleges.length)
      throw new ImportValidationError(s.id + " 指定学院范围不能为空");
    if (s.scope.kind === "all" && s.scope.colleges.length)
      throw new ImportValidationError(s.id + " 全校范围不能附指定学院");
    if (
      record.publication === "published" &&
      record.origin !== "demo" &&
      s.startsAt.precision === "instant" &&
      s.deadline.precision === "instant" &&
      !s.sourceIds.some((id) =>
        record.notices.some(
          (n) =>
            n.id === id &&
            (n.kind === "registration" || n.kind === "supplement"),
        ),
      )
    ) {
      throw new ImportValidationError(
        s.id +
          " 精确报名窗口必须有报名或补充通知来源，新闻与获奖不能单独证明报名开放",
      );
    }
    if (s.conflict && (!s.timeNote.trim() || !s.sourceIds.length))
      throw new ImportValidationError(s.id + " 时间冲突须保留说明与来源");
    if (s.startsAt.value && s.deadline.value) {
      const earliestStart =
        s.startsAt.precision === "date"
          ? Date.parse(s.startsAt.value + "T00:00:00+08:00")
          : Date.parse(s.startsAt.value);
      const latestEnd =
        s.deadline.precision === "date"
          ? Date.parse(s.deadline.value + "T00:00:00+08:00") + 86400_000 - 1
          : Date.parse(s.deadline.value);
      // 不比较日期精度的同一天；不同日期可以判定前后。
      const definitelyInverted = earliestStart > latestEnd;
      if (
        definitelyInverted &&
        record.publication === "published" &&
        !s.conflict
      )
        throw new ImportValidationError(s.id + " 开始晚于截止，拒绝发布");
    }
  }
  if (
    record.publication === "published" &&
    (!record.stages.length ||
      !record.tracks.length ||
      (record.origin !== "demo" && !record.notices.length) ||
      record.stages.some(
        (s) => record.origin !== "demo" && !s.sourceIds.length,
      ))
  )
    throw new ImportValidationError(record.id + " 发布必须有赛段、赛道及来源");
}
async function relations(
  client: PoolClient,
  table: string,
  stageId: string,
  ids: string[],
  competitionId?: string,
) {
  const target = table === "stage_sources" ? "notice_id" : "college_id";
  await client.query("DELETE FROM " + table + " WHERE stage_id=$1", [stageId]);
  for (const value of ids) {
    if (competitionId)
      await client.query(
        "INSERT INTO " +
          table +
          "(stage_id," +
          target +
          ",competition_id) VALUES ($1,$2,$3)",
        [stageId, value, competitionId],
      );
    else
      await client.query(
        "INSERT INTO " + table + "(stage_id," + target + ") VALUES ($1,$2)",
        [stageId, value],
      );
  }
}
export async function importBatch(
  pool: Pool,
  input: unknown,
  options: ImportOptions = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await applyImportBatch(client, input, options);
    await client.query(options.preview ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// 调用者持有事务；审核基线、正式写入与候选结果可在同一边界提交。
export async function applyImportBatch(
  client: PoolClient,
  input: unknown,
  options: ImportOptions = {},
) {
  const batch = validateInput(input);
  const changes: {
    entity: string;
    id: string;
    action: "insert" | "update";
    removed?: string[];
  }[] = [];
  await client.query("SELECT pg_advisory_xact_lock(22002)");
  const old = await readCatalog(client);
  const directory = new Map(old.colleges.map((c) => [c.id, c]));
  for (const c of batch.colleges ?? []) directory.set(c.id, c);
  const records = new Map(old.competitions.map((c) => [c.id, c]));
  for (const patch of batch.competitions ?? [])
    records.set(patch.id, mergeEdition(records.get(patch.id), patch));
  const idsByEntity = new Map<string, string>();
  for (const r of records.values()) {
    validateEdition(r, new Set(directory.keys()), options.production ?? false);
    for (const [kind, entities] of [
      ["stage", r.stages],
      ["track", r.tracks],
      ["notice", r.notices],
    ] as const)
      for (const entity of entities) {
        const key = kind + ":" + entity.id;
        if (idsByEntity.has(key))
          throw new ImportValidationError(key + " 重复或跨届 ID");
        idsByEntity.set(key, r.id);
      }
  }
  for (const c of batch.colleges ?? []) {
    const prev = old.colleges.find((v) => v.id === c.id);
    if (isDeepStrictEqual(prev, c)) continue;
    // 学院目录变动亦会影响公开数据，禁止未经确认更改。
    if (
      prev &&
      old.competitions.some((r) => r.publication === "published") &&
      !options.confirmPublished &&
      !options.preview
    )
      throw new ImportValidationError(
        "更改公开学院目录需要 --confirm-published",
      );
    changes.push({
      entity: "college",
      id: c.id,
      action: prev ? "update" : "insert",
    });
    await client.query(
      "INSERT INTO colleges(id,name,display_order) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,display_order=EXCLUDED.display_order",
      [c.id, c.name, c.order],
    );
  }
  for (const patch of batch.competitions ?? []) {
    const r = records.get(patch.id)!;
    const prev = old.competitions.find((c) => c.id === r.id);
    if (isDeepStrictEqual(canonical(prev), canonical(r))) continue;
    if (
      prev?.publication === "published" &&
      !options.confirmPublished &&
      !options.preview
    )
      throw new ImportValidationError(
        r.id + " 更改已发布记录需要 --confirm-published",
      );
    const removed: string[] = [];
    for (const s of r.stages) {
      const before = prev?.stages.find((v) => v.id === s.id);
      for (const [label, previous, next] of [
        ["hosts", before?.hosts ?? [], s.hosts],
        ["eligibility", before?.scope.colleges ?? [], s.scope.colleges],
        ["sources", before?.sourceIds ?? [], s.sourceIds],
      ] as const)
        for (const value of previous)
          if (!next.includes(value))
            removed.push(s.id + "." + label + ":" + value);
    }
    changes.push({
      entity: "competition",
      id: r.id,
      action: prev ? "update" : "insert",
      removed,
    });
    const { stages, tracks, notices, publication, ...summary } = r;
    await client.query(
      "INSERT INTO competitions(id,data,publication) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,publication=EXCLUDED.publication",
      [r.id, summary, publication],
    );
    for (const n of notices)
      await client.query(
        "INSERT INTO notices(id,competition_id,data,published_at,checked_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,published_at=EXCLUDED.published_at,checked_at=EXCLUDED.checked_at",
        [n.id, r.id, n, n.publishedAt, n.checkedAt],
      );
    for (const t of tracks)
      await client.query(
        "INSERT INTO tracks(id,competition_id,data) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
        [t.id, r.id, t],
      );
    for (const s of stages) {
      const { hosts, sourceIds, ...data } = s;
      data.scope = { ...data.scope, colleges: [] };
      await client.query(
        "INSERT INTO stages(id,competition_id,data,display_order,registration_start,registration_end,registration_start_date,registration_end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,display_order=EXCLUDED.display_order,registration_start=EXCLUDED.registration_start,registration_end=EXCLUDED.registration_end,registration_start_date=EXCLUDED.registration_start_date,registration_end_date=EXCLUDED.registration_end_date",
        [
          s.id,
          r.id,
          data,
          s.order,
          s.startsAt.precision === "instant" ? s.startsAt.value : null,
          s.deadline.precision === "instant" ? s.deadline.value : null,
          s.startsAt.precision === "date" ? s.startsAt.value : null,
          s.deadline.precision === "date" ? s.deadline.value : null,
        ],
      );
      await relations(client, "stage_hosts", s.id, hosts);
      await relations(client, "stage_eligibility", s.id, s.scope.colleges);
      await relations(client, "stage_sources", s.id, sourceIds, r.id);
    }
  }
  return { preview: options.preview ?? false, changes };
}
