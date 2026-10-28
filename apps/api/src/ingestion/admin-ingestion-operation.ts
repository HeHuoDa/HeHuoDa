import { ConflictException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  AdminOperationsService,
  type AdminOperation,
} from "../admin/admin-operations.service.js";
import { AdminService, type AdminContext } from "../admin/admin.service.js";
import { commandHash } from "./store.js";

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
  ): Promise<T> {
    const client = await this.admin.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.admin.lockContext(client, context);
      // Serialize retries before checking their persisted result, including concurrent HTTP requests.
      await client.query("SELECT pg_advisory_xact_lock(23004,hashtext($1))", [
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
          "SELECT input_hash,result FROM admin_ingestion_commands WHERE actor_id=$1 AND operation_id=$2",
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
        "INSERT INTO admin_ingestion_commands(actor_id,operation_id,action,input_hash,result) VALUES($1,$2,$3,$4,$5)",
        [
          context.id,
          command.operationId,
          operation.action,
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
