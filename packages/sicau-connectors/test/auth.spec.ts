import { jest } from "@jest/globals";
import {
  SchoolAuthClient,
  type AuthTransport,
  type AuthHttpResponse,
} from "../dist/auth/index.js";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=";
const response = (value: unknown): AuthHttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(value)),
});
// 固定合成向量：MD5(requestId + ":sicau-cas") 原始 16 字节，IV 前缀 + CBC/PKCS7。
const encryptedImage =
  "ABEiM0RVZneImaq7zN3u/zJlgNtocJj+pe3pZHEYwfkXDXOGx9iyKBdVhrXnE0ffXUYkKo2GgldA5/PzRqw8OIWdjHfMV9PR3qiCeYrUjr91+6KgI0mlbKoLwM68qM0UPCBdR3/JeQPdeak3cs8wAvkgzIlLAsW4ikKWjSZ/vI+6jTsRR7aP3JMlGv/wZoNb";
const captcha = (id = "synthetic-challenge") =>
  response({
    code: 200,
    id,
    requestId: "fixture-request",
    data: encryptedImage,
  });
const success = (
  id: string | number = "synthetic-subject",
  profile: Record<string, unknown> = { number: "00123456", name: "合成姓名" },
) =>
  response({
    code: 200,
    msg: "登录成功",
    data: {
      user: { id, ...profile, phone: "SECRET_PHONE" },
      users: [],
      st: "SECRET_ST",
      tgt: "SECRET_TGT",
    },
  });
const credentials = {
  account: "synthetic-account",
  password: "SECRET_PASSWORD",
  captcha: "ABCD",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const submit = (
  client: SchoolAuthClient,
  challenge: Awaited<ReturnType<SchoolAuthClient["createChallenge"]>>,
) =>
  client.submit({
    handle: challenge.handle,
    challengeVersion: challenge.challengeVersion,
    ...credentials,
  });

describe("学校认证包公开接口", () => {
  it("Cookie 按会话和路径隔离，忽略外域 Cookie，销毁后不复用", async () => {
    let gets = 0;
    const transport = jest.fn<AuthTransport>(async (request) => {
      if (request.method === "GET") {
        const reply = captcha();
        reply.headers["set-cookie"] = [
          `SESSION=SECRET_COOKIE_${++gets}; Path=/api/v1; Secure; HttpOnly`,
          "WRONG=SECRET_WRONG; Domain=evil.test; Path=/",
          "PATH=SECRET_PATH; Path=/outside; Secure",
          "GONE=SECRET_GONE; Max-Age=0; Path=/",
        ];
        return reply;
      }
      return success();
    });
    const client = new SchoolAuthClient({}, transport);
    try {
      const a = await client.createChallenge(),
        b = await client.createChallenge();
      expect(transport.mock.calls[1][0].headers.cookie).toBeUndefined();
      await client.submit({
        handle: a.handle,
        challengeVersion: a.challengeVersion,
        ...credentials,
      });
      expect(transport.mock.calls[2][0].headers.cookie).toBe(
        "SESSION=SECRET_COOKIE_1",
      );
      expect(JSON.stringify(b)).not.toContain("SECRET_COOKIE");
      await submit(client, b);
      expect(transport.mock.calls[3][0].headers.cookie).toBe(
        "SESSION=SECRET_COOKIE_2",
      );
      await client.createChallenge();
      expect(transport.mock.calls[4][0].headers.cookie).toBeUndefined();
    } finally {
      client.dispose();
    }
  });
  it("返回可信主体、学校账号及姓名并释放句柄，不返回票据、电话或原始响应", async () => {
    const replies = [captcha(), success()];
    const transport = jest.fn<AuthTransport>(async () => replies.shift()!);
    const client = new SchoolAuthClient({}, transport);
    try {
      const challenge = await client.createChallenge();
      expect(challenge).toMatchObject({
        imageDataUrl: image,
        mimeType: "image/png",
      });
      expect(JSON.stringify(challenge)).not.toContain("synthetic-challenge");
      expect(
        await client.submit({
          handle: challenge.handle,
          challengeVersion: challenge.challengeVersion,
          ...credentials,
        }),
      ).toEqual({
        source: "sicau-eauth",
        subject: "synthetic-subject",
        accountNumber: "00123456",
        name: "合成姓名",
      });
      await expect(
        client.submit({
          handle: challenge.handle,
          challengeVersion: challenge.challengeVersion,
          ...credentials,
        }),
      ).rejects.toMatchObject({ code: "invalid_session" });
      expect(transport).toHaveBeenCalledTimes(2);
      expect(JSON.parse(transport.mock.calls[1][0].body!)).toEqual({
        appid: "sicau-cas",
        number: credentials.account,
        password: credentials.password,
        code: credentials.captcha,
        uuid: "synthetic-challenge",
      });
    } finally {
      client.dispose();
    }
  });

  it.each([
    { number: undefined, name: "合成姓名" },
    { number: null, name: "合成姓名" },
    { number: 123456, name: "合成姓名" },
    { number: "", name: "合成姓名" },
    { number: "   ", name: "合成姓名" },
    { number: "0012\nSECRET_NUMBER", name: "合成姓名" },
    { number: "X".repeat(129), name: "合成姓名" },
    { number: "00123456", name: undefined },
    { number: "00123456", name: null },
    { number: "00123456", name: 123 },
    { number: "00123456", name: "" },
    { number: "00123456", name: " \u3000 " },
    { number: "00123456", name: "姓名\nSECRET_NAME" },
    { number: "00123456", name: "名".repeat(129) },
  ])(
    "学校账号或姓名缺失、格式异常时不返回完整核验结果，也不使用提交账号补齐 %#",
    async (profile) => {
      const transport = jest.fn<AuthTransport>(async (request) =>
        request.method === "GET"
          ? captcha()
          : success("valid-subject", profile),
      );
      const client = new SchoolAuthClient({}, transport);
      try {
        const challenge = await client.createChallenge();
        const error = await submit(client, challenge).catch(
          (value) => value as Error,
        );
        expect(error).toMatchObject({
          code: "unknown_response",
          message: "unknown_response",
        });
        expect(JSON.stringify(error)).not.toMatch(
          /SECRET_|合成姓名|00123456|valid-subject/,
        );
        await expect(submit(client, challenge)).rejects.toMatchObject({
          code: "invalid_session",
        });
        expect(transport).toHaveBeenCalledTimes(2);
      } finally {
        client.dispose();
      }
    },
  );

  it("按学校公开前端契约解密固定合成成功响应，主体不作大小写或数字转换", async () => {
    const client = new SchoolAuthClient({}, async (request) =>
      request.method === "GET"
        ? captcha()
        : response({
            code: 200,
            msg: "登录成功",
            requestId: "identity-request",
            data: "AwMDAwMDAwMDAwMDAwMDAycfAmt0IIOVo+hw19XrokHA9CtmDemvAGZ4Jl557LrAKsqLjCvGSAF3Qp7EmzaUoTdG5mkA7WIoSdQbKdPT+Te58EPPwkRaaGi+vdxqYWyF8/JKEoHo+zj/xiOyJez4y7XVGBEcIz1L3I9yvZse8ekStol8EbsSyM3egmUVtk3d",
          }),
    );
    try {
      expect(await submit(client, await client.createChallenge())).toEqual({
        source: "sicau-eauth",
        subject: "stable-007",
        accountNumber: "00123456",
        name: "合成姓名",
      });
    } finally {
      client.dispose();
    }
  });

  it("刷新立即作废旧版本；跨会话版本混用不会发送密码", async () => {
    const transport = jest.fn<AuthTransport>(async (request) =>
      request.method === "GET" ? captcha() : success(),
    );
    const client = new SchoolAuthClient({}, transport);
    try {
      const a = await client.createChallenge(),
        b = await client.createChallenge();
      const fresh = await client.refreshChallenge(a.handle);
      expect(fresh.handle).toBe(a.handle);
      expect(fresh.challengeVersion).not.toBe(a.challengeVersion);
      await expect(submit(client, a)).rejects.toMatchObject({
        code: "stale_challenge",
      });
      await expect(
        submit(client, { ...fresh, challengeVersion: b.challengeVersion }),
      ).rejects.toMatchObject({ code: "stale_challenge" });
      expect(
        transport.mock.calls.filter(([request]) => request.method === "POST"),
      ).toHaveLength(0);
      expect(await submit(client, fresh)).toEqual({
        source: "sicau-eauth",
        subject: "synthetic-subject",
        accountNumber: "00123456",
        name: "合成姓名",
      });
    } finally {
      client.dispose();
    }
  });

  it("刷新中拒绝刷新与提交；提交中拒绝所有并发操作，只发送一次密码", async () => {
    const refresh = deferred<AuthHttpResponse>(),
      login = deferred<AuthHttpResponse>();
    let gets = 0;
    const transport = jest.fn<AuthTransport>((request) =>
      request.method === "GET"
        ? ++gets === 1
          ? Promise.resolve(captcha())
          : refresh.promise
        : login.promise,
    );
    const client = new SchoolAuthClient({}, transport);
    try {
      const a = await client.createChallenge();
      const updating = client.refreshChallenge(a.handle);
      await expect(submit(client, a)).rejects.toMatchObject({
        code: "session_busy",
      });
      await expect(client.refreshChallenge(a.handle)).rejects.toMatchObject({
        code: "session_busy",
      });
      refresh.resolve(captcha("fresh"));
      const b = await updating;
      const processing = submit(client, b);
      await expect(submit(client, b)).rejects.toMatchObject({
        code: "session_busy",
      });
      await expect(client.refreshChallenge(b.handle)).rejects.toMatchObject({
        code: "session_busy",
      });
      login.resolve(success());
      await processing;
      expect(
        transport.mock.calls.filter(([request]) => request.method === "POST"),
      ).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });

  it.each([1, 123456, Number.MAX_SAFE_INTEGER])(
    "学校数字主体 %s 规范化后与相同字符串主体一致",
    async (id) => {
      const subjects: string[] = [];
      for (const upstreamId of [id, String(id)]) {
        const client = new SchoolAuthClient({}, async (request) =>
          request.method === "GET" ? captcha() : success(upstreamId),
        );
        try {
          const challenge = await client.createChallenge();
          const identity = await submit(client, challenge);
          subjects.push(identity.subject);
          expect(identity.accountNumber).toBe("00123456");
        } finally {
          client.dispose();
        }
      }
      expect(subjects).toEqual([String(id), String(id)]);
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "拒绝无法安全规范化的数字主体 %s",
    async (id) => {
      const client = new SchoolAuthClient({}, async (request) =>
        request.method === "GET" ? captcha() : success(id),
      );
      try {
        const challenge = await client.createChallenge();
        await expect(submit(client, challenge)).rejects.toMatchObject({
          code: "unknown_response",
        });
      } finally {
        client.dispose();
      }
    },
  );

  it("不同账号输入仍采用替身返回的主体，不从输入或个人字段推导身份", async () => {
    const client = new SchoolAuthClient({}, async (request) =>
      request.method === "GET" ? captcha() : success("stable-id"),
    );
    try {
      const a = await client.createChallenge(),
        b = await client.createChallenge();
      const one = await client.submit({
        ...credentials,
        account: "alias-one",
        handle: a.handle,
        challengeVersion: a.challengeVersion,
      });
      const two = await client.submit({
        ...credentials,
        account: "alias-two",
        handle: b.handle,
        challengeVersion: b.challengeVersion,
      });
      expect(one).toEqual({
        source: "sicau-eauth",
        subject: "stable-id",
        accountNumber: "00123456",
        name: "合成姓名",
      });
      expect(two).toEqual(one);
    } finally {
      client.dispose();
    }
  });

  it.each([
    ["captcha_failed", { code: 500, msg: "验证码错误", data: null }],
    [
      "credentials_failed",
      { code: 500, msg: "用户不存在或未激活", data: null },
    ],
    [
      "unknown_response",
      {
        code: 200,
        msg: "登录成功",
        data: {
          st: "SECRET_ST",
          tgt: "SECRET_TGT",
          users: [],
          user: { number: "self-reported" },
        },
      },
    ],
    [
      "unknown_response",
      {
        code: 200,
        msg: "登录成功",
        data: { st: "SECRET_ST", users: [], user: { id: "subject" } },
      },
    ],
    [
      "unknown_response",
      { code: 200, msg: "SECRET_UNKNOWN", data: { user: { id: "subject" } } },
    ],
    [
      "unsupported_verification",
      {
        code: 200,
        msg: "登录成功",
        data: {
          st: "SECRET_ST",
          tgt: "SECRET_TGT",
          users: [{ id: "different" }],
          user: { id: "subject" },
        },
      },
    ],
    ["unknown_response", { code: 200, msg: "需要二次认证", data: null }],
  ])("学校响应只按已验证契约判定，安全失败 %s", async (code, payload) => {
    const transport = jest.fn<AuthTransport>(async (request) =>
      request.method === "GET" ? captcha() : response(payload),
    );
    const client = new SchoolAuthClient({}, transport);
    try {
      const challenge = await client.createChallenge();
      const error = await submit(client, challenge).catch(
        (value) => value as Error,
      );
      expect(error).toMatchObject({ code, message: code });
      expect(JSON.stringify(error)).not.toMatch(
        /SECRET_|self-reported|subject|different/,
      );
      expect((error as Error).cause).toBeUndefined();
      await expect(submit(client, challenge)).rejects.toMatchObject({
        code: "invalid_session",
      });
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      client.dispose();
    }
  });

  it.each([302, 303, 307, 308, 429, 500, 503])(
    "上游 HTTP %i 不跳转或自动重放密码",
    async (status) => {
      const transport = jest.fn<AuthTransport>(async (request) =>
        request.method === "GET"
          ? captcha()
          : {
              ...success(),
              status,
              headers: {
                "content-type": "application/json",
                location: "https://evil.test/SECRET_TICKET",
              },
            },
      );
      const client = new SchoolAuthClient({}, transport);
      try {
        await expect(
          submit(client, await client.createChallenge()),
        ).rejects.toMatchObject({
          code: status >= 429 ? "upstream_unavailable" : "unknown_response",
        });
        expect(transport).toHaveBeenCalledTimes(2);
      } finally {
        client.dispose();
      }
    },
  );

  it("传输异常不泄露原始错误、cause、账号或密码，也不重试", async () => {
    const transport = jest.fn<AuthTransport>(async (request) => {
      if (request.method === "GET") return captcha();
      throw new Error("SECRET_PASSWORD SECRET_COOKIE SECRET_TICKET", {
        cause: "SECRET_CAUSE",
      });
    });
    const client = new SchoolAuthClient({}, transport);
    try {
      const error = await submit(client, await client.createChallenge()).catch(
        (value) => value as Error,
      );
      expect(error).toMatchObject({
        code: "upstream_unavailable",
        message: "upstream_unavailable",
      });
      expect(JSON.stringify(error)).not.toContain("SECRET");
      expect((error as Error).cause).toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      client.dispose();
    }
  });

  it("取消/销毁中断在途提交；忽略取消的迟到成功不能重建会话", async () => {
    const late = deferred<AuthHttpResponse>();
    const transport = jest.fn<AuthTransport>((request) =>
      request.method === "GET" ? Promise.resolve(captcha()) : late.promise,
    );
    const client = new SchoolAuthClient({}, transport);
    try {
      const challenge = await client.createChallenge();
      const processing = submit(client, challenge);
      client.destroy(challenge.handle);
      client.destroy(challenge.handle);
      await expect(processing).rejects.toMatchObject({ code: "cancelled" });
      expect(transport.mock.calls[1][0].signal.aborted).toBe(true);
      late.resolve(success());
      await Promise.resolve();
      await expect(submit(client, challenge)).rejects.toMatchObject({
        code: "invalid_session",
      });
      const restarted = new SchoolAuthClient({}, transport);
      try {
        await expect(submit(restarted, challenge)).rejects.toMatchObject({
          code: "invalid_session",
        });
      } finally {
        restarted.dispose();
      }
    } finally {
      client.dispose();
    }
  });

  it("响应刚完成、调用方尚未消费结果时取消，也不得返回成功", async () => {
    let cancel = () => {};
    const client = new SchoolAuthClient({}, async (request) => {
      if (request.method === "GET") return captcha();
      // 让 send 的响应检查先运行，取消发生在外层消费其结果之前。
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(cancel)));
      return success();
    });
    try {
      const challenge = await client.createChallenge();
      cancel = () => client.destroy(challenge.handle);
      await expect(submit(client, challenge)).rejects.toMatchObject({
        code: "cancelled",
      });
    } finally {
      client.dispose();
    }
  });

  it("外部取消信号不透传原因，取消后释放容量", async () => {
    const client = new SchoolAuthClient({ maxSessions: 1 }, async () =>
      captcha(),
    );
    const abort = new AbortController();
    try {
      const a = await client.createChallenge({ signal: abort.signal });
      await expect(client.createChallenge()).rejects.toMatchObject({
        code: "capacity_exceeded",
      });
      abort.abort(new Error("SECRET_ABORT"));
      await expect(submit(client, a)).rejects.toMatchObject({
        code: "invalid_session",
      });
      const b = await client.createChallenge();
      const cancelled = new AbortController();
      cancelled.abort("SECRET_REASON");
      await expect(
        client.submit({
          handle: b.handle,
          challengeVersion: b.challengeVersion,
          ...credentials,
          signal: cancelled.signal,
        }),
      ).rejects.toMatchObject({ code: "cancelled", message: "cancelled" });
      await client.createChallenge();
    } finally {
      client.dispose();
    }
  });

  it("会话与请求分别有期限；挂起请求及时失败且不重试密码", async () => {
    jest.useFakeTimers();
    try {
      for (const [ttlMs, timeoutMs, code] of [
        [30, 100, "session_expired"],
        [100, 30, "upstream_timeout"],
      ] as const) {
        const transport = jest.fn<AuthTransport>((request) =>
          request.method === "GET"
            ? Promise.resolve(captcha())
            : new Promise(() => {}),
        );
        const client = new SchoolAuthClient(
          { requestTimeoutMs: timeoutMs },
          transport,
        );
        try {
          const challenge = await client.createChallenge({ ttlMs });
          expect(challenge.expiresAt).toBe(Date.now() + ttlMs);
          const pending = expect(
            submit(client, challenge),
          ).rejects.toMatchObject({ code });
          await jest.advanceTimersByTimeAsync(31);
          await pending;
          expect(transport).toHaveBeenCalledTimes(2);
          await expect(submit(client, challenge)).rejects.toMatchObject({
            code: "invalid_session",
          });
        } finally {
          client.dispose();
        }
      }
      const client = new SchoolAuthClient({ maxSessions: 1 }, async () =>
        captcha(),
      );
      try {
        const challenge = await client.createChallenge({ ttlMs: 5 });
        await jest.advanceTimersByTimeAsync(5);
        await expect(submit(client, challenge)).rejects.toMatchObject({
          code: "invalid_session",
        });
        await client.createChallenge();
      } finally {
        client.dispose();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("销毁模块中断全部在途挑战，迟到响应不恢复状态", async () => {
    const late = deferred<AuthHttpResponse>();
    const signals: AbortSignal[] = [];
    const client = new SchoolAuthClient({}, async (request) => {
      signals.push(request.signal);
      return late.promise;
    });
    const a = client.createChallenge(),
      b = client.createChallenge();
    client.dispose();
    client.dispose();
    await expect(a).rejects.toMatchObject({ code: "cancelled" });
    await expect(b).rejects.toMatchObject({ code: "cancelled" });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    late.resolve(captcha());
    await expect(client.createChallenge()).rejects.toMatchObject({
      code: "disposed",
    });
  });

  it.each([
    response({ code: 200, id: "id", requestId: "x", data: "SECRET_BROKEN" }),
    response({
      code: 200,
      id: "id",
      requestId: "x",
      data: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }),
    {
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("SECRET_HTML"),
    },
    {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{SECRET_JSON"),
    },
    response({ code: 200, data: null }),
  ])("坏协议响应不泄露内容，也不创建可用句柄 %#", async (reply) => {
    const client = new SchoolAuthClient({ maxSessions: 1 }, async () => reply);
    try {
      for (let i = 0; i < 2; i++)
        await expect(client.createChallenge()).rejects.toMatchObject({
          code: "unknown_response",
          message: "unknown_response",
        });
    } finally {
      client.dispose();
    }
  });

  it("响应大小、输入及配置有上限；不接受任意学校来源", async () => {
    const transport = jest.fn<AuthTransport>(async () => ({
      ...captcha(),
      body: Buffer.alloc(1025),
    }));
    const client = new SchoolAuthClient({ maxResponseBytes: 1024 }, transport);
    try {
      await expect(client.createChallenge()).rejects.toMatchObject({
        code: "unknown_response",
      });
    } finally {
      client.dispose();
    }
    expect(() => new SchoolAuthClient({ sessionTtlMs: 300001 })).toThrow(
      "invalid_input",
    );
    expect(() => new SchoolAuthClient({ maxSessions: Infinity })).toThrow(
      "invalid_input",
    );
    const normal = new SchoolAuthClient({}, async () => captcha());
    try {
      const a = await normal.createChallenge();
      await expect(
        normal.submit({
          ...credentials,
          password: "",
          handle: a.handle,
          challengeVersion: a.challengeVersion,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    } finally {
      normal.dispose();
    }
  });
});
