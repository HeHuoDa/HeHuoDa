import { authTestApp, type AuthTestApp } from "./auth-fixture.js";
import { passwordHash } from "../src/admin/admin-security.js";
import { createAdminAccount } from "../src/admin/admin.service.js";
import { ConfigService } from "@nestjs/config";

describe("管理接口认证 HTTP 契约", () => {
  let test: AuthTestApp;
  beforeAll(async () => {
    test = await authTestApp();
  });
  afterAll(async () => {
    await test?.close();
  });

  it("未认证请求不能读取管理员会话", async () => {
    const response = await test.request("GET", "admin/auth/session");
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("UNAUTHORIZED");
  });

  it("受控账号可登录并以 Cookie 恢复会话", async () => {
    const salt = Buffer.alloc(16, 1);
    const hash = await passwordHash("test-password", salt);
    await test.pool.query(
      "INSERT INTO admin_accounts (username, display_name, password_salt, password_hash) VALUES ($1,$2,$3,$4)",
      ["test-admin", "测试管理员", salt, hash],
    );
    const login = await test.request(
      "POST",
      "admin/auth/login",
      {
        username: "test-admin",
        password: "test-password",
      },
      { origin: "http://localhost:5173" },
    );
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ displayName: "测试管理员" });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    expect(cookie).toMatch(/^hh_admin_session=/);
    const session = await test.request("GET", "admin/auth/session", undefined, {
      cookie,
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().displayName).toBe("测试管理员");
  });

  const login = (cookie?: string) =>
    test.request(
      "POST",
      "admin/auth/login",
      { username: "test-admin", password: "test-password" },
      { origin: "http://localhost:5173", ...(cookie ? { cookie } : {}) },
    );
  const cookieOf = (value: { headers: Record<string, unknown> }) =>
    String(value.headers["set-cookie"]).split(";")[0]!;

  it("登录轮换旧Cookie，CSRF和Origin保护退出，退出可安全重试", async () => {
    const first = await login();
    const oldCookie = cookieOf(first);
    const next = await login(oldCookie);
    const cookie = cookieOf(next);
    expect(cookie).not.toBe(oldCookie);
    expect(
      (
        await test.request("GET", "admin/auth/session", undefined, {
          cookie: oldCookie,
        })
      ).statusCode,
    ).toBe(401);
    expect(String(next.headers["set-cookie"])).toContain(
      "HttpOnly; SameSite=Lax",
    );
    const csrf = (
      await test.request("GET", "admin/auth/csrf", undefined, { cookie })
    ).json().csrfToken;
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rejectedHeaders: Record<string, string>[] = [
      { cookie },
      { cookie, origin: "https://evil.invalid", "x-csrf-token": csrf },
      { cookie, origin: "http://localhost:5173" },
      { cookie, origin: "http://localhost:5173", "x-csrf-token": "wrong" },
    ];
    for (const headers of rejectedHeaders)
      expect(
        (await test.request("POST", "admin/auth/logout", {}, headers))
          .statusCode,
      ).toBe(403);
    const headers = {
      cookie,
      origin: "http://localhost:5173",
      "x-csrf-token": csrf,
    };
    const logout = await test.request("POST", "admin/auth/logout", {}, headers);
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (await test.request("POST", "admin/auth/logout", {}, headers)).statusCode,
    ).toBe(204);
    expect(
      (await test.request("GET", "admin/auth/session", undefined, { cookie }))
        .statusCode,
    ).toBe(401);
  });

  it("拒绝跨站登录、错误密码、停用和过期会话，不泄露账号存在性", async () => {
    const body = { username: "test-admin", password: "wrong" };
    expect(
      (await test.request("POST", "admin/auth/login", body)).statusCode,
    ).toBe(403);
    expect(
      (
        await test.request("POST", "admin/auth/login", body, {
          origin: "https://evil.invalid",
        })
      ).statusCode,
    ).toBe(403);
    const wrong = await test.request("POST", "admin/auth/login", body, {
      origin: "http://localhost:5173",
    });
    const missing = await test.request(
      "POST",
      "admin/auth/login",
      { ...body, username: "unknown" },
      { origin: "http://localhost:5173" },
    );
    expect(wrong.statusCode).toBe(401);
    expect(missing.json().message).toBe(wrong.json().message);
    const cookie = cookieOf(await login());
    await test.pool.query("UPDATE admin_accounts SET active=false");
    expect(
      (await test.request("GET", "admin/auth/session", undefined, { cookie }))
        .statusCode,
    ).toBe(401);
    expect((await login()).statusCode).toBe(401);
    await test.pool.query("UPDATE admin_accounts SET active=true");
    await test.pool.query(
      "UPDATE admin_sessions SET expires_at=now()-interval '1 second'",
    );
    expect(
      (await test.request("GET", "admin/auth/session", undefined, { cookie }))
        .statusCode,
    ).toBe(401);
  });

  it("学生Bearer有效时返回403，未知凭据返回401，公开接口不受影响", async () => {
    const student = (
      await test.request("POST", "auth/wechat/login", {
        code: "stub-identity:admin-boundary",
        consentVersion: 1,
      })
    ).json();
    expect(
      (
        await test.request("GET", "admin/auth/session", undefined, {
          authorization: "Bearer " + student.accessToken,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await test.request("GET", "admin/auth/session", undefined, {
          authorization: "Bearer invalid",
        })
      ).statusCode,
    ).toBe(401);
    expect((await test.request("GET", "health")).statusCode).toBe(200);
  });

  it("受控初始化使用随机盐并记录维护者身份，重复账号不覆盖密码", async () => {
    const client = await test.pool.connect();
    try {
      await client.query("BEGIN");
      const id = await createAdminAccount(
        client,
        "initialized",
        "受控管理员",
        "initial-test-password",
      );
      await client.query("COMMIT");
      const response = await test.request(
        "POST",
        "admin/auth/login",
        { username: "initialized", password: "initial-test-password" },
        { origin: "http://localhost:5173" },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(id);
      await expect(
        createAdminAccount(client, "initialized", "覆盖", "changed-password"),
      ).rejects.toBeDefined();
      await expect(
        createAdminAccount(client, "invalid space", "失败", "short"),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it("应用重启仍可恢复有效会话且不延长绝对期限", async () => {
    const first = await login();
    const cookie = cookieOf(first);
    await test.restart();
    const restored = await test.request(
      "GET",
      "admin/auth/session",
      undefined,
      { cookie },
    );
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual(first.json());
  });

  it("仅允许指定Origin的凭据预检，未授权来源不获得CORS授权", async () => {
    const allowed = await test.request(
      "OPTIONS",
      "admin/auth/logout",
      undefined,
      {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-csrf-token",
      },
    );
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    const rejected = await test.request(
      "OPTIONS",
      "admin/auth/login",
      undefined,
      {
        origin: "https://evil.invalid",
        "access-control-request-method": "POST",
      },
    );
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("登录账号和来源限频可恢复，伪造转发IP不绕过来源预算", async () => {
    const config = test.app.get(ConfigService);
    config.set("ADMIN_RATE_LOGIN_ACCOUNT", 1);
    config.set("ADMIN_RATE_LOGIN_SOURCE", 10000);
    await test.pool.query(
      "DELETE FROM auth_rate_limits WHERE kind LIKE 'admin-login-%'",
    );
    const attempt = (username: string, forwarded = "1.2.3.4") =>
      test.request(
        "POST",
        "admin/auth/login",
        { username, password: "wrong" },
        { origin: "http://localhost:5173", "x-forwarded-for": forwarded },
      );
    expect((await attempt("missing-limit")).statusCode).toBe(401);
    expect((await attempt("missing-limit")).statusCode).toBe(429);
    await test.pool.query(
      "UPDATE auth_rate_limits SET window_started_at=window_started_at-interval '2 minutes' WHERE kind LIKE 'admin-login-%'",
    );
    expect((await attempt("missing-limit")).statusCode).toBe(401);
    config.set("ADMIN_RATE_LOGIN_SOURCE", 1);
    expect((await attempt("other-name", "5.6.7.8")).statusCode).toBe(429);
    config.set("ADMIN_RATE_LOGIN_SOURCE", 10000);
    config.set("ADMIN_RATE_LOGIN_ACCOUNT", 10000);
  });

  it("工作台区分真实空库0和未接入模块，审计只读接口分页过滤且不暴露凭据", async () => {
    const cookie = cookieOf(await login());
    const dashboard = await test.request("GET", "admin/dashboard", undefined, {
      cookie,
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "drafts",
          available: true,
          count: 0,
        }),
        expect.objectContaining({
          module: "published",
          available: true,
          count: 0,
        }),
        expect.objectContaining({
          module: "pending",
          available: false,
          count: null,
        }),
        expect.objectContaining({
          module: "sources",
          available: false,
          count: null,
        }),
      ]),
    );
    const operations = await test.request(
      "GET",
      "admin/operations?action=auth.login&pageSize=1",
      undefined,
      { cookie },
    );
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      page: 1,
      pageSize: 1,
      total: expect.any(Number),
    });
    expect(operations.json().items).toHaveLength(1);
    const operation = operations.json().items[0];
    expect(operation).toMatchObject({
      actorType: "admin",
      actorId: expect.any(String),
      result: "success",
      action: "auth.login",
    });
    const detail = await test.request(
      "GET",
      "admin/operations/" + operation.operationId,
      undefined,
      { cookie },
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(operation);
    expect(operations.body).not.toMatch(
      /password|token|csrf|test-password|hh_admin_session/i,
    );
    expect(
      (
        await test.request("GET", "admin/operations?pageSize=51", undefined, {
          cookie,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await test.request(
          "GET",
          "admin/operations?action=arbitrary",
          undefined,
          { cookie },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await test.request("GET", "admin/operations?from=wrong", undefined, {
          cookie,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await test.request(
          "GET",
          "admin/operations/00000000-0000-4000-8000-000000000000",
          undefined,
          { cookie },
        )
      ).statusCode,
    ).toBe(404);
    expect((await test.request("GET", "admin/operations")).statusCode).toBe(
      401,
    );
  });
});
