import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  date,
  primaryKey,
  unique,
  foreignKey,
  boolean,
  customType,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EditionSummary,
  StageRecord,
  TrackRecord,
  NoticeRecord,
} from "../competitions/competition.model.js";
import type { Channel } from "@hehuoda/sicau-connectors/notices";
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
export const ingestionChannels = pgTable(
  "ingestion_channels",
  {
    sourceId: text("source_id").notNull(),
    id: text().notNull(),
    data: jsonb().$type<Channel>().notNull(),
    enabled: boolean().notNull().default(false),
    settings: jsonb().$type<Record<string, number>>().notNull().default({}),
    verificationStatus: text("verification_status")
      .$type<"pending" | "verified" | "rejected">()
      .notNull()
      .default("pending"),
    verification: jsonb().notNull().default({}),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    activatedOn: date("activated_on"),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastSuccessfulCheck: timestamp("last_successful_check", {
      withTimezone: true,
    }),
    failureCount: integer("failure_count").notNull().default(0),
    backoffUntil: timestamp("backoff_until", { withTimezone: true }),
    rotationSeq: bigint("rotation_seq", { mode: "bigint" })
      .notNull()
      .default(0n),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.id] }),
    foreignKey({
      columns: [t.sourceId],
      foreignColumns: [ingestionSources.id],
    }),
  ],
);
export const ingestionRounds = pgTable("ingestion_rounds", {
  id: text().primaryKey(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text().$type<"running" | "partial" | "succeeded">().notNull(),
  freshCheckStatus: jsonb("fresh_check_status").notNull().default({}),
  rotationCursor: text("rotation_cursor"),
  budgetUsage: jsonb("budget_usage").notNull().default({}),
});
export const ingestionScanTasks = pgTable(
  "ingestion_scan_tasks",
  {
    id: text().primaryKey(),
    sourceId: text("source_id").notNull(),
    channelId: text("channel_id").notNull(),
    roundId: text("round_id").references(() => ingestionRounds.id),
    rebuildOf: text("rebuild_of"),
    phase: text().$type<"fresh" | "backfill" | "revisit" | "retry">().notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    configHash: text("config_hash").notNull(),
    cursor: jsonb().$type<Record<string, unknown>>().notNull().default({
      pages: [],
      pending: [],
      seen: [],
    }),
    status: text()
      .$type<
        | "pending"
        | "running"
        | "partial"
        | "succeeded"
        | "failed"
        | "superseded"
      >()
      .notNull(),
    leafRunId: text("leaf_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceId, t.channelId],
      foreignColumns: [ingestionChannels.sourceId, ingestionChannels.id],
    }),
    foreignKey({ columns: [t.rebuildOf], foreignColumns: [t.id] }),
    unique().on(t.id, t.sourceId, t.channelId),
    unique().on(t.rebuildOf),
  ],
);
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: text().primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => ingestionSources.id),
    channelId: text("channel_id").notNull().default("default"),
    phase: text().$type<"fresh" | "backfill" | "revisit" | "retry">(),
    configHash: text("config_hash"),
    taskId: text("task_id"),
    roundId: text("round_id").references(() => ingestionRounds.id),
    budgetUsage: jsonb("budget_usage").notNull().default({}),
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
  },
  (t) => [
    foreignKey({
      columns: [t.sourceId, t.channelId],
      foreignColumns: [ingestionChannels.sourceId, ingestionChannels.id],
    }),
    foreignKey({
      columns: [t.taskId, t.sourceId, t.channelId],
      foreignColumns: [
        ingestionScanTasks.id,
        ingestionScanTasks.sourceId,
        ingestionScanTasks.channelId,
      ],
    }),
    unique().on(t.id, t.sourceId, t.channelId),
  ],
);
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
    evidenceRevision: integer("evidence_revision").notNull().default(1),
    evidenceState: text("evidence_state").notNull().default("current"),
  },
  (t) => [unique().on(t.sourceId, t.url), unique().on(t.id, t.sourceId)],
);
export const ingestionNoticeChannels = pgTable(
  "ingestion_notice_channels",
  {
    noticeId: text("notice_id").notNull(),
    sourceId: text("source_id").notNull(),
    channelId: text("channel_id").notNull(),
    firstDiscoveredAt: timestamp("first_discovered_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastDiscoveredAt: timestamp("last_discovered_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noticeId, t.sourceId, t.channelId] }),
    foreignKey({
      columns: [t.noticeId, t.sourceId],
      foreignColumns: [ingestionNotices.id, ingestionNotices.sourceId],
    }),
    foreignKey({
      columns: [t.sourceId, t.channelId],
      foreignColumns: [ingestionChannels.sourceId, ingestionChannels.id],
    }),
  ],
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
  classification: text().notNull().default("suspected"),
  ruleVersion: text("rule_version").notNull().default("legacy"),
  extractionKey: text("extraction_key"),
  classificationOverride: text("classification_override"),
  needsReview: boolean("needs_review").notNull().default(true),
  priority: integer().notNull().default(2),
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
export const ingestionAttachments = pgTable(
  "ingestion_attachments",
  {
    id: uuid().primaryKey(),
    noticeId: text("notice_id")
      .notNull()
      .references(() => ingestionNotices.id),
    canonicalUrl: text("canonical_url").notNull(),
    discoveredVersion: text("discovered_version")
      .notNull()
      .references(() => ingestionVersions.id),
    latestVersion: uuid("latest_version"),
    state: text().notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (t) => [unique().on(t.noticeId, t.canonicalUrl)],
);

export const ingestionExtractionRevisions = pgTable(
  "ingestion_extraction_revisions",
  {
    id: uuid().primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestionCandidates.id),
    sourceVersion: text("source_version")
      .notNull()
      .references(() => ingestionVersions.id),
    evidenceRevision: integer("evidence_revision").notNull(),
    ruleVersion: text("rule_version").notNull(),
    extractionKey: text("extraction_key").notNull(),
    data: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.candidateId, t.extractionKey)],
);

export const ingestionClassificationRevisions = pgTable(
  "ingestion_classification_revisions",
  {
    id: uuid().primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestionCandidates.id),
    candidateRevision: integer("candidate_revision").notNull(),
    previousClassification: text("previous_classification").notNull(),
    classification: text().notNull(),
    reason: text().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    evidenceRevision: integer("evidence_revision").notNull(),
    baseline: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => adminAccounts.id),
  },
);
export const ingestionNetworkWindows = pgTable("ingestion_network_windows", {
  dueAt: timestamp("due_at", { withTimezone: true }).primaryKey(),
  requests: integer().notNull(),
});
export const ingestionAttachmentEvents = pgTable(
  "ingestion_attachment_events",
  {
    id: uuid().primaryKey(),
    noticeId: text("notice_id")
      .notNull()
      .references(() => ingestionNotices.id),
    sourceVersion: text("source_version")
      .notNull()
      .references(() => ingestionVersions.id),
    evidenceRevision: integer("evidence_revision").notNull(),
    reason: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const ingestionAttachmentVersions = pgTable(
  "ingestion_attachment_versions",
  {
    id: uuid().primaryKey(),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => ingestionAttachments.id),
    previousVersion: uuid("previous_version"),
    revision: integer().notNull(),
    sha256: text(),
    noticeVersion: text("notice_version")
      .notNull()
      .references(() => ingestionVersions.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    mediaType: text("media_type").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    status: text().notNull(),
    segments: jsonb().notNull(),
    errorCode: text("error_code"),
    body: customType<{ data: Buffer; driverData: Buffer }>({
      dataType: () => "bytea",
    })(),
  },
  (t) => [
    unique().on(t.attachmentId, t.revision),
    unique().on(t.id, t.attachmentId),
  ],
);
export const ingestionEvidenceSets = pgTable(
  "ingestion_evidence_sets",
  {
    noticeId: text("notice_id")
      .notNull()
      .references(() => ingestionNotices.id),
    revision: integer().notNull(),
    sourceVersion: text("source_version")
      .notNull()
      .references(() => ingestionVersions.id),
    attachmentVersions: jsonb("attachment_versions").notNull(),
    state: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noticeId, t.revision] })],
);
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
export const users = pgTable("users", {
  id: text().primaryKey(),
  nickname: text().notNull(),
  status: text().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const campusBindings = pgTable(
  "campus_bindings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    source: text().notNull(),
    subjectHmac: text("subject_hmac").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.source] }),
    unique("campus_bindings_source_subject_hmac_key").on(
      t.source,
      t.subjectHmac,
    ),
  ],
);
export const campusQualifications = pgTable("campus_qualifications", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  source: text().notNull(),
  termId: text("term_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const campusProfiles = pgTable("campus_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  source: text().notNull(),
  ciphertext: text().notNull(),
  nonce: text().notNull(),
  tag: text().notNull(),
  keyId: text("key_id").notNull(),
  version: integer().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const campusTransactions = pgTable("campus_transactions", {
  id: text().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sessionId: text("session_id").notNull(),
  instanceId: text("instance_id").notNull(),
  termId: text("term_id").notNull(),
  status: text().notNull(),
  operation: text(),
  challengeVersion: text("challenge_version"),
  reason: text(),
  qualification: jsonb().$type<{
    status: "valid";
    termId: string;
    verifiedAt: string;
    validUntil: string;
    source: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export const campusAuditLogs = pgTable("campus_audit_logs", {
  id: text().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  requestId: text("request_id").notNull(),
  kind: text().notNull(),
  reason: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const campusRateBudgets = pgTable("campus_rate_budgets", {
  id: text().primaryKey(),
  events: jsonb().$type<number[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const wechatIdentities = pgTable(
  "wechat_identities",
  {
    id: text().primaryKey(),
    appId: text("app_id").notNull(),
    openId: text("open_id").notNull(),
    unionId: text("union_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("wechat_identities_app_open").on(t.appId, t.openId)],
);
export const authSessions = pgTable("auth_sessions", {
  id: text().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  absoluteExpiresAt: timestamp("absolute_expires_at", {
    withTimezone: true,
  }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
});
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text().primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => authSessions.id),
    generation: integer().notNull(),
    accessHash: text("access_hash").notNull().unique(),
    accessExpiresAt: timestamp("access_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshHash: text("refresh_hash").notNull().unique(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("auth_tokens_session_generation").on(t.sessionId, t.generation),
  ],
);
export const authAuditLogs = pgTable("auth_audit_logs", {
  id: text().primaryKey(),
  kind: text().notNull(),
  userId: text("user_id").references(() => users.id),
  sessionId: text("session_id"),
  requestId: text("request_id").notNull(),
  metadata: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    kind: text().notNull(),
    subject: text().notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    count: integer().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.kind, t.subject, t.windowStartedAt],
    }),
  ],
);

export const adminAccounts = pgTable("admin_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  username: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordSalt: bytea("password_salt").notNull(),
  passwordHash: bytea("password_hash").notNull(),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const adminSessions = pgTable("admin_sessions", {
  id: uuid().primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => adminAccounts.id),
  tokenHash: bytea("token_hash").notNull().unique(),
  csrfHash: bytea("csrf_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const adminOperations = pgTable("admin_operations", {
  operationId: uuid("operation_id").primaryKey().defaultRandom(),
  commandOperationId: uuid("command_operation_id"),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text().notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id"),
  reason: text().notNull(),
  result: text().notNull(),
  requestId: text("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminIngestionCommands = pgTable(
  "admin_ingestion_commands",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => adminAccounts.id),
    operationId: uuid("operation_id").notNull(),
    action: text().notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.operationId] })],
);

export const ingestionRequests = pgTable("ingestion_requests", {
  id: uuid().primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => adminAccounts.id),
  sourceId: text("source_id").notNull(),
  status: text().notNull(),
  options: jsonb().notNull(),
  runId: text("run_id").references(() => ingestionRuns.id),
  result: jsonb(),
  error: text(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const ingestionAttachmentRequests = pgTable(
  "ingestion_attachment_requests",
  {
    id: uuid().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => adminAccounts.id),
    attachmentId: uuid("attachment_id").notNull(),
    versionId: uuid("version_id"),
    operationId: uuid("operation_id").notNull(),
    operation: text().notNull(),
    expectedEvidenceRevision: integer("expected_evidence_revision").notNull(),
    reason: text().notNull(),
    status: text().notNull(),
    result: jsonb(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
);

export const ingestionReviewRevisions = pgTable(
  "ingestion_review_revisions",
  {
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestionCandidates.id),
    candidateRevision: integer("candidate_revision").notNull(),
    sourceVersion: text("source_version")
      .notNull()
      .references(() => ingestionVersions.id),
    targetId: text("target_id").notNull(),
    review: jsonb().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => adminAccounts.id),
    reason: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.candidateId, table.candidateRevision] }),
  ],
);

export const ingestionReviewPreviews = pgTable("ingestion_review_previews", {
  id: uuid().primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => adminAccounts.id),
  purpose: text().notNull(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => ingestionCandidates.id),
  sourceVersion: text("source_version")
    .notNull()
    .references(() => ingestionVersions.id),
  candidateRevision: integer("candidate_revision").notNull(),
  targetId: text("target_id").notNull(),
  baseline: text().notNull(),
  reviewHash: text("review_hash").notNull(),
  result: jsonb().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
