import {
  campusFixture,
  challengeResponse,
  successResponse,
  deferred,
} from "./campus-fixture.js";
describe("校园核验滑动预算与共享容量", () => {
  let f: Awaited<ReturnType<typeof campusFixture>>;
  beforeEach(async () => {
    f = await campusFixture();
  });
  afterEach(async () => {
    await f?.close();
  });
  it("创建和刷新共用预算，取消后新建不能绕过；恰好一分钟释放最早请求", async () => {
    f.config.set("CAMPUS_RATE_CHALLENGE_USER", 2);
    const a = await f.login(),
      t = await f.create(a.accessToken);
    f.time("2026-10-25T00:00:30Z");
    expect(
      (
        await f.request(
          "POST",
          `campus-verification/transactions/${t.id}/captcha`,
          a.accessToken,
        )
      ).statusCode,
    ).toBe(200);
    await f.request(
      "DELETE",
      `campus-verification/transactions/${t.id}`,
      a.accessToken,
    );
    f.time("2026-10-25T00:00:59.999Z");
    expect(
      (
        await f.request(
          "POST",
          "campus-verification/transactions",
          a.accessToken,
          { consentVersion: 1 },
        )
      ).statusCode,
    ).toBe(429);
    expect(f.counts.get).toBe(2);
    f.time("2026-10-25T00:01:00Z");
    const next = await f.create(a.accessToken);
    expect(f.counts.get).toBe(3);
    expect(
      (
        await f.request(
          "POST",
          `campus-verification/transactions/${next.id}/captcha`,
          a.accessToken,
        )
      ).statusCode,
    ).toBe(429);
    f.time("2026-10-25T00:01:30Z");
    expect(
      (
        await f.request(
          "POST",
          `campus-verification/transactions/${next.id}/captcha`,
          a.accessToken,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("学校失败也消耗提交预算；任意滚动15分钟限制不因新平台会话重置", async () => {
    f.config.set("CAMPUS_RATE_SUBMIT_USER", 2);
    f.config.set("CAMPUS_RATE_CHALLENGE_USER", 100);
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
    const a = await f.login("budget");
    await f.submit(a.accessToken, await f.create(a.accessToken));
    f.time("2026-10-25T00:07:30Z");
    await f.submit(a.accessToken, await f.create(a.accessToken));
    f.time("2026-10-25T00:14:59.999Z");
    const t = await f.create(a.accessToken);
    expect((await f.submit(a.accessToken, t)).statusCode).toBe(429);
    expect(f.counts.post).toBe(2);
    await f.request(
      "DELETE",
      `campus-verification/transactions/${t.id}`,
      a.accessToken,
    );
    f.time("2026-10-25T00:15:00Z");
    const fresh = await f.login("budget");
    expect(
      (await f.submit(fresh.accessToken, await f.create(fresh.accessToken)))
        .statusCode,
    ).toBe(400);
    expect(f.counts.post).toBe(3);
    expect(
      (await f.submit(fresh.accessToken, await f.create(fresh.accessToken)))
        .statusCode,
    ).toBe(429);
  });
  it.each(["SOURCE", "GLOBAL"])(
    "%s 预算独立于用户，拒绝请求不发学校挑战",
    async (scope) => {
      f.config.set(`CAMPUS_RATE_CHALLENGE_${scope}`, 1);
      const a = await f.login(),
        b = await f.login();
      await f.create(a.accessToken);
      expect(
        (
          await f.request(
            "POST",
            "campus-verification/transactions",
            b.accessToken,
            { consentVersion: 1 },
          )
        ).statusCode,
      ).toBe(429);
      expect(f.counts.get).toBe(1);
      const rates = JSON.stringify(
        (await f.isolated.pool.query("select * from campus_rate_budgets")).rows,
      );
      expect(rates).not.toContain("127.0.0.1");
    },
  );
  it("挑战与提交共享5个在途请求，第6个立即拒绝；不排队或自动重试", async () => {
    const actors = await Promise.all(
      Array.from({ length: 6 }, () => f.login()),
    );
    const t = await f.create(actors[0]!.accessToken);
    const started = deferred<void>(),
      release = deferred<void>();
    let inFlight = 0,
      max = 0;
    f.transport(async (r) => {
      inFlight++;
      max = Math.max(max, inFlight);
      if (inFlight === 5) started.resolve();
      await release.promise;
      inFlight--;
      return r.method === "GET" ? challengeResponse() : successResponse();
    });
    const requests = [
      f.submit(actors[0]!.accessToken, t).then((r) => r),
      ...actors.slice(1, 5).map((a) =>
        f
          .request("POST", "campus-verification/transactions", a.accessToken, {
            consentVersion: 1,
          })
          .then((r) => r),
      ),
    ];
    await Promise.race([
      started.promise,
      Promise.all(requests).then((results) => {
        throw new Error(
          "未达到并发边界：" +
            results.map((r) => r.statusCode + ":" + r.json().code).join(","),
        );
      }),
    ]);
    const rejected = await f.request(
      "POST",
      "campus-verification/transactions",
      actors[5]!.accessToken,
      { consentVersion: 1 },
    );
    expect(rejected.statusCode).toBe(503);
    expect(rejected.json().code).toBe("CAMPUS_UPSTREAM_CAPACITY");
    release.resolve();
    expect((await Promise.all(requests)).map((r) => r.statusCode)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(max).toBe(5);
    expect(f.counts.post).toBe(1);
    expect(f.counts.get).toBe(5);
  });
  it("总活动事务上限128，超限不外联或新增活动事务", async () => {
    f.config.set("CAMPUS_RATE_CHALLENGE_SOURCE", 1000);
    f.config.set("CAMPUS_RATE_CHALLENGE_GLOBAL", 1000);
    for (let i = 0; i < 128; i++) {
      const a = await f.login();
      await f.create(a.accessToken);
    }
    const a = await f.login();
    const response = await f.request(
      "POST",
      "campus-verification/transactions",
      a.accessToken,
      { consentVersion: 1 },
    );
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CAMPUS_SESSION_CAPACITY");
    expect(f.counts.get).toBe(128);
    expect(
      (
        await f.isolated.pool.query(
          "select count(*)::int c from campus_transactions where status in ('waiting','processing')",
        )
      ).rows[0].c,
    ).toBe(128);
  }, 30000);
});
