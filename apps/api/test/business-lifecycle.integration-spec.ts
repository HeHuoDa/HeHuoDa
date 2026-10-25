import { CampusService } from "../src/campus/campus.service.js";
import { SchoolAuthClient } from "@hehuoda/sicau-connectors/auth";
import { ConfigService } from "@nestjs/config";
import { AuthClock } from "../src/auth/auth-clock.js";
import { AuthRateLimiter } from "../src/auth/auth-rate-limiter.js";
import { AuthService } from "../src/auth/auth.service.js";
import { StubWechatProvider } from "../src/auth/wechat/stub-wechat-provider.js";
import { AccountLifecycle } from "../src/business-access/lifecycle.service.js";
import { businessFixture } from "./business-access-fixture.js";

describe("退出与事务审计", () => {
  let f: Awaited<ReturnType<typeof businessFixture>>;
  beforeAll(async () => {
    f = await businessFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("退出审计失败时，撤销与审计共同回滚", async () => {
    const actor = await f.user("logout-audit");
    const access = await f.repository.findActiveAccess(
      actor.accessToken,
      f.now,
    );
    const clock = new AuthClock();
    clock.now = () => new Date(f.now);
    const service = new AuthService(
      new ConfigService(),
      f.repository,
      new AuthRateLimiter(f.database),
      new StubWechatProvider(),
      clock,
      f.lifecycle,
      new CampusService(
        f.database,
        new ConfigService(),
        { now: () => f.now },
        new SchoolAuthClient(),
      ),
    );
    await f.isolated.pool
      .query(`CREATE FUNCTION reject_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_audit BEFORE INSERT ON auth_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit()`);
    try {
      await expect(service.logout(access!, "logout-audit")).rejects.toThrow();
      expect(
        await f.repository.findActiveAccess(actor.accessToken, f.now),
      ).toBeDefined();
    } finally {
      await f.isolated.pool.query(
        "DROP TRIGGER reject_audit ON auth_audit_logs",
      );
    }
  });
  it("学校会话销毁失败明确返回待重试，不能声称平台变更回滚", async () => {
    const registry = f.registry;
    const sessions = registry.provider("school-sessions")!.schoolSessions!;
    const original = sessions.destroy;
    sessions.destroy = async () => {
      throw new Error("private upstream error");
    };
    try {
      await expect(
        new AccountLifecycle(registry).destroySchoolSessions({
          userId: "synthetic",
        }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      sessions.destroy = original;
    }
  });
  it("退出凭据已撤销后，服务端仍能重试学校清理且不撤销联系人授权", async () => {
    const actor = await f.user("logout-retry");
    const viewer = await f.user("logout-viewer");
    const access = await f.repository.findActiveAccess(
      actor.accessToken,
      f.now,
    );
    const clock = new AuthClock();
    clock.now = () => new Date(f.now);
    const service = new AuthService(
      new ConfigService(),
      f.repository,
      new AuthRateLimiter(f.database),
      new StubWechatProvider(),
      clock,
      f.lifecycle,
      new CampusService(
        f.database,
        new ConfigService(),
        { now: () => f.now },
        new SchoolAuthClient(),
      ),
    );
    const sessions = f.registry.provider("school-sessions")!.schoolSessions!;
    const original = sessions.destroy;
    let unavailable = true;
    const liveSchoolSessions = new Set([access!.sessionId]);
    sessions.destroy = async (input) => {
      if (unavailable) throw new Error("synthetic failure");
      if (input.sessionId) liveSchoolSessions.delete(input.sessionId);
    };
    try {
      await expect(
        service.logout(access!, "logout-retry"),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await f.repository.findActiveAccess(actor.accessToken, f.now),
      ).toBeUndefined();
      expect(liveSchoolSessions.has(access!.sessionId)).toBe(true);
      unavailable = false;
      await f.lifecycle.retrySchoolSessionCleanup();
      expect(liveSchoolSessions.size).toBe(0);
      await f.lifecycle.retrySchoolSessionCleanup();
      await expect(
        f.database.db.transaction((tx) =>
          f.policy.authorize(
            tx,
            viewer.accessToken,
            "readMemberContact",
            actor.id,
          ),
        ),
      ).resolves.toMatchObject({ user: { id: viewer.id } });
    } finally {
      sessions.destroy = original;
    }
  });
});
