import {
  campusFixture,
  challengeResponse,
  successResponse,
  deferred,
} from "./campus-fixture.js";
import type { AuthHttpResponse } from "@hehuoda/sicau-connectors/auth";

describe("校园核验真实 HTTP 与包构建产物", () => {
  let f: Awaited<ReturnType<typeof campusFixture>>;
  beforeEach(async () => {
    f = await campusFixture();
  });
  afterEach(async () => {
    await f?.close();
  });
  it("告知、刷新、旧版本拒绝、单次提交、统一摘要和本人加密资料闭环", async () => {
    const a = await f.login();
    expect(
      (
        await f.request(
          "POST",
          "campus-verification/transactions",
          a.accessToken,
          { consentVersion: 2 },
        )
      ).statusCode,
    ).toBe(400);
    expect(f.counts.get).toBe(0);
    const t = await f.create(a.accessToken);
    const refresh = await f.request(
      "POST",
      `campus-verification/transactions/${t.id}/captcha`,
      a.accessToken,
    );
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().expiresAt).toBe(t.expiresAt);
    expect((await f.submit(a.accessToken, t)).statusCode).toBe(409);
    expect(f.counts.post).toBe(0);
    const result = await f.submit(a.accessToken, refresh.json());
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: "succeeded",
      qualification: {
        status: "valid",
        validUntil: "2027-01-31T16:00:00.000Z",
      },
    });
    expect(result.headers["cache-control"]).toBe("no-store");
    for (const secret of [
      "SYNTHETIC_SUBJECT",
      "00123456",
      "合成姓名",
      "PASSWORD",
      "TICKET",
    ])
      expect(result.body).not.toContain(secret);
    await f.submit(a.accessToken, refresh.json());
    expect(f.counts.post).toBe(1);
    const status = (
      await f.request("GET", "campus-verification", a.accessToken)
    ).json();
    const me = (await f.request("GET", "auth/me", a.accessToken)).json();
    const nickname = (
      await f.request("POST", "auth/me", a.accessToken, { nickname: "新昵称" })
    ).json();
    expect(me.campus).toEqual(nickname.campus);
    expect(status).toMatchObject(me.campus);
    expect(me).not.toHaveProperty("profile");
    expect(me.availability.teaming).toBe(false);
    const profile = await f.request(
      "GET",
      "campus-verification/profile",
      a.accessToken,
    );
    expect(profile.json()).toEqual({
      profile: {
        accountNumber: "00123456",
        name: "合成姓名",
        source: "sicau-eauth",
        updatedAt: "2026-10-25T00:00:00.000Z",
      },
    });
    expect(profile.headers["cache-control"]).toBe("no-store");
    const stored = await f.isolated.pool.query("select * from campus_profiles");
    expect(stored.rows[0]).toMatchObject({
      key_id: "v1",
      version: 1,
      nonce: expect.any(String),
      tag: expect.any(String),
    });
    const dump = JSON.stringify(
      (
        await f.isolated.pool.query(
          "select row_to_json(p) from campus_profiles p union all select row_to_json(b) from campus_bindings b union all select row_to_json(a) from campus_audit_logs a union all select row_to_json(t) from campus_transactions t",
        )
      ).rows,
    );
    for (const secret of [
      "SYNTHETIC_SUBJECT",
      "00123456",
      "合成姓名",
      "PASSWORD",
      "TICKET",
    ])
      expect(dump).not.toContain(secret);
    expect(
      (
        await f.request("POST", "campus-verification/profile", a.accessToken, {
          name: "伪造",
        })
      ).statusCode,
    ).toBe(404);
    for (const field of ["name", "accountNumber", "subject", "campus"]) {
      expect(
        (
          await f.request("POST", "auth/me", a.accessToken, {
            nickname: "合法",
            [field]: "伪造",
          })
        ).statusCode,
      ).toBe(400);
    }
  });
  it("跨用户／同用户其他会话404，校验额外身份输入，资料只属于本人", async () => {
    const a = await f.login("same"),
      b = await f.login(),
      other = await f.login("same");
    const t = await f.create(a.accessToken);
    for (const token of [b.accessToken, other.accessToken])
      for (const suffix of ["", "/submit", "/captcha"]) {
        expect(
          (
            await f.request(
              suffix ? "POST" : "GET",
              `campus-verification/transactions/${t.id}${suffix}`,
              token,
              suffix === "/submit"
                ? {
                    account: "x",
                    password: "x",
                    captcha: "ABCD",
                    challengeVersion: t.challenge.version,
                  }
                : undefined,
            )
          ).statusCode,
        ).toBe(404);
      }
    expect(
      (await f.submit(a.accessToken, t, { name: "伪造" })).statusCode,
    ).toBe(400);
    expect(f.counts.post).toBe(0);
    await f.submit(a.accessToken, t);
    expect(
      (
        await f.request("GET", "campus-verification/profile", b.accessToken)
      ).json(),
    ).toEqual({ profile: null });
    expect(
      (await f.request("GET", "campus-verification/profile")).statusCode,
    ).toBe(401);
    expect(
      (
        await f.request(
          "GET",
          "campus-verification/transactions/unknown",
          a.accessToken,
        )
      ).statusCode,
    ).toBe(404);
  });
  it.each(["cancel", "logout", "restrict", "disable"])(
    "%s 先完成时，迟到学校成功不保存身份或资格",
    async (action) => {
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
      if (action === "cancel")
        expect(
          (
            await f.request(
              "DELETE",
              `campus-verification/transactions/${t.id}`,
              a.accessToken,
            )
          ).statusCode,
        ).toBe(200);
      if (action === "logout")
        expect(
          (await f.request("POST", "auth/logout", a.accessToken)).statusCode,
        ).toBe(204);
      if (action === "restrict")
        await f.database.db.transaction((tx) =>
          f.lifecycle.restrict(tx, a.user.id, f.clock.now()),
        );
      if (action === "disable")
        f.config.set("CAMPUS_VERIFICATION_ENABLED", false);
      reply.resolve(successResponse());
      expect((await pending).statusCode).not.toBe(200);
      for (const table of [
        "campus_bindings",
        "campus_profiles",
        "campus_qualifications",
      ])
        expect(
          (await f.isolated.pool.query(`select count(*)::int c from ${table}`))
            .rows[0].c,
        ).toBe(0);
    },
  );
  it("并发／重复提交只发一次密码；刷新竞争不会复用已提交句柄", async () => {
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
    const repeated = await f.submit(a.accessToken, t);
    expect(repeated.json().status).toBe("processing");
    expect(
      (
        await f.request(
          "POST",
          `campus-verification/transactions/${t.id}/captcha`,
          a.accessToken,
        )
      ).statusCode,
    ).toBe(409);
    reply.resolve(successResponse());
    expect((await pending).statusCode).toBe(200);
    expect(f.counts.post).toBe(1);
  });
  it("刷新失败使事务终止；未知成功／多身份／异常必需字段均不给资格", async () => {
    const a = await f.login();
    let t = await f.create(a.accessToken);
    f.transport(async () => ({
      status: 503,
      headers: {},
      body: Buffer.from("PRIVATE_ERROR"),
    }));
    expect(
      (
        await f.request(
          "POST",
          `campus-verification/transactions/${t.id}/captcha`,
          a.accessToken,
        )
      ).statusCode,
    ).toBe(503);
    expect((await f.submit(a.accessToken, t)).json().status).toBe("failed");
    for (const reply of [
      successResponse("s", null, "合成姓名"),
      successResponse("s", "001", "\u0001"),
      {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify({ code: 200, data: { users: [{ id: "s" }] } }),
        ),
      },
    ]) {
      f.transport(async (r) =>
        r.method === "GET" ? challengeResponse() : reply,
      );
      t = await f.create(a.accessToken);
      expect((await f.submit(a.accessToken, t)).statusCode).not.toBe(200);
    }
    expect(
      (
        await f.request("GET", "campus-verification/profile", a.accessToken)
      ).json(),
    ).toEqual({ profile: null });
  });
});
