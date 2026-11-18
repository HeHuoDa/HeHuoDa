import { ConflictException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  AdminOperationsService,
  type AdminOperation,
} from "../admin/admin-operations.service.js";
import { AdminService, type AdminContext } from "../admin/admin.service.js";
import { commandHash } from "./store.js";

export interface CommandReceiptTable {
  /** 回执表名；只接受本仓库内的常量，不接受外部输入。 */
  table: "admin_ingestion_commands" | "admin_competition_commands";
  /** 幂等串行化用的咨询锁命名空间。 */
  lockClass: number;
  /** 回执中记录的命令动作；缺省沿用审计 action。 */
  action?: string;
}

/**
 * 管理员写命令的幂等执行器。
 *
 * 同一管理员、同一 operationId 重试相同命令时返回首次结果；异载荷冲突。
 * 成功写入、回执与成功审计在同一事务内提交，失败先回滚业务再记录失败审计。
 */
@Injectable()
export class AdminIngestionOperation {
  constructor(
    private readonly operations: AdminOperationsService,
    private readonly admin: AdminService,
  ) {}

  async execute<T>(
    context: AdminContext,
    command: { operationId: string; reason: string },
    operation: AdminOperation,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
    receipt: CommandReceiptTable = {
      table: "admin_ingestion_commands",
      lockClass: 23004,
    },
  ): Promise<T> {
    const client = await this.admin.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.admin.lockContext(client, context);
      // Serialize retries before checking their persisted result, including concurrent HTTP requests.
      await client.query("SELECT pg_advisory_xact_lock($1,hashtext($2))", [
        receipt.lockClass,
        context.id + command.operationId,
      ]);
      const inputHash = commandHash({
        action: operation.action,
        objectType: operation.objectType,
        objectId: operation.objectId,
        payload,
        reason: command.reason,
      });
      const previous = (
        await client.query(
          `SELECT input_hash,result FROM ${receipt.table} WHERE actor_id=$1 AND operation_id=$2`,
          [context.id, command.operationId],
        )
      ).rows[0];
      if (previous) {
        if (previous.input_hash !== inputHash) throw new ConflictException();
        await client.query("COMMIT");
        return previous.result as T;
      }
      const value = await work(client);
      await client.query(
        `INSERT INTO ${receipt.table}(actor_id,operation_id,action,input_hash,result) VALUES($1,$2,$3,$4,$5)`,
        [
          context.id,
          command.operationId,
          receipt.action ?? operation.action,
          inputHash,
          JSON.stringify(value),
        ],
      );
      await this.operations.recordSuccess(client, context, {
        ...operation,
        reason: command.reason,
        commandOperationId: command.operationId,
      });
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      await this.operations
        .recordFailure(client, context, {
          ...operation,
          commandOperationId: command.operationId,
        })
        .catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
