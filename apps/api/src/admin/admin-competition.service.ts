import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { AdminService, type AdminContext } from "./admin.service.js";
import { AdminIngestionOperation } from "../ingestion/admin-ingestion-operation.js";
import { commandHash } from "../ingestion/store.js";
import {
  applyImportBatch,
  ImportValidationError,
  type ImportCompetition,
} from "../competitions/import.js";
import { readCatalog } from "../competitions/catalog.js";
import {
  applyCommand,
  baselineOf,
  compareChanges,
  publishBlocks,
  savePublicationInvalid,
  type AdminCompetitionChange,
  type CompetitionAction,
  type PublishBlock,
} from "./competition-admin.model.js";
import { AdminCompetitionRepository } from "./competition-admin.repository.js";
import type {
  AdminCompetitionCommandDto,
  AdminCompetitionListQueryDto,
  AdminCompetitionPreviewDto,
} from "./admin-competition.dto.js";
import type { AdminOperation } from "./admin-operations.service.js";
import { createApiError } from "../common/api-error.js";

// 管理端正式比赛入口固定走手工维护通道：公开 HTTPS 外链由管理员人工核实官方性。
// 采集与审核通道仍使用 import.ts 的缺省 sicau 语义，互不放开。
const MANUAL_IMPORT_OPTIONS = {
  mode: "manual",
  confirmPublished: true,
} as const;

// 与 applyImportBatch 相同的目录锁，保证与采集/审核写入口互斥。
const COMPETITION_LOCK = 22002;
const PREVIEW_SAVEPOINT = "admin_competition_preview";

export interface CompetitionCommandOutcome {
  targetId: string;
  action: CompetitionAction;
  publication: string;
  baseline: string;
  changes: AdminCompetitionChange[];
  blocks: PublishBlock[];
}

interface ApplyInput {
  action: CompetitionAction;
  targetId: string;
  baseline: string;
  patch?: Record<string, unknown>;
  preview: boolean;
  confirmPublished: boolean;
  previewId?: string;
  actorId?: string;
}

@Injectable()
export class AdminCompetitionService {
  constructor(
    private readonly repository: AdminCompetitionRepository,
    private readonly commands: AdminIngestionOperation,
    private readonly admin: AdminService,
  ) {}

  list(query: AdminCompetitionListQueryDto) {
    return this.repository.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status as "draft" | "published" | "hidden" | undefined,
      q: query.q?.trim() || undefined,
    });
  }

  async detail(id: string) {
    const record = await this.repository.detail(id);
    if (!record) throw new NotFoundException();
    return record;
  }

  /** 未保存的届次也有稳定基线，便于新建前先预览。 */
  async baseline(id: string) {
    const client = await this.admin.database.pool.connect();
    try {
      const catalog = await readCatalog(client, { competitionIds: [id] });
      const record = catalog.competitions[0] ?? null;
      return {
        targetId: id,
        exists: !!record,
        baseline: baselineOf(record, catalog.colleges),
        publication: record?.publication ?? null,
      };
    } finally {
      client.release();
    }
  }

  /** 预览：在同一事务内应用同一套合并与校验，保存点回滚，不提交正式数据。 */
  async preview(
    context: AdminContext,
    targetId: string,
    command: AdminCompetitionPreviewDto,
  ) {
    this.assertTargetId(targetId);
    return this.commands.execute(
      context,
      command,
      this.operation(command.action, targetId, command.reason),
      { kind: "preview", command },
      async (client) => {
        const result = await this.lockedApply(client, {
          action: command.action,
          targetId,
          baseline: command.baseline,
          patch: command.patch,
          preview: true,
          confirmPublished: true,
        });
        await client.query(
          "INSERT INTO admin_competition_previews(id,actor_id,action,target_id,baseline,command_hash,changes,blocks) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            command.operationId,
            context.id,
            command.action,
            targetId,
            command.baseline,
            commandHash({
              action: command.action,
              targetId,
              baseline: command.baseline,
              patch: command.patch ?? null,
            }),
            JSON.stringify(result.changes),
            JSON.stringify(result.blocks),
          ],
        );
        return {
          previewId: command.operationId,
          targetId,
          action: command.action,
          baseline: command.baseline,
          publication: result.publication,
          changes: result.changes,
          blocks: result.blocks,
        };
      },
      {
        table: "admin_competition_commands",
        lockClass: 23006,
        action: command.action,
      },
    );
  }

  /**
   * 执行保存、发布或隐藏。成功写入、幂等回执与成功审计在同一事务提交；
   * 失败先回滚业务再记录失败审计。同一 operationId 重试返回首次结果。
   */
  async execute(
    context: AdminContext,
    targetId: string,
    command: AdminCompetitionCommandDto,
  ) {
    this.assertTargetId(targetId);
    const result = await this.commands.execute<CompetitionCommandOutcome>(
      context,
      command,
      this.operation(command.action, targetId, command.reason),
      { kind: "command", command },
      (client) =>
        this.lockedApply(client, {
          action: command.action,
          targetId,
          baseline: command.baseline,
          patch: command.patch,
          preview: false,
          confirmPublished: command.confirmPublished === true,
          previewId: command.previewId,
          actorId: context.id,
        }),
      {
        table: "admin_competition_commands",
        lockClass: 23006,
        action: command.action,
      },
    );
    // 幂等回执只存业务结果；审计 ID 由同一事务写入的 command_operation_id 反查。
    const audit = await this.admin.database.pool.query<{ id: string }>(
      "SELECT operation_id AS id FROM admin_operations WHERE command_operation_id=$1 AND result='success'",
      [command.operationId],
    );
    return {
      targetId: result.targetId,
      action: result.action,
      publication: result.publication,
      baseline: result.baseline,
      changes: result.changes,
      auditOperationId: audit.rows[0]?.id ?? "",
    };
  }

  private operation(
    action: CompetitionAction,
    targetId: string,
    reason: string,
  ): AdminOperation {
    return {
      action:
        action === "publish" ? "competition.publish" : "competition.update",
      objectType: "competition",
      objectId: targetId,
      reason,
    };
  }

  /** 路由参数是唯一目标来源；补丁里出现不同 id 视为冲突而非静默采纳。 */
  private assertTargetId(targetId: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetId) || targetId.length > 100)
      throw new BadRequestException("目标届次ID无效");
  }

  /**
   * 目录锁 → 目标行锁 → 读基线 → 校验 → 写入。预览以保存点回滚同一事务，
   * 因此失败与预览都不会留下部分业务写入。
   */
  private async lockedApply(
    client: PoolClient,
    input: ApplyInput,
  ): Promise<CompetitionCommandOutcome> {
    if (input.action !== "save" && input.previewId)
      throw new BadRequestException("publish/hide 不接受预览回执");
    await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETITION_LOCK]);
    await client.query("SELECT id FROM competitions WHERE id=$1 FOR UPDATE", [
      input.targetId,
    ]);
    const catalog = await readCatalog(client, {
      competitionIds: [input.targetId],
    });
    const before = catalog.competitions[0] ?? null;
    if (baselineOf(before, catalog.colleges) !== input.baseline)
      throw createApiError(
        409,
        "COMPETITION_BASELINE_STALE",
        "基线已变化：正式记录或学院目录已被其他写入更新，请重新读取后再提交",
        { targetId: input.targetId, expected: input.baseline },
      );
    if (input.action !== "save" && !before) throw new NotFoundException();
    const patch = input.patch as ImportCompetition | undefined;
    if (patch?.id !== undefined && patch.id !== input.targetId)
      throw createApiError(
        409,
        "COMPETITION_TARGET_MISMATCH",
        "补丁届次ID与目标不一致",
      );
    // 发布/隐藏只改状态，不接受内容补丁，避免隐式覆盖他人编辑。
    const body = (
      input.action === "save" ? (input.patch ?? {}) : {}
    ) as ImportCompetition;
    if (input.action === "save") {
      const invalid = savePublicationInvalid(before, body);
      if (invalid) throw new BadRequestException(invalid);
    }
    const after = applyCommand(before, input.action, body);
    if (
      before?.publication === "published" &&
      input.action === "save" &&
      !input.preview &&
      !input.confirmPublished
    )
      throw createApiError(
        409,
        "COMPETITION_CONFIRM_REQUIRED",
        "修改已发布比赛须显式确认 confirmPublished=true",
      );
    const blocks =
      input.action === "publish" ? publishBlocks(after, this.now()) : [];
    if (blocks.length && !input.preview)
      throw createApiError(
        422,
        "COMPETITION_PUBLISH_BLOCKED",
        blocks.map((block) => block.message).join("；"),
        { blocks },
      );
    if (input.previewId && !input.preview)
      await this.consumePreview(client, input, input.baseline);
    await this.write(client, input, after.publication, before === null);
    if (input.previewId && !input.preview)
      await client.query(
        "UPDATE admin_competition_previews SET consumed_at=now() WHERE id=$1 AND actor_id=$2 AND consumed_at IS NULL",
        [input.previewId, input.actorId],
      );
    return {
      targetId: input.targetId,
      action: input.action,
      publication: after.publication,
      baseline: baselineOf(after, catalog.colleges),
      changes: compareChanges(before, after),
      blocks,
    };
  }

  private async write(
    client: PoolClient,
    input: ApplyInput,
    publication: string,
    creating: boolean,
  ) {
    // 预览中只有 save 会真正触碰内容；publish/hide 仅改发布状态，无内容可预演。
    if (input.preview && input.action !== "save") return;
    if (input.preview) await client.query(`SAVEPOINT ${PREVIEW_SAVEPOINT}`);
    try {
      await applyImportBatch(
        client,
        {
          competitions: [
            {
              ...(input.action === "save" ? (input.patch ?? {}) : {}),
              id: input.targetId,
              publication,
            } as ImportCompetition,
          ],
        },
        {
          ...MANUAL_IMPORT_OPTIONS,
          ...(input.preview ? { preview: true } : {}),
        },
      );
    } catch (error) {
      if (input.preview)
        await client.query(`ROLLBACK TO SAVEPOINT ${PREVIEW_SAVEPOINT}`);
      throw error instanceof ImportValidationError
        ? createApiError(
            422,
            "COMPETITION_CONTENT_INVALID",
            this.describe(error, creating),
          )
        : error;
    }
    if (input.preview) {
      await client.query(`ROLLBACK TO SAVEPOINT ${PREVIEW_SAVEPOINT}`);
      await client.query(`RELEASE SAVEPOINT ${PREVIEW_SAVEPOINT}`);
    }
  }

  private describe(error: ImportValidationError, creating: boolean) {
    const message = error.message;
    // 关系 ID 全局唯一：新建时撞到别人的 ID 属于冲突而非字段非法。
    return creating && message.includes("重复或跨届 ID")
      ? message + "（该 ID 已被其他届次占用）"
      : message;
  }

  private async consumePreview(
    client: PoolClient,
    input: ApplyInput,
    baseline: string,
  ) {
    const row = (
      await client.query(
        'SELECT actor_id AS "actorId",action,target_id AS "targetId",baseline,command_hash AS "commandHash",consumed_at AS "consumedAt" FROM admin_competition_previews WHERE id=$1 FOR UPDATE',
        [input.previewId],
      )
    ).rows[0];
    const expected = commandHash({
      action: input.action,
      targetId: input.targetId,
      baseline,
      patch: input.patch ?? null,
    });
    if (
      !row ||
      row.actorId !== input.actorId ||
      row.action !== input.action ||
      row.targetId !== input.targetId ||
      row.baseline !== baseline ||
      row.commandHash !== expected ||
      row.consumedAt
    )
      throw createApiError(
        409,
        "COMPETITION_PREVIEW_STALE",
        "预览回执已过期、已被使用或与当前命令不匹配，请重新预览",
      );
  }

  private now() {
    return new Date().toISOString();
  }
}
