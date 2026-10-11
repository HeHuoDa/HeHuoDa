import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  primaryKey,
  unique,
  foreignKey,
  boolean,
  customType,
} from "drizzle-orm/pg-core";
import type {
  EditionSummary,
  StageRecord,
  TrackRecord,
  NoticeRecord,
} from "../competitions/competition.model.js";
export const colleges = pgTable("colleges", {
  id: text().primaryKey(),
  name: text().notNull(),
  order: integer("display_order").notNull().unique(),
});
export const competitions = pgTable("competitions", {
  id: text().primaryKey(),
  data: jsonb().$type<EditionSummary>().notNull(),
  publication: text().notNull().default("draft"),
});
export const stages = pgTable(
  "stages",
  {
    id: text().primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id),
    data: jsonb().$type<Omit<StageRecord, "hosts" | "sourceIds">>().notNull(),
    order: integer("display_order").notNull(),
    registrationStart: timestamp("registration_start", { withTimezone: true }),
    registrationEnd: timestamp("registration_end", { withTimezone: true }),
    registrationStartDate: date("registration_start_date"),
    registrationEndDate: date("registration_end_date"),
  },
  (t) => [unique().on(t.id, t.competitionId)],
);
export const tracks = pgTable("tracks", {
  id: text().primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  data: jsonb().$type<TrackRecord>().notNull(),
});
export const notices = pgTable(
  "notices",
  {
    id: text().primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id),
    data: jsonb().$type<NoticeRecord>().notNull(),
    publishedAt: date("published_at"),
    checkedAt: date("checked_at"),
  },
  (t) => [unique().on(t.id, t.competitionId)],
);
export const hosts = pgTable(
  "stage_hosts",
  {
    stageId: text("stage_id")
      .notNull()
      .references(() => stages.id),
    collegeId: text("college_id")
      .notNull()
      .references(() => colleges.id),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.collegeId] })],
);
export const eligibility = pgTable(
  "stage_eligibility",
  {
    stageId: text("stage_id")
      .notNull()
      .references(() => stages.id),
    collegeId: text("college_id")
      .notNull()
      .references(() => colleges.id),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.collegeId] })],
);
export const sources = pgTable(
  "stage_sources",
  {
    stageId: text("stage_id").notNull(),
    noticeId: text("notice_id").notNull(),
    competitionId: text("competition_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stageId, t.noticeId] }),
    foreignKey({
      columns: [t.stageId, t.competitionId],
      foreignColumns: [stages.id, stages.competitionId],
    }),
    foreignKey({
      columns: [t.noticeId, t.competitionId],
      foreignColumns: [notices.id, notices.competitionId],
    }),
  ],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const ingestionSources = pgTable("ingestion_sources", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
  enabled: boolean().notNull().default(true),
  settings: jsonb().notNull(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
});
export const ingestionRuns = pgTable("ingestion_runs", {
  id: text().primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => ingestionSources.id),
  trigger: text().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text().notNull(),
  options: jsonb().notNull(),
  cursor: jsonb().notNull(),
  counts: jsonb().notNull(),
  errors: jsonb().notNull(),
});
export const ingestionNotices = pgTable(
  "ingestion_notices",
  {
    id: text().primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => ingestionSources.id),
    url: text().notNull(),
    finalUrl: text("final_url").notNull(),
    latestVersion: text("latest_version"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    etag: text(),
    lastModified: text("last_modified"),
    health: text().notNull(),
  },
  (t) => [unique().on(t.sourceId, t.url)],
);
export const ingestionVersions = pgTable(
  "ingestion_versions",
  {
    id: text().primaryKey(),
    noticeId: text("notice_id")
      .notNull()
      .references(() => ingestionNotices.id),
    previousVersion: text("previous_version"),
    revision: integer().notNull(),
    bodyHash: text("body_hash").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    article: jsonb().notNull(),
    extracted: jsonb().notNull(),
    rawResponse: bytea("raw_response"),
    responseHeaders: jsonb("response_headers").notNull(),
  },
  (t) => [unique().on(t.noticeId, t.revision)],
);
export const ingestionCandidates = pgTable("ingestion_candidates", {
  id: text().primaryKey(),
  noticeId: text("notice_id")
    .notNull()
    .unique()
    .references(() => ingestionNotices.id),
  sourceVersion: text("source_version")
    .notNull()
    .references(() => ingestionVersions.id),
  revision: integer().notNull().default(1),
  status: text().notNull(),
  data: jsonb().notNull(),
  reviewer: text(),
  checkedAt: date("checked_at"),
  reason: text(),
  approvedFile: jsonb("approved_file"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const ingestionMappings = pgTable("ingestion_mappings", {
  candidateId: text("candidate_id")
    .primaryKey()
    .references(() => ingestionCandidates.id),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  stageIds: jsonb("stage_ids").notNull(),
  noticeIds: jsonb("notice_ids").notNull(),
  trackIds: jsonb("track_ids").notNull(),
});
export const ingestionOperations = pgTable("ingestion_operations", {
  id: text().primaryKey(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => ingestionCandidates.id),
  sourceVersion: text("source_version")
    .notNull()
    .references(() => ingestionVersions.id),
  candidateRevision: integer("candidate_revision").notNull(),
  kind: text().notNull(),
  reviewer: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  inputHash: text("input_hash").notNull(),
  result: jsonb().notNull(),
});
