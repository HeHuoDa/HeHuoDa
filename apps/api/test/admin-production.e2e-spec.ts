import { authTestApp } from "./auth-fixture.js";
import { createAdminAccount } from "../src/admin/admin.service.js";

describe("管理员生产HTTP配置", () => {
  it("强制Secure且绝对有效期可配置，不返回密码或会话秘密", async () => {
    // A separate module instance boots with production configuration from the start.
    const production = await authTestApp({
      NODE_ENV: "production",
      WECHAT_LOGIN_ADAPTER: "real",
      ADMIN_ALLOWED_ORIGINS: "https://admin.example",
      ADMIN_SESSION_HOURS: "1",
    });
    try {
      const client = await production.pool.connect();
      try {
        await client.query("BEGIN");
        await createAdminAccount(
          client,
          "production-test",
          "管理员",
          "production-synthetic-password",
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const response = await production.request(
        "POST",
        "admin/auth/login",
        {
          username: "production-test",
          password: "production-synthetic-password",
        },
        { origin: "https://admin.example" },
      );
      expect(response.statusCode).toBe(200);
      const cookie = String(response.headers["set-cookie"]);
      expect(cookie).toContain("; Secure");
      expect(cookie).toContain("Path=/api/v1/admin; HttpOnly; SameSite=Lax");
      expect(cookie).not.toMatch(/Domain=/i);
      expect(
        new Date(response.json().expiresAt).getTime() - Date.now(),
      ).toBeGreaterThan(3500000);
      expect(
        new Date(response.json().expiresAt).getTime() - Date.now(),
      ).toBeLessThanOrEqual(3600000);
      expect(Object.keys(response.json()).sort()).toEqual([
        "displayName",
        "expiresAt",
        "id",
      ]);
      const stored = (
        await production.pool.query(
          "SELECT token_hash,csrf_hash FROM admin_sessions",
        )
      ).rows[0];
      expect(stored.token_hash.length).toBe(32);
      expect(stored.token_hash.toString("base64url")).not.toBe(
        cookie.split(";")[0]!.split("=")[1],
      );
    } finally {
      await production.close();
    }
  });
});
