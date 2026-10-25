import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";
import { AuthClock } from "../src/auth/auth-clock.js";
import { AuthRepository } from "../src/auth/auth.repository.js";
import { generateTokenPair } from "../src/auth/auth-token.js";
import { BusinessPolicy } from "../src/business-access/business-policy.service.js";
import { CapabilityRegistry } from "../src/business-access/capabilities.js";
import { AccountLifecycle } from "../src/business-access/lifecycle.service.js";
import { authDataModule } from "../src/business-access/auth-data-module.js";
import type {
  CampusQualification,
  DataModule,
} from "../src/business-access/ports.js";
import { DatabaseService } from "../src/database/database.service.js";
import {
  lockAccessTransaction,
  type AccessTransaction,
} from "../src/database/access-transaction.js";
import { testDatabase } from "./competition-fixture.js";

export async function businessFixture() {
  const isolated = await testDatabase();
  const database = new DatabaseService(
    new ConfigService({ DATABASE_URL: isolated.url }),
  );
  const repository = new AuthRepository(database);
  const now = new Date("2026-10-25T00:00:00Z");
  const clock = new AuthClock();
  clock.now = () => new Date(now);
  const config = new ConfigService({ SENSITIVE_BUSINESS_ENABLED: true });
  const registry = new CapabilityRegistry(true);
  registry.register(authDataModule());
  await isolated.pool.query(`CREATE TABLE test_business_state (
    user_id text PRIMARY KEY, qualification text NOT NULL DEFAULT 'valid',
    valid_until timestamptz NOT NULL DEFAULT '2026-11-01T00:00:00Z',
    captain boolean NOT NULL DEFAULT true, member boolean NOT NULL DEFAULT true,
    granted boolean NOT NULL DEFAULT true, allowed boolean NOT NULL DEFAULT true,
    same_team boolean NOT NULL DEFAULT true
  )`);
  const read = async (tx: AccessTransaction, userId: string) =>
    (
      await tx.execute(
        sql`select * from test_business_state where user_id = ${userId}`,
      )
    ).rows[0];
  const module: DataModule = {
    id: "test-business",
    kind: "test",
    capabilities: [
      "campus",
      "resources",
      "contact-revocation",
      "business-cleanup",
      "governance",
      "school-sessions",
    ],
    campus: {
      async read(tx, userId) {
        const row = await read(tx, userId);
        return row
          ? {
              status: row.qualification as CampusQualification["status"],
              validUntil: new Date(String(row.valid_until)),
            }
          : { status: "unavailable", validUntil: null };
      },
    },
    resources: {
      async read(tx, actorId, _action, resourceId) {
        const actor = await read(tx, actorId);
        const owner = await read(tx, resourceId);
        if (!actor || !owner) return undefined;
        return {
          allowed: actor.allowed === true,
          isCaptain: actor.captain === true,
          contact: {
            ownerId: resourceId,
            sameTeam: actor.same_team === true,
            viewerIsMember: actor.member === true,
            ownerIsMember: owner.member === true,
            granted: owner.granted === true,
          },
        };
      },
      async hasActiveCaptainTeam(tx, userId) {
        return (await read(tx, userId))?.captain === true;
      },
    },
    lifecycle: {
      check: async () => {},
      async revoke(tx, userId) {
        await tx.execute(
          sql`update test_business_state set granted = false where user_id = ${userId}`,
        );
      },
      async cleanup(tx, userId) {
        await tx.execute(
          sql`delete from test_business_state where user_id = ${userId}`,
        );
      },
    },
    schoolSessions: { destroy: async () => {} },
  };
  registry.register(module);
  const policy = new BusinessPolicy(registry, repository, config, clock);
  const lifecycle = new AccountLifecycle(registry);
  async function user(id: string) {
    const { user: account } = await repository.findOrCreateWechatUser({
      appId: "test",
      openId: id,
      unionId: null,
      defaultNickname: id,
      now,
    });
    const tokens = generateTokenPair();
    await repository.createSession({ userId: account.id, tokens, now });
    await isolated.pool.query(
      "insert into test_business_state(user_id) values ($1)",
      [account.id],
    );
    return { id: account.id, ...tokens };
  }
  const change = (run: (tx: AccessTransaction) => Promise<void>) =>
    database.db.transaction(async (tx) => {
      await lockAccessTransaction(tx);
      await run(tx);
    });
  return {
    isolated,
    database,
    repository,
    registry,
    policy,
    lifecycle,
    config,
    clock,
    now,
    user,
    change,
    module,
    async close() {
      await database.onApplicationShutdown();
      await isolated.close();
    },
  };
}

export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
