import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { AdminService, type AdminContext } from "./admin.service.js";
import {
  ADMIN_ACTIONS,
  ADMIN_OBJECTS,
  type AdminOperationDto,
  type OperationsQueryDto,
  type AdminOperationsDto,
  type AdminDashboardDto,
} from "./admin.dto.js";

export interface AdminOperation {
  action: (typeof ADMIN_ACTIONS)[number];
  objectType: (typeof ADMIN_OBJECTS)[number];
  objectId: string | null;
  reason: string;
}

const SELECT_OPERATION = `operation_id AS "operationId", actor_type AS "actorType", actor_id AS "actorId", action, object_type AS "objectType", object_id AS "objectId", reason, result, request_id AS "requestId", created_at AS "createdAt"`;
type OperationRow = Omit<AdminOperationDto, "createdAt"> & { createdAt: Date };
const operationDto = (row: OperationRow): AdminOperationDto => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class AdminOperationsService {
  constructor(private readonly admin: AdminService) {}

  // The caller owns BEGIN/COMMIT. Only server-authenticated context supplies the actor.
  async recordSuccess(
    client: PoolClient,
    context: AdminContext,
    operation: AdminOperation,
  ): Promise<string> {
    await this.admin.lockContext(client, context);
    return this.insert(client, context, operation, "success");
  }

  private async insert(
    client: PoolClient,
    context: AdminContext,
    operation: AdminOperation,
    result: "success" | "failure",
  ): Promise<string> {
    const inserted = await client.query<{ operation_id: string }>(
      `INSERT INTO admin_operations(actor_type,actor_id,action,object_type,object_id,reason,result,request_id) VALUES ('admin',$1,$2,$3,$4,$5,$6,$7) RETURNING operation_id`,
      [
        context.id,
        operation.action,
        operation.objectType,
        operation.objectId,
        result === "failure" ? "操作失败" : operation.reason,
        result,
        context.requestId,
      ],
    );
    return inserted.rows[0]!.operation_id;
  }

  async withOperation<T>(
    context: AdminContext,
    operation: AdminOperation,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<{ value: T; operationId: string }> {
    const client = await this.admin.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.admin.lockContext(client, context);
      const value = await run(client);
      const operationId = await this.insert(
        client,
        context,
        operation,
        "success",
      );
      await client.query("COMMIT");
      return { value, operationId };
    } catch (error) {
      await client.query("ROLLBACK");
      // A failed attempt is a separate statement after rollback, never a success.
      await this.insert(client, context, operation, "failure");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(query: OperationsQueryDto): Promise<AdminOperationsDto> {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException();
    const values: unknown[] = [];
    const clauses: string[] = [];
    for (const [column, value] of [
      ["actor_type", query.actorType],
      ["actor_id", query.actorId],
      ["action", query.action],
      ["object_type", query.objectType],
    ] as const) {
      if (value !== undefined) {
        values.push(value);
        clauses.push(`${column}=$${values.length}`);
      }
    }
    if (query.from) {
      values.push(query.from);
      clauses.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (query.to) {
      values.push(query.to);
      clauses.push(`created_at <= $${values.length}::timestamptz`);
    }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const client = await this.admin.database.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const count = await client.query<{ total: string }>(
        "SELECT count(*) AS total FROM admin_operations" + where,
        values,
      );
      const rows = await client.query<OperationRow>(
        `SELECT ${SELECT_OPERATION} FROM admin_operations${where} ORDER BY created_at DESC,operation_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      await client.query("COMMIT");
      return {
        items: rows.rows.map(operationDto),
        total: Number(count.rows[0]!.total),
        page: query.page,
        pageSize: query.pageSize,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(id: string): Promise<AdminOperationDto> {
    const result = await this.admin.database.pool.query<OperationRow>(
      `SELECT ${SELECT_OPERATION} FROM admin_operations WHERE operation_id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException();
    return operationDto(result.rows[0]);
  }

  async dashboard(): Promise<AdminDashboardDto> {
    const result = await this.admin.database.pool.query<{
      drafts: string;
      published: string;
      asOf: Date;
    }>(
      `SELECT count(*) FILTER (WHERE publication='draft') AS drafts,count(*) FILTER (WHERE publication='published') AS published, statement_timestamp() AS "asOf" FROM competitions`,
    );
    const row = result.rows[0]!;
    const asOf = row.asOf.toISOString();
    return {
      modules: [
        {
          module: "drafts",
          available: true,
          count: Number(row.drafts),
          scope: "全部正式比赛：草稿",
          asOf,
        },
        {
          module: "published",
          available: true,
          count: Number(row.published),
          scope: "全部正式比赛：已发布",
          asOf,
        },
        {
          module: "pending",
          available: false,
          count: null,
          scope: "待审核候选：待后续管理模块接入",
          asOf,
        },
        {
          module: "sources",
          available: false,
          count: null,
          scope: "采集来源：待后续管理模块接入",
          asOf,
        },
      ],
    };
  }
}
