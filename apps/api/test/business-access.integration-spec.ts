import { sql } from "drizzle-orm";
import {
  sensitiveActions,
  captainActions,
  recoveryActions,
  type BusinessAction,
} from "../src/business-access/ports.js";
import { users } from "../src/database/schema.js";
import { eq } from "drizzle-orm";
import { barrier, businessFixture } from "./business-access-fixture.js";

describe("服务端业务权限与生命周期", () => {
  let f: Awaited<ReturnType<typeof businessFixture>>;
  let actor: Awaited<ReturnType<typeof f.user>>;
  let owner: Awaited<ReturnType<typeof f.user>>;
  beforeAll(async () => {
    f = await businessFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  beforeEach(async () => {
    await f.isolated.pool.query("TRUNCATE test_business_state, users CASCADE");
    actor = await f.user("actor");
    owner = await f.user("owner");
    f.config.set("SENSITIVE_BUSINESS_ENABLED", true);
  });
  const authorize = (
    action: BusinessAction,
    token = actor.accessToken,
    resourceId = owner.id,
  ) =>
    f.database.db.transaction((tx) =>
      f.policy.authorize(tx, token, action, resourceId),
    );
  const status = async (userId: string, value: string) =>
    f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set qualification = ${value} where user_id = ${userId}`,
      );
    });

  it.each([...sensitiveActions, ...captainActions, ...recoveryActions])(
    "合法角色可执行 %s",
    async (action) => {
      expect((await authorize(action)).user.id).toBe(actor.id);
    },
  );
  it.each(sensitiveActions)(
    "%s 不接受未登录、受限或虚构会话",
    async (action) => {
      await expect(authorize(action, "")).rejects.toMatchObject({
        status: 401,
      });
      await expect(authorize(action, "forged")).rejects.toMatchObject({
        status: 401,
      });
      await f.change(async (tx) => {
        await tx
          .update(users)
          .set({ status: "restricted" })
          .where(eq(users.id, actor.id));
      });
      await expect(authorize(action)).rejects.toMatchObject({ status: 403 });
    },
  );
  it.each(["unavailable", "unverified", "expired", "revoked"])(
    "四类操作拒绝 %s 资格",
    async (value) => {
      await status(actor.id, value);
      for (const action of sensitiveActions)
        await expect(authorize(action)).rejects.toMatchObject({ status: 403 });
    },
  );
  it("截止时刻资格立即失效", async () => {
    await f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set valid_until = ${f.now.toISOString()} where user_id = ${actor.id}`,
      );
    });
    await expect(authorize("applyToTeam")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("拒绝可能复用旧快照的事务隔离级别", async () => {
    await expect(
      f.database.db.transaction(
        (tx) =>
          f.policy.authorize(tx, actor.accessToken, "applyToTeam", owner.id),
        { isolationLevel: "repeatable read" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("有效资格不能替代资源规则，私人资源缺失返回404", async () => {
    await f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set allowed = false where user_id = ${actor.id}`,
      );
    });
    await expect(authorize("applyToTeam")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      authorize("readMemberContact", actor.accessToken, "missing"),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("资格到期及开关关闭不阻止管理和退出类操作，非队长仍不能管理", async () => {
    await status(actor.id, "expired");
    f.config.set("SENSITIVE_BUSINESS_ENABLED", false);
    for (const action of [...captainActions, ...recoveryActions])
      expect((await authorize(action)).user.id).toBe(actor.id);
    for (const action of sensitiveActions)
      await expect(authorize(action)).rejects.toMatchObject({ status: 503 });
    await f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set captain = false where user_id = ${actor.id}`,
      );
    });
    for (const action of captainActions)
      await expect(authorize(action)).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    "viewer-member",
    "different-team",
    "owner-member",
    "grant",
    "owner-status",
    "owner-qualification",
  ])("联系方式重新读取 %s，不使用旧授权缓存", async (condition) => {
    await authorize("readMemberContact");
    await f.change(async (tx) => {
      if (condition === "different-team")
        await tx.execute(
          sql`update test_business_state set same_team = false where user_id = ${actor.id}`,
        );
      if (condition === "viewer-member")
        await tx.execute(
          sql`update test_business_state set member = false where user_id = ${actor.id}`,
        );
      if (condition === "owner-member")
        await tx.execute(
          sql`update test_business_state set member = false where user_id = ${owner.id}`,
        );
      if (condition === "grant")
        await tx.execute(
          sql`update test_business_state set granted = false where user_id = ${owner.id}`,
        );
      if (condition === "owner-status")
        await tx
          .update(users)
          .set({ status: "closing" })
          .where(eq(users.id, owner.id));
      if (condition === "owner-qualification")
        await tx.execute(
          sql`update test_business_state set qualification = 'revoked' where user_id = ${owner.id}`,
        );
    });
    await expect(authorize("readMemberContact")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("活跃队长不能注销；成员清理幂等且不删除其他成员", async () => {
    await expect(
      f.change((tx) => f.lifecycle.checkDeletion(tx, actor.id)),
    ).rejects.toMatchObject({ status: 409 });
    await f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set captain = false where user_id = ${actor.id}`,
      );
      await f.lifecycle.checkDeletion(tx, actor.id);
    });
    await f.change((tx) => f.lifecycle.cleanup(tx, actor.id, f.now));
    await f.change((tx) => f.lifecycle.cleanup(tx, actor.id, f.now));
    expect(
      (await authorize("applyToTeam", owner.accessToken, owner.id)).user.id,
    ).toBe(owner.id);
    await expect(authorize("applyToTeam")).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each(["qualification", "account", "logout"])(
    "%s 撤销先取得锁时，在途请求不能凭旧检查提交",
    async (kind) => {
      const entered = barrier(),
        release = barrier(),
        started = barrier();
      const change = f.change(async (tx) => {
        if (kind === "qualification")
          await tx.execute(
            sql`update test_business_state set qualification = 'revoked' where user_id = ${actor.id}`,
          );
        if (kind === "account") await f.lifecycle.restrict(tx, actor.id, f.now);
        if (kind === "logout") {
          const access = await f.repository.findActiveAccess(
            actor.accessToken,
            f.now,
            tx,
          );
          await f.repository.revokeSession(
            access!.sessionId,
            "logout",
            f.now,
            tx,
          );
        }
        entered.release();
        await release.promise;
      });
      await entered.promise;
      const business = f.database.db.transaction(async (tx) => {
        started.release();
        return f.policy.authorize(
          tx,
          actor.accessToken,
          "applyToTeam",
          owner.id,
        );
      });
      const rejected = expect(business).rejects.toMatchObject({
        status: kind === "qualification" ? 403 : 401,
      });
      await started.promise;
      release.release();
      await change;
      await rejected;
    },
  );
  it("业务先持锁时，撤权等待业务提交，之后的新读取失败", async () => {
    const entered = barrier(),
      release = barrier(),
      started = barrier();
    const business = f.database.db.transaction(async (tx) => {
      const result = await f.policy.authorize(
        tx,
        actor.accessToken,
        "readMemberContact",
        owner.id,
      );
      entered.release();
      await release.promise;
      return result;
    });
    await entered.promise;
    const revoke = f.database.db.transaction(async (tx) => {
      started.release();
      await f.lifecycle.revoke(tx, owner.id, f.now);
    });
    await started.promise;
    release.release();
    expect((await business).user.id).toBe(actor.id);
    await revoke;
    await expect(authorize("readMemberContact")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("失败的撤权事务整体回滚，重试后授权失效", async () => {
    await expect(
      f.change(async (tx) => {
        await f.lifecycle.revoke(tx, owner.id, f.now);
        throw new Error("audit failed");
      }),
    ).rejects.toThrow("audit failed");
    await authorize("readMemberContact");
    await f.change((tx) => f.lifecycle.revoke(tx, owner.id, f.now));
    await expect(authorize("readMemberContact")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("参与者检查、撤权或清理失败向上传播，整体回滚后可安全重试", async () => {
    let phase: "check" | "revoke" | "cleanup" | null = "check";
    const fail = async (current: typeof phase) => {
      if (phase === current) throw new Error("participant failed");
    };
    f.registry.register({
      id: "failure-participant",
      kind: "test",
      capabilities: [],
      lifecycle: {
        check: () => fail("check"),
        revoke: () => fail("revoke"),
        cleanup: () => fail("cleanup"),
      },
    });
    await f.change(async (tx) => {
      await tx.execute(
        sql`update test_business_state set captain = false where user_id = ${owner.id}`,
      );
    });
    for (const current of ["check", "revoke", "cleanup"] as const) {
      phase = current;
      await expect(
        f.change((tx) =>
          current === "check"
            ? f.lifecycle.checkDeletion(tx, owner.id)
            : f.lifecycle[current](tx, owner.id, f.now),
        ),
      ).rejects.toThrow("participant failed");
      await authorize("readMemberContact");
      expect(
        await f.repository.findActiveAccess(owner.accessToken, f.now),
      ).toBeDefined();
    }
    phase = null;
    await f.change((tx) => f.lifecycle.cleanup(tx, owner.id, f.now));
    await f.change((tx) => f.lifecycle.cleanup(tx, owner.id, f.now));
    await expect(authorize("readMemberContact")).rejects.toMatchObject({
      status: 404,
    });
  });
});
