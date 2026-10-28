import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BoundedFetcher,
  defaultLimits,
  normalizeUrl,
  sources,
  collegeVerificationCandidates,
  type Channel,
  type Source,
} from "@hehuoda/sicau-connectors/notices";
import { DatabaseService } from "../database/database.service.js";
import type { AdminContext } from "../admin/admin.service.js";
import { AdminIngestionOperation } from "./admin-ingestion-operation.js";
import { dateRange, IngestionRunner, type ScanOptions } from "./runner.js";
import { configureSource, hash, recoverInterruptedRuns } from "./store.js";
import { channelFingerprint, readChannel } from "./channel-store.js";
import type {
  ConfigureChannelDto,
  ConfigureSourceDto,
  IngestionCommandDto,
  IngestionPageQueryDto,
  ScanDto,
  VerifyChannelDto,
} from "./admin-ingestion.dto.js";

const defaultSettings = {
  ...defaultLimits,
  maxPages: 10,
  frequencyMinutes: 60,
};
const RUN_SELECT = `r.id,r.source_id AS "sourceId",r.channel_id AS "channelId",r.phase,r.config_hash AS "configHash",r.task_id AS "taskId",r.round_id AS "roundId",r.budget_usage AS "budgetUsage",r.status,r.trigger,r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.options,r.counts,r.errors,r.cursor,ARRAY(SELECT c.id FROM ingestion_runs c WHERE c.options->>'resume'=r.id ORDER BY c.started_at,c.id) AS "resumedBy"`;

const channelBaseline = (
  source: Source,
  channel: Channel,
  state: {
    enabled: boolean;
    settings: Record<string, unknown>;
    verificationStatus: string;
  },
) =>
  hash({
    enabled: state.enabled,
    settings: state.settings,
    verificationStatus: state.verificationStatus,
    definitionFingerprint: channelFingerprint(source, channel),
  });
const verificationHistory = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value == null || (typeof value === "object" && !Object.keys(value).length)
      ? []
      : [value];

@Injectable()
export class AdminIngestionService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  runner: IngestionRunner;
  private readonly stop = new AbortController();
  private pending: Promise<void> | null = null;
  private wake = false;
  private ready: Promise<void> = Promise.resolve();
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: AdminIngestionOperation,
  ) {
    this.runner = new IngestionRunner(database.pool);
  }

  onApplicationBootstrap() {
    this.ready = this.recover().catch(() => undefined);
  }
  private async recover(includeAccepted = true) {
    const client = await this.database.pool.connect();
    try {
      if (
        !(await client.query("SELECT pg_try_advisory_lock(23003) AS locked"))
          .rows[0].locked
      )
        return;
      await recoverInterruptedRuns(this.database.pool);
      // The run may have committed before the process lost its request-result write.
      await client.query(
        `WITH linked AS (
        SELECT q.id AS request_id,r.* FROM ingestion_requests q JOIN LATERAL (
          SELECT * FROM ingestion_runs r WHERE r.id=q.run_id OR r.options->>'requestId'=q.id::text
          ORDER BY (r.id=q.run_id) DESC NULLS LAST,r.started_at DESC,r.id DESC LIMIT 1
        ) r ON true WHERE q.status='running' OR ($1 AND q.status='accepted')
      ) UPDATE ingestion_requests q SET run_id=r.id,
        status=CASE WHEN r.status IN ('succeeded','partial','failed') THEN 'completed' ELSE 'interrupted' END,
        result=jsonb_build_object('runId',r.id,'status',r.status,'source',r.source_id,'counts',r.counts,'errors',r.errors,'cursor',r.cursor),
        error=CASE WHEN r.status IN ('succeeded','partial','failed') THEN NULL ELSE '执行中断；请检查运行并显式续跑' END,
        finished_at=COALESCE(r.finished_at,now()) FROM linked r WHERE q.id=r.request_id`,
        [includeAccepted],
      );
      await client.query(
        "UPDATE ingestion_requests SET status='interrupted',error='执行中断；请检查请求及运行记录后显式恢复',finished_at=now() WHERE status='running' OR ($1 AND status='accepted')",
        [includeAccepted],
      );
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(23003)")
        .catch(() => undefined);
      client.release(true);
    }
  }
  private source(id: string): Source {
    const source = sources.find((entry) => entry.id === id);
    if (!source) throw new NotFoundException();
    return source;
  }
  private channel(source: Source, id: string): Channel {
    const channel = source.channels.find((entry) => entry.id === id);
    if (!channel) throw new NotFoundException();
    return channel;
  }
  async sourceDetail(id: string) {
    const source = this.source(id);
    const row = (
      await this.database.pool.query(
        "SELECT enabled,settings FROM ingestion_sources WHERE id=$1",
        [id],
      )
    ).rows[0];
    const enabled: boolean = row?.enabled ?? true;
    const settings = { ...defaultSettings, ...row?.settings };
    const latest =
      (
        await this.database.pool.query(
          `SELECT ${RUN_SELECT} FROM ingestion_runs r WHERE source_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1`,
          [id],
        )
      ).rows[0] ?? null;
    const channelStates = await Promise.all(
      source.channels.map(async (channel) => {
        const channelRow = await readChannel(
          this.database.pool,
          source.id,
          channel.id,
        );
        const channelEnabled: boolean =
          channelRow?.enabled ??
          (!!source.legacyDefaultEnabled &&
          channel.id === source.defaultChannelId
            ? enabled
            : false);
        const channelSettings = {
          ...defaultSettings,
          ...settings,
          ...channelRow?.settings,
        };
        const verificationStatus = channelRow?.verification_status ?? "pending";
        const taskRows = (
          await this.database.pool.query(
            `SELECT phase,status,count(*)::int AS count,min(from_date)::text AS "from",max(to_date)::text AS "to",sum(jsonb_array_length(cursor->'pending'))::int AS "pendingNotices",sum(jsonb_array_length(cursor->'pages'))::int AS "pendingPages" FROM ingestion_scan_tasks
             WHERE source_id=$1 AND channel_id=$2 GROUP BY phase,status ORDER BY phase,status`,
            [source.id, channel.id],
          )
        ).rows as {
          phase: string;
          status: string;
          count: number;
          from: string;
          to: string;
          pendingNotices: number;
          pendingPages: number;
        }[];
        const coverage: Record<
          string,
          { total: number; statuses: Record<string, number>; ranges: unknown[] }
        > = {};
        for (const task of taskRows) {
          const phase =
            coverage[task.phase] ??
            (coverage[task.phase] = { total: 0, statuses: {}, ranges: [] });
          phase.total += task.count;
          phase.statuses[task.status] = task.count;
          phase.ranges.push({
            status: task.status,
            from: task.from,
            to: task.to,
            completed: task.status === "succeeded",
            pendingNotices: task.pendingNotices,
            pendingPages: task.pendingPages,
            scope:
              task.phase === "fresh"
                ? "first-page"
                : task.phase === "backfill"
                  ? "list-traversal"
                  : "known-notice-snapshot",
          });
        }
        const pendingCount = taskRows
          .filter((task) =>
            ["pending", "running", "partial", "failed"].includes(task.status),
          )
          .reduce(
            (total, task) => total + task.pendingNotices + task.pendingPages,
            0,
          );
        const round =
          (
            await this.database.pool.query(
              `SELECT d.id,d.due_at AS "dueAt",d.next_due_at AS "nextDueAt",
                d.started_at AS "startedAt",d.finished_at AS "finishedAt",d.status,
                d.fresh_check_status AS "freshCheckStatus",d.rotation_cursor AS "rotationCursor",
                d.budget_usage AS "budgetUsage"
               FROM ingestion_rounds d
               WHERE d.fresh_check_status ? ($1 || '/' || $2)
               ORDER BY d.started_at DESC NULLS LAST,d.id DESC LIMIT 1`,
              [source.id, channel.id],
            )
          ).rows[0] ?? null;
        if (round) {
          round.completedBeforeNextTrigger =
            !!round.finishedAt &&
            new Date(round.finishedAt) <= new Date(round.nextDueAt);
          round.overdue =
            !round.finishedAt &&
            Date.now() > new Date(round.nextDueAt).getTime();
        }
        const channelLatest =
          (
            await this.database.pool.query(
              `SELECT budget_usage AS "budgetUsage" FROM ingestion_runs
               WHERE source_id=$1 AND channel_id=$2
               ORDER BY started_at DESC,id DESC LIMIT 1`,
              [source.id, channel.id],
            )
          ).rows[0] ?? null;
        const delay = (
          await this.database.pool.query(
            `WITH raw AS (
               SELECT timezone('Asia/Shanghai',v.fetched_at)::date AS fetched_date,
                      v.article->>'publishedAt' AS published_at
                 FROM ingestion_notice_channels nc
                 JOIN ingestion_notices n
                   ON n.id=nc.notice_id AND n.source_id=nc.source_id
                 JOIN ingestion_versions v
                   ON v.notice_id=n.id AND v.revision=1
                WHERE nc.source_id=$1 AND nc.channel_id=$2
             ), parsed AS (
               SELECT fetched_date,published_at,
                 CASE WHEN published_at ~ '^\\d{4}-\\d{2}-\\d{2}$'
                           AND substring(published_at,1,4)>='0001'
                           AND substring(published_at,6,2) BETWEEN '01' AND '12'
                           AND substring(published_at,9,2) BETWEEN '01' AND '31'
                      THEN to_date(published_at,'YYYY-MM-DD') END AS published_date
                 FROM raw
             ), valid AS (
               SELECT fetched_date-published_date AS delay_days
                 FROM parsed
                WHERE published_date IS NOT NULL
                  AND to_char(published_date,'YYYY-MM-DD')=published_at
                  AND published_date<=fetched_date
             )
             SELECT count(*)::int AS "sampleCount",
                    round(avg(delay_days)::numeric,2) AS "averageDays",
                    max(delay_days)::int AS "maxDays"
               FROM valid`,
            [source.id, channel.id],
          )
        ).rows[0];
        const channelSettingsTyped = channelSettings as Record<string, unknown>;
        return {
          id: channel.id,
          adapterId: channel.adapterId,
          version: channel.version,
          enabled: channelEnabled,
          settings: channelSettings,
          baseline: channelBaseline(source, channel, {
            enabled: channelEnabled,
            settings: channelSettingsTyped,
            verificationStatus,
          }),
          verificationStatus,
          verifiedAt: channelRow?.verified_at ?? null,
          verifiedBy: channelRow?.verified_by ?? null,
          verification: verificationHistory(channelRow?.verification),
          backoffUntil: channelRow?.backoff_until ?? null,
          failureCount: channelRow?.failure_count ?? 0,
          activatedOn: channelRow?.activated_on ?? null,
          pendingCount,
          coverage,
          lastSuccessfulCheck: channelRow?.last_successful_check ?? null,
          budgetUsage: round?.budgetUsage ?? channelLatest?.budgetUsage ?? null,
          latestRound: round,
          discoveryDelay: {
            precision: "days" as const,
            sampleCount: Number(delay?.sampleCount ?? 0),
            averageDays:
              delay?.averageDays == null ? null : Number(delay.averageDays),
            maxDays: delay?.maxDays == null ? null : Number(delay.maxDays),
          },
        };
      }),
    );
    return {
      ...source,
      channels: source.channels.map((ch) => ({
        ...ch,
        ...channelStates.find((state) => state.id === ch.id),
      })),
      enabled,
      settings,
      baseline: hash({ enabled, settings }),
      available: true,
      latestRun: latest,
      channelStates,
    };
  }
  sourceList() {
    return Promise.all(sources.map((s) => this.sourceDetail(s.id)));
  }
  coverageCandidates() {
    return collegeVerificationCandidates;
  }

  configure(context: AdminContext, id: string, body: ConfigureSourceDto) {
    const source = this.source(id);
    if (body.enabled === undefined && body.settings === undefined)
      throw new BadRequestException();
    return this.commands.execute(
      context,
      body,
      {
        action: "ingestion.configure",
        objectType: "source",
        objectId: id,
        reason: body.reason,
      },
      body,
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(23005,hashtext($1))", [
          id,
        ]);
        const current = (
          await client.query(
            "SELECT enabled,settings FROM ingestion_sources WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        const settings = { ...defaultSettings, ...current?.settings };
        const enabled = current?.enabled ?? true;
        if (body.baseline !== hash({ enabled, settings }))
          throw new ConflictException();
        if (body.enabled === true && !source.legacyDefaultEnabled) {
          const ready = (
            await client.query(
              "SELECT 1 FROM ingestion_channels WHERE source_id=$1 AND enabled=true AND verification_status='verified' LIMIT 1",
              [id],
            )
          ).rowCount;
          if (!ready)
            throw new ConflictException("至少一个已核验栏目启用后才能启用来源");
        }
        if (
          body.enabled === true &&
          (await readChannel(client, id, source.defaultChannelId))
            ?.verification_status === "rejected"
        )
          throw new ConflictException("栏目核验已失效，须重新核验后启用");
        await client.query(
          "INSERT INTO ingestion_sources(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [id, JSON.stringify(source)],
        );
        const nextEnabled = body.enabled ?? enabled;
        let configured;
        try {
          configured = await configureSource(client, source, nextEnabled, {
            ...Object.fromEntries(
              Object.entries(body.settings ?? {}).filter(
                ([, value]) => value !== undefined,
              ),
            ),
          });
        } catch (error) {
          if (error instanceof Error && !("code" in error))
            throw new BadRequestException();
          throw error;
        }
        const next = configured.settings;
        if (source.legacyDefaultEnabled)
          await client.query(
            "UPDATE ingestion_channels SET enabled=$3,settings=$4 WHERE source_id=$1 AND id=$2",
            [id, source.defaultChannelId, nextEnabled, JSON.stringify({})],
          );
        const latestRun =
          (
            await client.query(
              `SELECT ${RUN_SELECT} FROM ingestion_runs r WHERE source_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1`,
              [id],
            )
          ).rows[0] ?? null;
        return {
          ...source,
          enabled: nextEnabled,
          settings: next,
          baseline: hash({ enabled: nextEnabled, settings: next }),
          available: true,
          latestRun,
        };
      },
    );
  }
  async configureChannel(
    context: AdminContext,
    sourceId: string,
    channelId: string,
    body: ConfigureChannelDto,
  ) {
    const source = this.source(sourceId);
    const channel = this.channel(source, channelId);
    if (body.enabled === undefined && body.settings === undefined)
      throw new BadRequestException();
    return this.commands.execute(
      context,
      body,
      {
        action: "ingestion.configure",
        objectType: "source",
        objectId: `${sourceId}/channels/${channelId}`,
        reason: body.reason,
      },
      body,
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(23005,hashtext($1))", [
          sourceId,
        ]);
        await client.query("SELECT pg_advisory_xact_lock(23005,hashtext($1))", [
          `${sourceId}/${channelId}`,
        ]);
        await client.query(
          "INSERT INTO ingestion_sources(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [sourceId, source],
        );
        await client.query(
          "INSERT INTO ingestion_channels(source_id,id,data) VALUES($1,$2,$3) ON CONFLICT(source_id,id) DO NOTHING",
          [sourceId, channelId, channel],
        );
        const row = await readChannel(client, sourceId, channelId);
        if (!row) throw new NotFoundException();
        const verificationStatus: string = row.verification_status ?? "pending";
        const enabled: boolean = row.enabled ?? false;
        const parent = (
          await client.query(
            "SELECT settings FROM ingestion_sources WHERE id=$1",
            [sourceId],
          )
        ).rows[0];
        const settings = {
          ...defaultSettings,
          ...parent?.settings,
          ...row.settings,
        };
        const currentBaseline = channelBaseline(source, channel, {
          enabled,
          settings,
          verificationStatus,
        });
        if (body.baseline !== currentBaseline)
          throw new ConflictException("栏目配置已变化，请刷新后重试");
        const legacyDefault =
          !!source.legacyDefaultEnabled &&
          channelId === source.defaultChannelId;
        if (
          body.enabled === true &&
          verificationStatus !== "verified" &&
          !enabled
        )
          throw new ConflictException("栏目核验通过后才能启用");
        const nextEnabled = body.enabled ?? enabled;
        const nextSettings = {
          ...settings,
          ...Object.fromEntries(
            Object.entries(body.settings ?? {}).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        };
        try {
          new BoundedFetcher(source, nextSettings);
        } catch {
          throw new BadRequestException("栏目请求预算或时间配置超出边界");
        }
        const updated = await client.query(
          `UPDATE ingestion_channels SET enabled=$3,settings=$4,
             activated_on=CASE WHEN $3 AND NOT enabled AND $5='verified' THEN (now() AT TIME ZONE 'Asia/Shanghai')::date ELSE activated_on END
           WHERE source_id=$1 AND id=$2 RETURNING activated_on`,
          [
            sourceId,
            channelId,
            nextEnabled,
            JSON.stringify(nextSettings),
            verificationStatus,
          ],
        );
        if (legacyDefault) {
          const sourceSettings = Object.fromEntries(
            Object.entries(nextSettings).filter(
              ([, value]) => typeof value === "number",
            ),
          ) as Record<string, number>;
          await configureSource(client, source, nextEnabled, sourceSettings);
        }
        return {
          ...channel,
          enabled: nextEnabled,
          settings: nextSettings,
          verificationStatus,
          baseline: channelBaseline(source, channel, {
            enabled: nextEnabled,
            settings: nextSettings,
            verificationStatus,
          }),
          verifiedAt: row.verified_at ?? null,
          verifiedBy: row.verified_by ?? null,
          activatedOn:
            updated.rows[0]?.activated_on ?? row.activated_on ?? null,
        };
      },
    );
  }
  async verifyChannel(
    context: AdminContext,
    sourceId: string,
    channelId: string,
    body: VerifyChannelDto,
  ) {
    const source = this.source(sourceId);
    const channel = this.channel(source, channelId);
    const date = new Date(`${body.checkedAt}T00:00:00.000Z`);
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== body.checkedAt ||
      body.checkedAt > today
    )
      throw new BadRequestException("核验日期必须是有效且不晚于今天的日期");
    if (
      body.status === "verified" &&
      (body.paginationResult !== "success" || body.sampleUrls.length === 0)
    )
      throw new BadRequestException("通过核验须提供通知样本并确认分页成功");
    const noticePath = new RegExp(channel.noticePath);
    for (const value of body.sampleUrls) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new BadRequestException("通知样本 URL 无效");
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== source.host ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !noticePath.test(url.pathname)
      )
        throw new BadRequestException(
          "通知样本 URL 须匹配当前栏目的同源注册通知路径",
        );
    }
    return this.commands.execute(
      context,
      body,
      {
        action: "ingestion.configure",
        objectType: "source",
        objectId: `${sourceId}/channels/${channelId}`,
        reason: body.reason,
      },
      body,
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(23005,hashtext($1))", [
          sourceId,
        ]);
        await client.query("SELECT pg_advisory_xact_lock(23005,hashtext($1))", [
          `${sourceId}/${channelId}`,
        ]);
        await client.query(
          "INSERT INTO ingestion_sources(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [sourceId, source],
        );
        await client.query(
          "INSERT INTO ingestion_channels(source_id,id,data) VALUES($1,$2,$3) ON CONFLICT(source_id,id) DO NOTHING",
          [sourceId, channelId, channel],
        );
        const row = await readChannel(client, sourceId, channelId);
        if (!row) throw new NotFoundException();
        const history = verificationHistory(row.verification);
        const entry = {
          status: body.status,
          checkedAt: body.checkedAt,
          sampleUrls: body.sampleUrls,
          paginationResult: body.paginationResult,
          reason: body.reason,
          checkedBy: context.id,
          recordedAt: new Date().toISOString(),
        };
        history.push(entry);
        const legacyDefault =
          !!source.legacyDefaultEnabled &&
          channelId === source.defaultChannelId;
        const nextEnabled =
          body.status === "rejected" ||
          (body.status === "pending" && !legacyDefault)
            ? false
            : Boolean(row.enabled);
        await client.query(
          `UPDATE ingestion_channels SET verification_status=$3,verification=$4,
             verified_at=CASE WHEN $3='verified' THEN $5::date ELSE NULL END,
             verified_by=CASE WHEN $3='verified' THEN $6 ELSE NULL END,
             enabled=$7 WHERE source_id=$1 AND id=$2`,
          [
            sourceId,
            channelId,
            body.status,
            JSON.stringify(history),
            body.checkedAt,
            context.id,
            nextEnabled,
          ],
        );
        if (legacyDefault && !nextEnabled)
          await client.query(
            "UPDATE ingestion_sources SET enabled=false WHERE id=$1",
            [sourceId],
          );
        const parentSettings = (
          await client.query(
            "SELECT settings FROM ingestion_sources WHERE id=$1",
            [sourceId],
          )
        ).rows[0]?.settings;
        const effectiveSettings = {
          ...defaultSettings,
          ...parentSettings,
          ...row.settings,
        };
        return {
          ...channel,
          enabled: nextEnabled,
          verificationStatus: body.status,
          verifiedAt: body.status === "verified" ? body.checkedAt : null,
          verifiedBy: body.status === "verified" ? context.id : null,
          verification: history,
          settings: effectiveSettings,
          activatedOn: row.activated_on,
          baseline: channelBaseline(source, channel, {
            enabled: nextEnabled,
            settings: effectiveSettings,
            verificationStatus: body.status,
          }),
        };
      },
    );
  }
  async runs(query: IngestionPageQueryDto) {
    if (query.sourceId) this.source(query.sourceId);
    if (query.channelId && !query.sourceId) throw new BadRequestException();
    if (query.channelId)
      this.channel(this.source(query.sourceId!), query.channelId);
    try {
      for (const day of [query.from, query.to])
        if (day) dateRange({ sourceId: "", from: day, to: day });
      if (query.from && query.to && query.from > query.to) throw new Error();
    } catch {
      throw new BadRequestException();
    }
    const params: unknown[] = [],
      filters: string[] = [];
    for (const [column, value, cast, operator] of [
      ["source_id", query.sourceId, "", "="],
      ["channel_id", query.channelId, "", "="],
      ["status", query.status, "", "="],
      ["started_at", query.from, "::date", ">="],
      ["started_at", query.to, "::date + interval '1 day'", "<"],
    ])
      if (value) {
        params.push(value);
        filters.push(`r.${column}${operator}$${params.length}${cast}`);
      }
    const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
    // One statement keeps the count and page on the same database snapshot.
    const result = await this.database.pool.query(
      `SELECT (SELECT count(*)::int FROM ingestion_runs r${where}) AS total,COALESCE((SELECT jsonb_agg(page) FROM (SELECT ${RUN_SELECT} FROM ingestion_runs r${where} ORDER BY r.started_at DESC,r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}) page),'[]'::jsonb) AS items`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { ...result.rows[0], page: query.page, pageSize: query.pageSize };
  }
  async runDetail(id: string) {
    const row = (
      await this.database.pool.query(
        `SELECT ${RUN_SELECT} FROM ingestion_runs r WHERE r.id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
  async scan(context: AdminContext, body: ScanDto) {
    const source = this.source(body.sourceId);
    const channelId =
      body.channelId ?? (body.phase ? source.defaultChannelId : undefined);
    const channel = this.channel(source, channelId ?? source.defaultChannelId);
    if (body.rebuildTaskId && !body.phase)
      throw new BadRequestException("显式重建任务时必须指定扫描阶段");
    let backfillRange: { from: string; to: string } | undefined;
    if (body.phase === "backfill") {
      const state = await readChannel(
        this.database.pool,
        source.id,
        channelId!,
      );
      const to = state?.activated_on ?? dateRange({ sourceId: source.id }).to;
      const from = new Date(Date.parse(to) - 365 * 86400000)
        .toISOString()
        .slice(0, 10);
      backfillRange = { from, to };
      if ((body.from && body.from !== from) || (body.to && body.to !== to))
        throw new BadRequestException(
          "backfill范围固定为启用日期前365天，自定义范围请省略phase",
        );
    }
    let normalizedUrl: string | undefined;
    try {
      if (!(body.phase === "backfill" && !body.from && !body.to))
        dateRange(body);
      if (body.url) {
        normalizedUrl = normalizeUrl(body.url, source);
        if (
          !new RegExp(channel.noticePath).test(new URL(normalizedUrl).pathname)
        )
          throw new Error("通知地址不属于所选栏目");
      }
    } catch {
      throw new BadRequestException();
    }
    const options: ScanOptions = {
      sourceId: body.sourceId,
      ...(backfillRange ?? dateRange(body)),
      ...(normalizedUrl ? { url: normalizedUrl } : {}),
      ...(channelId ? { channelId } : {}),
      ...(body.phase ? { phase: body.phase } : {}),
      ...(body.rebuildTaskId ? { rebuildTaskId: body.rebuildTaskId } : {}),
      preview: body.preview ?? false,
      trigger: "manual",
    };
    return this.accept(context, body, options, body);
  }
  async resume(context: AdminContext, id: string, body: IngestionCommandDto) {
    const run = await this.runDetail(id);
    const source = this.source(run.sourceId);
    const channelId: string =
      run.channelId ?? run.options?.channelId ?? source.defaultChannelId;
    const channel = this.channel(source, channelId);
    const state = await readChannel(this.database.pool, source.id, channelId);
    const sourceConfig = (
      await this.database.pool.query(
        "SELECT enabled FROM ingestion_sources WHERE id=$1",
        [source.id],
      )
    ).rows[0];
    if (
      sourceConfig?.enabled === false ||
      (state && !state.enabled) ||
      (state?.verification_status !== "verified" &&
        !(
          source.legacyDefaultEnabled &&
          channelId === source.defaultChannelId &&
          state?.verification_status === "pending"
        ))
    )
      throw new ConflictException("栏目已停用或尚未核验，不能续跑");
    if (
      run.configHash &&
      run.configHash !== channelFingerprint(source, channel)
    )
      throw new ConflictException("栏目配置已变化，必须显式重建任务后再扫描");
    const options: ScanOptions = {
      ...run.options,
      sourceId: run.sourceId,
      channelId,
      resume: id,
      trigger: "resume",
      preview: false,
    };
    return this.accept(context, body, options, { runId: id, ...body });
  }
  async retry(context: AdminContext, id: string, body: IngestionCommandDto) {
    const request = await this.requestDetail(id);
    if (!["failed", "interrupted"].includes(request.status))
      throw new ConflictException();
    if (request.runId) return this.resume(context, request.runId, body);
    // No run was created: repeat the persisted original input, never a newly guessed date window.
    const options = (
      await this.database.pool.query(
        "SELECT options FROM ingestion_requests WHERE id=$1",
        [id],
      )
    ).rows[0].options as ScanOptions;
    return this.accept(context, body, options, { requestId: id, ...body });
  }
  private async accept(
    context: AdminContext,
    body: IngestionCommandDto,
    options: ScanOptions,
    payload: unknown,
  ) {
    delete options.roundId;
    delete options.workSliceRequests;
    delete options.workSliceDurationMs;
    await this.ready;
    const response = await this.commands.execute(
      context,
      body,
      {
        action: options.resume ? "ingestion.resume" : "ingestion.scan",
        objectType: "source",
        objectId: options.sourceId,
        reason: body.reason,
      },
      payload,
      async (client) => {
        if (
          !(
            await client.query(
              "SELECT pg_try_advisory_xact_lock(23006) AS locked",
            )
          ).rows[0].locked
        )
          throw new ConflictException("调度轮执行中，请待本轮结束后重试");
        if (
          !(
            await client.query(
              "SELECT pg_try_advisory_xact_lock(23000) AS locked",
            )
          ).rows[0].locked
        )
          throw new ConflictException();
        if (
          (
            await client.query(
              "SELECT id FROM ingestion_requests WHERE status IN ('accepted','running') LIMIT 1",
            )
          ).rowCount
        )
          throw new ConflictException();
        const source = this.source(options.sourceId);
        if (
          (
            await client.query(
              "SELECT enabled FROM ingestion_sources WHERE id=$1",
              [source.id],
            )
          ).rows[0]?.enabled === false
        )
          throw new ConflictException();
        const requestedChannelId = options.channelId ?? source.defaultChannelId;
        const requestedChannel = this.channel(source, requestedChannelId);
        const channelRow = await readChannel(
          client,
          source.id,
          requestedChannelId,
        );
        if (
          (channelRow && !channelRow.enabled) ||
          (channelRow?.verification_status !== "verified" &&
            !(
              source.legacyDefaultEnabled &&
              requestedChannelId === source.defaultChannelId &&
              (channelRow?.verification_status === "pending" || !channelRow)
            ))
        )
          throw new ConflictException("栏目已停用或尚未核验，不能扫描");
        if (options.phase && !options.rebuildTaskId) {
          const active = (
            await client.query(
              "SELECT config_hash FROM ingestion_scan_tasks WHERE source_id=$1 AND channel_id=$2 AND phase=$3 AND status NOT IN ('succeeded','superseded') ORDER BY created_at,id LIMIT 1",
              [source.id, requestedChannelId, options.phase],
            )
          ).rows[0];
          if (
            active &&
            active.config_hash !== channelFingerprint(source, requestedChannel)
          )
            throw new ConflictException("栏目配置已变化，必须显式重建任务");
        }
        if (options.rebuildTaskId) {
          const task = (
            await client.query(
              "SELECT source_id,channel_id FROM ingestion_scan_tasks WHERE id=$1 FOR UPDATE",
              [options.rebuildTaskId],
            )
          ).rows[0];
          if (
            !task ||
            task.source_id !== source.id ||
            task.channel_id !== requestedChannelId
          )
            throw new NotFoundException("重建任务不存在或不属于该栏目");
        }
        if (options.resume) {
          const previous = (
            await client.query(
              "SELECT status,cursor,channel_id,config_hash FROM ingestion_runs WHERE id=$1",
              [options.resume],
            )
          ).rows[0];
          if (
            previous &&
            (previous.channel_id ?? source.defaultChannelId) !==
              requestedChannelId
          )
            throw new ConflictException("续跑栏目与原运行不一致");
          if (
            previous?.config_hash &&
            previous.config_hash !==
              channelFingerprint(source, requestedChannel)
          )
            throw new ConflictException(
              "栏目配置已变化，必须显式重建任务后再扫描",
            );
          if (
            !previous ||
            !["partial", "failed", "interrupted"].includes(previous.status) ||
            !(
              previous.cursor.pages?.length || previous.cursor.pending?.length
            ) ||
            (
              await client.query(
                "SELECT id FROM ingestion_runs WHERE options->>'resume'=$1",
                [options.resume],
              )
            ).rowCount
          )
            throw new ConflictException();
        }
        const requestId = randomUUID();
        await client.query(
          "INSERT INTO ingestion_requests(id,actor_id,source_id,status,options) VALUES($1,$2,$3,'accepted',$4)",
          [
            requestId,
            context.id,
            source.id,
            JSON.stringify({ ...options, requestId }),
          ],
        );
        return { requestId, status: "accepted" };
      },
    );
    this.kick();
    return response;
  }
  private kick() {
    this.wake = true;
    if (this.pending || this.stop.signal.aborted) return;
    this.pending = (async () => {
      do {
        this.wake = false;
        await this.drain();
      } while (this.wake && !this.stop.signal.aborted);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.pending = null;
      });
  }
  private async drain() {
    const lock = await this.database.pool.connect();
    try {
      if (
        !(await lock.query("SELECT pg_try_advisory_lock(23003) AS locked"))
          .rows[0].locked
      )
        return;
      while (!this.stop.signal.aborted) {
        const request = (
          await lock.query(
            "UPDATE ingestion_requests SET status='running',started_at=now() WHERE id=(SELECT id FROM ingestion_requests WHERE status='accepted' ORDER BY created_at,id LIMIT 1) RETURNING id,options",
          )
        ).rows[0];
        if (!request) break;
        try {
          const result = await this.runner.scan(
            request.options,
            this.stop.signal,
          );
          const failed =
            result.status === "locked" || result.status === "disabled";
          await lock.query(
            "UPDATE ingestion_requests SET status=$2,run_id=$3,result=$4,error=$5,finished_at=now() WHERE id=$1",
            [
              request.id,
              failed
                ? "failed"
                : result.status === "interrupted"
                  ? "interrupted"
                  : "completed",
              "runId" in result ? result.runId : null,
              JSON.stringify(result),
              failed
                ? result.status === "locked"
                  ? "执行锁被占用，请重新提交"
                  : "来源已停用"
                : null,
            ],
          );
        } catch {
          await lock.query(
            "UPDATE ingestion_requests SET status='failed',error='采集执行失败；检查运行记录后重试',finished_at=now() WHERE id=$1",
            [request.id],
          );
        }
      }
    } finally {
      await lock
        .query("SELECT pg_advisory_unlock(23003)")
        .catch(() => undefined);
      lock.release(true);
    }
  }
  async requestDetail(id: string) {
    await this.ready;
    const read = async () =>
      (
        await this.database.pool.query(
          `SELECT q.id AS "requestId",q.source_id AS "sourceId",q.status,q.options,COALESCE(q.run_id,(SELECT r.id FROM ingestion_runs r WHERE r.options->>'requestId'=q.id::text ORDER BY r.started_at DESC,r.id DESC LIMIT 1)) AS "runId",q.result,q.error,q.created_at AS "createdAt",q.started_at AS "startedAt",q.finished_at AS "finishedAt" FROM ingestion_requests q WHERE q.id=$1`,
          [id],
        )
      ).rows[0];
    const row = await read();
    if (!row) {
      const attachment = (
        await this.database.pool.query(
          `SELECT id AS "requestId",attachment_id AS "attachmentId",version_id AS "versionId",operation,status,result,
          error_code AS "errorCode",created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt"
         FROM ingestion_attachment_requests WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (!attachment) throw new NotFoundException();
      return {
        ...attachment,
        channelId: null,
        phase: null,
        taskId: null,
        taskProgress: null,
        budgetUsage: attachment.result?.usage ?? null,
        runId: null,
        error: attachment.errorCode ?? null,
        createdAt: attachment.createdAt.toISOString(),
        startedAt: attachment.startedAt?.toISOString() ?? null,
        finishedAt: attachment.finishedAt?.toISOString() ?? null,
      };
    }
    if (row.status === "running" && !this.pending) {
      await this.recover(false);
      Object.assign(row, await read());
    }
    if (row.status === "accepted") this.kick();
    const options = row.options as Record<string, unknown>;
    const run = row.runId ? await this.runDetail(row.runId) : null;
    const taskId =
      row.result?.taskId ??
      run?.taskId ??
      (typeof options.taskId === "string" ? options.taskId : null);
    const taskProgress = taskId
      ? ((
          await this.database.pool.query(
            `SELECT id,source_id AS "sourceId",channel_id AS "channelId",phase,
               from_date::text AS "fromDate",to_date::text AS "toDate",status,cursor,
               config_hash AS "configHash",round_id AS "roundId",rebuild_of AS "rebuildOf",
               updated_at AS "updatedAt"
             FROM ingestion_scan_tasks WHERE id=$1`,
            [taskId],
          )
        ).rows[0] ?? null)
      : null;
    const source = this.source(row.sourceId);
    row.channelId =
      run?.channelId ??
      (typeof options.channelId === "string"
        ? options.channelId
        : source.defaultChannelId);
    row.phase =
      run?.phase ?? (typeof options.phase === "string" ? options.phase : null);
    row.taskId = taskId;
    row.taskProgress = taskProgress;
    row.budgetUsage = row.result?.budgetUsage ?? run?.budgetUsage ?? null;
    return row;
  }
  async beforeApplicationShutdown() {
    this.stop.abort();
    await this.ready;
    await this.pending;
  }
}
