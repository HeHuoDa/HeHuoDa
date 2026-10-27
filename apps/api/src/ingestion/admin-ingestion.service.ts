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
  defaultLimits,
  normalizeUrl,
  sources,
  type Source,
} from "@hehuoda/sicau-connectors/notices";
import { DatabaseService } from "../database/database.service.js";
import type { AdminContext } from "../admin/admin.service.js";
import { AdminIngestionOperation } from "./admin-ingestion-operation.js";
import { dateRange, IngestionRunner, type ScanOptions } from "./runner.js";
import { configureSource, hash, recoverInterruptedRuns } from "./store.js";
import type {
  ConfigureSourceDto,
  IngestionCommandDto,
  IngestionPageQueryDto,
  ScanDto,
} from "./admin-ingestion.dto.js";

const defaultSettings = {
  ...defaultLimits,
  maxPages: 10,
  frequencyMinutes: 60,
};
const RUN_SELECT = `r.id,r.source_id AS "sourceId",r.status,r.trigger,r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.options,r.counts,r.errors,r.cursor,ARRAY(SELECT c.id FROM ingestion_runs c WHERE c.options->>'resume'=r.id ORDER BY c.started_at,c.id) AS "resumedBy"`;

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
      await client.query(
        "UPDATE ingestion_requests SET status='interrupted',error='执行中断；请检查运行并显式续跑',finished_at=now() WHERE status='running' OR ($1 AND status='accepted')",
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
    return {
      ...source,
      enabled,
      settings,
      baseline: hash({ enabled, settings }),
      available: true,
      latestRun: latest,
    };
  }
  sourceList() {
    return Promise.all(sources.map((s) => this.sourceDetail(s.id)));
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
  async runs(query: IngestionPageQueryDto) {
    if (query.sourceId) this.source(query.sourceId);
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
    this.source(body.sourceId);
    try {
      dateRange(body);
      if (body.url) normalizeUrl(body.url, this.source(body.sourceId));
    } catch {
      throw new BadRequestException();
    }
    const options: ScanOptions = {
      sourceId: body.sourceId,
      ...dateRange(body),
      ...(body.url ? { url: body.url } : {}),
      preview: body.preview ?? false,
      trigger: "manual",
    };
    return this.accept(context, body, options, body);
  }
  async resume(context: AdminContext, id: string, body: IngestionCommandDto) {
    const run = await this.runDetail(id);
    const options: ScanOptions = {
      ...run.options,
      sourceId: run.sourceId,
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
        if (options.resume) {
          const previous = (
            await client.query(
              "SELECT status,cursor FROM ingestion_runs WHERE id=$1",
              [options.resume],
            )
          ).rows[0];
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
    if (!row) throw new NotFoundException();
    if (row.status === "running" && !this.pending) {
      await this.recover(false);
      Object.assign(row, await read());
    }
    if (row.status === "accepted") this.kick();
    return row;
  }
  async beforeApplicationShutdown() {
    this.stop.abort();
    await this.ready;
    await this.pending;
  }
}
