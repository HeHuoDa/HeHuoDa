import { CampusService } from "../src/campus/campus.service.js";
import { BusinessPolicy } from "../src/business-access/business-policy.service.js";
import { CapabilityRegistry } from "../src/business-access/capabilities.js";
import { authDataModule } from "../src/business-access/auth-data-module.js";
import {
  sensitiveActions,
  recoveryActions,
  captainActions,
} from "../src/business-access/ports.js";
import {
  SchoolAuthClient,
  type AuthHttpResponse,
} from "@hehuoda/sicau-connectors/auth";
import {
  campusFixture,
  challengeResponse,
  successResponse,
  deferred,
} from "./campus-fixture.js";

describe("校园核验 PG 原子性、密码学、时钟与生命周期", () => {
  let f: Awaited<ReturnType<typeof campusFixture>>;
  beforeEach(async () => {
    f = await campusFixture();
  });
  afterEach(async () => {
    await f?.close();
  });
  const status = async (token: string) =>
    (await f.request("GET", "campus-verification", token)).json();
  const profile = async (token: string) =>
    (await f.request("GET", "campus-verification/profile", token)).json();
  async function verify(
    token: string,
    subject = "SYNTHETIC_SUBJECT",
    number = "00123456",
    name = "合成姓名",
  ) {
    f.transport(async (r) =>
      r.method === "GET"
        ? challengeResponse()
        : successResponse(subject, number, name),
    );
    const t = await f.create(token);
    return f.submit(token, t, { account: number, name });
  }
  async function access(token: string) {
    return (await f.repository.findActiveAccess(token, f.clock.now()))!;
  }
  it.each([
    ["不同姓名", "00123456"],
    ["合成姓名", "123456"],
    ["不同姓名", "00999999"],
    ["合成 姓名", "00123456"],
    ["合成姓名", "0012 3456"],
    ["合成姓名", "synthetic-alias"],
    ["合成姓亻名", "00123456"],
  ])("姓名或学号差异安全失败（%s / %s）", async (name, account) => {
    const a = await f.login(),
      t = await f.create(a.accessToken);
    const result = await f.submit(a.accessToken, t, { name, account });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toMatchObject({
      code: "CAMPUS_IDENTITY_MISMATCH",
      message: "验证失败，姓名与学号不匹配",
    });
    const query = await f.request(
      "GET",
      `campus-verification/transactions/${t.id}`,
      a.accessToken,
    );
    expect(query.json()).toMatchObject({
      status: "failed",
      reason: "identity_mismatch",
    });
    expect(await profile(a.accessToken)).toEqual({ profile: null });
    expect(await status(a.accessToken)).toMatchObject({ status: "unverified" });
    const audit = (
      await f.isolated.pool.query(
        "select kind, reason from campus_audit_logs where kind='failed'",
      )
    ).rows;
    expect(audit).toEqual([{ kind: "failed", reason: "identity_mismatch" }]);
    for (const table of [
      "campus_bindings",
      "campus_profiles",
      "campus_qualifications",
    ])
      expect(
        (await f.isolated.pool.query(`select count(*)::int c from ${table}`))
          .rows[0].c,
      ).toBe(0);
    for (const secret of [
      name,
      account,
      "SYNTHETIC_SUBJECT",
      "00123456",
      "合成姓名",
    ])
      expect(result.body + query.body + JSON.stringify(audit)).not.toContain(
        secret,
      );
    const repeated = await f.submit(a.accessToken, t, { consentVersion: 1 });
    expect(repeated.json()).toMatchObject({
      status: "failed",
      reason: "identity_mismatch",
    });
    expect(f.counts.post).toBe(1);
  });
  it("比对只忽略首尾空格，保存学校原值，重验不匹配保留旧资料和资格", async () => {
    const a = await f.login();
    f.transport(async (r) =>
      r.method === "GET"
        ? challengeResponse()
        : successResponse("SYNTHETIC_SUBJECT", " 00123456 ", " 合成姓名 "),
    );
    const t = await f.create(a.accessToken);
    expect(
      (
        await f.submit(a.accessToken, t, {
          account: " 00123456 ",
          name: "合成姓名",
        })
      ).statusCode,
    ).toBe(200);
    const oldProfile = await profile(a.accessToken),
      oldStatus = await status(a.accessToken);
    expect(oldProfile.profile).toMatchObject({
      accountNumber: " 00123456 ",
      name: " 合成姓名 ",
    });
    const renewal = await f.create(a.accessToken);
    expect(
      (await f.submit(a.accessToken, renewal, { name: "不同姓名" })).json()
        .code,
    ).toBe("CAMPUS_IDENTITY_MISMATCH");
    expect(await profile(a.accessToken)).toEqual(oldProfile);
    expect(await status(a.accessToken)).toEqual(oldStatus);
  });
  it("真实校园提供者与业务权限组合：四类操作到期即拒绝，退出和队长操作不扩大限制", async () => {
    const a = await f.login();
    await verify(a.accessToken);
    const registry = new CapabilityRegistry(true);
    registry.register(authDataModule());
    registry.register(f.campus.dataModule());
    registry.register({
      id: "test-resources",
      kind: "test",
      capabilities: [
        "resources",
        "contact-revocation",
        "business-cleanup",
        "governance",
      ],
      lifecycle: {
        check: async () => {},
        revoke: async () => {},
        cleanup: async () => {},
      },
      resources: {
        hasActiveCaptainTeam: async () => false,
        read: async () => ({
          allowed: true,
          isCaptain: true,
          contact: {
            ownerId: a.user.id,
            sameTeam: true,
            viewerIsMember: true,
            ownerIsMember: true,
            granted: true,
          },
        }),
      },
    });
    registry.seal(true);
    f.config.set("SENSITIVE_BUSINESS_ENABLED", true);
    const policy = new BusinessPolicy(
      registry,
      f.repository,
      f.config,
      f.clock,
    );
    for (const action of sensitiveActions)
      await expect(
        f.database.db.transaction((tx) =>
          policy.authorize(tx, a.accessToken, action, a.user.id),
        ),
      ).resolves.toMatchObject({ user: { id: a.user.id } });
    f.time("2027-01-31T16:00:00Z");
    const fresh = await f.login("fixture-user-1");
    for (const action of sensitiveActions)
      await expect(
        f.database.db.transaction((tx) =>
          policy.authorize(tx, fresh.accessToken, action, a.user.id),
        ),
      ).rejects.toMatchObject({ status: 403 });
    for (const action of [...recoveryActions, ...captainActions])
      await expect(
        f.database.db.transaction((tx) =>
          policy.authorize(tx, fresh.accessToken, action, a.user.id),
        ),
      ).resolves.toMatchObject({ user: { id: a.user.id } });
  });
  it("私人记录清理失败共同回滚，可重试且不提前释放绑定", async () => {
    const a = await f.login();
    await verify(a.accessToken);
    await f.isolated.pool.query(
      "CREATE FUNCTION reject_profile_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic cleanup failure'; END $$ LANGUAGE plpgsql; CREATE TRIGGER reject_profile_delete BEFORE DELETE ON campus_profiles FOR EACH ROW EXECUTE FUNCTION reject_profile_delete()",
    );
    await expect(
      f.database.db.transaction((tx) =>
        f.lifecycle.cleanup(tx, a.user.id, f.clock.now()),
      ),
    ).rejects.toThrow();
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_qualifications",
        )
      ).rows[0].c,
    ).toBe(1);
    await f.isolated.pool.query(
      "DROP TRIGGER reject_profile_delete ON campus_profiles; DROP FUNCTION reject_profile_delete()",
    );
    await f.database.db.transaction((tx) =>
      f.lifecycle.cleanup(tx, a.user.id, f.clock.now()),
    );
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_profiles",
        )
      ).rows[0].c,
    ).toBe(0);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_bindings",
        )
      ).rows[0].c,
    ).toBe(1);
  });
  it("两个用户并发核验同一主体只有一个成功，失败不泄漏绑定人", async () => {
    const a = await f.login(),
      b = await f.login(),
      ta = await f.create(a.accessToken),
      tb = await f.create(b.accessToken);
    const results = await Promise.all([
      f.submit(a.accessToken, ta),
      f.submit(b.accessToken, tb),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const failure = results.find((r) => r.statusCode === 409)!;
    expect(failure.json().code).toBe("CAMPUS_BINDING_CONFLICT");
    expect(failure.body).not.toContain(a.user.id);
    expect(failure.body).not.toContain(b.user.id);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_bindings",
        )
      ).rows[0].c,
    ).toBe(1);
  });
  it("同主体续验原值更新，换主体、异常字段或普通失败保留旧资料和旧资格", async () => {
    const a = await f.login();
    expect((await verify(a.accessToken)).statusCode).toBe(200);
    f.time("2026-10-25T00:00:01Z");
    const updated = await verify(
      a.accessToken,
      "SYNTHETIC_SUBJECT",
      "00000009",
      " 合成新名 ",
    );
    expect(updated.statusCode).toBe(200);
    const oldStatus = await status(a.accessToken),
      oldProfile = await profile(a.accessToken);
    expect(oldProfile.profile).toMatchObject({
      accountNumber: "00000009",
      name: " 合成新名 ",
    });
    expect((await verify(a.accessToken, "OTHER_SUBJECT")).statusCode).toBe(409);
    f.transport(async (r) =>
      r.method === "GET"
        ? challengeResponse()
        : successResponse("SYNTHETIC_SUBJECT", null),
    );
    let t = await f.create(a.accessToken);
    expect((await f.submit(a.accessToken, t)).statusCode).toBe(503);
    f.transport(async (r) =>
      r.method === "GET"
        ? challengeResponse()
        : {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({ code: 400, msg: "用户不存在或未激活" }),
            ),
          },
    );
    t = await f.create(a.accessToken);
    expect((await f.submit(a.accessToken, t)).json().code).toBe(
      "CAMPUS_CREDENTIALS_FAILED",
    );
    expect(await profile(a.accessToken)).toEqual(oldProfile);
    expect(await status(a.accessToken)).toEqual(oldStatus);
  });
  it.each([
    "campus_bindings",
    "campus_profiles",
    "campus_qualifications",
    "campus_transactions",
    "campus_audit_logs",
  ])("%s 写入失败会回滚全部成功状态", async (table) => {
    const a = await f.login(),
      t = await f.create(a.accessToken);
    await f.isolated.pool
      .query(`CREATE FUNCTION reject_campus() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic persistence failure'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_campus BEFORE ${table === "campus_transactions" ? "UPDATE" : "INSERT"} ON ${table} FOR EACH ROW ${table === "campus_transactions" ? "WHEN (NEW.status = 'succeeded')" : table === "campus_audit_logs" ? "WHEN (NEW.kind = 'succeeded')" : ""} EXECUTE FUNCTION reject_campus()`);
    const result = await f.submit(a.accessToken, t);
    expect(result.statusCode).toBe(503);
    await f.isolated.pool.query(
      `DROP TRIGGER reject_campus ON ${table}; DROP FUNCTION reject_campus()`,
    );
    for (const name of [
      "campus_bindings",
      "campus_profiles",
      "campus_qualifications",
    ])
      expect(
        (await f.isolated.pool.query(`select count(*)::int c from ${name}`))
          .rows[0].c,
      ).toBe(0);
    expect(
      (
        await f.isolated.pool.query(
          "select status from campus_transactions where id=$1",
          [t.id],
        )
      ).rows[0].status,
    ).not.toBe("succeeded");
    await f.submit(a.accessToken, t);
    expect(f.counts.post).toBe(1);
  });
  it("错误密钥、认证标签和跨用户密文替换均安全拒绝，保留 keyId 以受控轮换", async () => {
    const a = await f.login(),
      b = await f.login();
    await verify(a.accessToken);
    await verify(b.accessToken, "SECOND_SUBJECT");
    f.config.set(
      "CAMPUS_PROFILE_KEYS",
      JSON.stringify({ v1: Buffer.alloc(32, 3).toString("base64") }),
    );
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(503);
    f.config.set(
      "CAMPUS_PROFILE_KEYS",
      JSON.stringify({
        v1: Buffer.alloc(32, 2).toString("base64"),
        v2: Buffer.alloc(32, 3).toString("base64"),
      }),
    );
    f.config.set("CAMPUS_PROFILE_KEY_ID", "v2");
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(200);
    await f.isolated.pool.query(
      "update campus_profiles set ciphertext=(select ciphertext from campus_profiles where user_id=$1),nonce=(select nonce from campus_profiles where user_id=$1),tag=(select tag from campus_profiles where user_id=$1) where user_id=$2",
      [a.user.id, b.user.id],
    );
    expect(
      (await f.request("GET", "campus-verification/profile", b.accessToken))
        .statusCode,
    ).toBe(503);
    await f.isolated.pool.query(
      "update campus_profiles set tag=$1 where user_id=$2",
      [Buffer.alloc(16).toString("base64"), a.user.id],
    );
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(503);
  });
  it("学期 UTC 截止瞬间失效；开关关闭、无当期不会撤销旧资格或隐藏资料", async () => {
    const a = await f.login();
    await verify(a.accessToken);
    f.config.set("CAMPUS_VERIFICATION_ENABLED", false);
    expect(await status(a.accessToken)).toMatchObject({
      status: "valid",
      available: false,
    });
    expect((await profile(a.accessToken)).profile.accountNumber).toBe(
      "00123456",
    );
    f.config.set("CAMPUS_TERMS", "[]");
    expect(await status(a.accessToken)).toMatchObject({
      status: "valid",
      available: false,
      currentTerm: null,
    });
    f.time("2027-01-31T15:59:59.999Z");
    const fresh = await f.login("fixture-user-1");
    expect(await status(fresh.accessToken)).toMatchObject({ status: "valid" });
    f.time("2027-01-31T16:00:00.000Z");
    expect(await status(fresh.accessToken)).toMatchObject({
      status: "expired",
    });
    const q = await f.database.db.transaction((tx) =>
      f.registry.provider("campus")!.campus!.read(tx, a.user.id),
    );
    expect(q.status).toBe("expired");
    expect(
      (await f.request("GET", "auth/me", fresh.accessToken)).json().campus
        .status,
    ).toBe("expired");
  });
  it("跨学期学校请求不静默转入新学期；五分钟到期也不能保存迟到结果", async () => {
    for (const [start, end] of [
      ["2027-01-31T15:59:59Z", "2027-01-31T16:00:00Z"],
      ["2026-10-25T00:00:00Z", "2026-10-25T00:05:00Z"],
    ]) {
      f.time(start!);
      const a = await f.login(),
        t = await f.create(a.accessToken);
      const started = deferred<void>(),
        reply = deferred<AuthHttpResponse>();
      f.transport(async () => {
        started.resolve();
        return reply.promise;
      });
      const pending = f.submit(a.accessToken, t);
      await started.promise;
      f.time(end!);
      reply.resolve(successResponse());
      expect((await pending).statusCode).toBe(409);
      f.transport(async (r) =>
        r.method === "GET" ? challengeResponse() : successResponse(),
      );
      expect(
        (
          await f.isolated.pool.query(
            "select count(*)::int c from campus_profiles",
          )
        ).rows[0].c,
      ).toBe(0);
    }
  });
  it("访问凭据轮换保留稳定平台 sessionId，学校请求可完成但旧凭据不能再查询", async () => {
    const a = await f.login(),
      t = await f.create(a.accessToken),
      started = deferred<void>(),
      reply = deferred<AuthHttpResponse>();
    f.transport(async () => {
      started.resolve();
      return reply.promise;
    });
    const pending = f.submit(a.accessToken, t);
    await started.promise;
    const rotated = await f.request("POST", "auth/refresh", undefined, {
      refreshToken: a.refreshToken,
    });
    expect(rotated.statusCode).toBe(200);
    reply.resolve(successResponse());
    expect((await pending).statusCode).toBe(200);
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await f.request(
          "GET",
          "campus-verification/profile",
          rotated.json().accessToken,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("restart 安全终止旧活动事务，完成记录可查且学校句柄不持久化", async () => {
    const a = await f.login(),
      done = await f.create(a.accessToken);
    await f.submit(a.accessToken, done);
    const waiting = await f.create(a.accessToken);
    const restartedSchool = new SchoolAuthClient();
    const restarted = new CampusService(
      f.database,
      f.config,
      f.clock,
      restartedSchool,
    );
    try {
      await restarted.maintain();
      expect(
        (await restarted.get(await access(a.accessToken), waiting.id)).status,
      ).toBe("cancelled");
      expect(
        (await restarted.get(await access(a.accessToken), done.id)).status,
      ).toBe("succeeded");
      await f.campus.maintain();
    } finally {
      restarted.onApplicationShutdown();
    }
  });
  it("生命周期撤销立即影响资格，七天后的清理端口幂等删除私人记录并保留绑定", async () => {
    const a = await f.login();
    await verify(a.accessToken);
    await f.create(a.accessToken);
    await f.database.db.transaction((tx) =>
      f.lifecycle.restrict(tx, a.user.id, f.clock.now()),
    );
    await f.lifecycle.destroySchoolSessions({ userId: a.user.id });
    expect(
      (await f.request("GET", "campus-verification/profile", a.accessToken))
        .statusCode,
    ).toBe(401);
    const q = await f.database.db.transaction((tx) =>
      f.registry.provider("campus")!.campus!.read(tx, a.user.id),
    );
    expect(q.status).toBe("revoked");
    await f.database.db.transaction((tx) =>
      f.lifecycle.cleanup(tx, a.user.id, f.clock.now()),
    );
    await f.database.db.transaction((tx) =>
      f.lifecycle.cleanup(tx, a.user.id, f.clock.now()),
    );
    for (const table of [
      "campus_profiles",
      "campus_transactions",
      "campus_qualifications",
      "campus_audit_logs",
    ])
      expect(
        (await f.isolated.pool.query(`select count(*)::int c from ${table}`))
          .rows[0].c,
      ).toBe(0);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_bindings",
        )
      ).rows[0].c,
    ).toBe(1);
  });
  it("24小时终态与180天审计精确清理，旧事务不能触发新密码请求", async () => {
    const a = await f.login(),
      t = await f.create(a.accessToken);
    await f.submit(a.accessToken, t);
    f.time("2026-10-26T00:00:00.001Z");
    await f.campus.maintain();
    const fresh = await f.login("fixture-user-1");
    expect(
      (
        await f.request(
          "GET",
          `campus-verification/transactions/${t.id}`,
          fresh.accessToken,
        )
      ).statusCode,
    ).toBe(404);
    expect((await f.submit(fresh.accessToken, t)).statusCode).toBe(404);
    expect(f.counts.post).toBe(1);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_audit_logs",
        )
      ).rows[0].c,
    ).toBeGreaterThan(0);
    f.time("2027-04-23T00:00:00.001Z");
    await f.campus.maintain();
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_audit_logs",
        )
      ).rows[0].c,
    ).toBe(0);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_bindings",
        )
      ).rows[0].c,
    ).toBe(1);
  });
});
