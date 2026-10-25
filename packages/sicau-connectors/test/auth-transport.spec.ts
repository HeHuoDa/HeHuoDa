import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import type { RequestOptions, IncomingMessage, ClientRequest } from "node:http";

// 只替换外部 HTTPS 边界，真实客户端、协议和会话生命周期照常运行。
type Reply = {
  status: number;
  headers: Record<string, string | string[]>;
  chunks: Buffer[];
  disconnect?: boolean;
  hang?: boolean;
};
const replies: Reply[] = [];
const bodies: (string | undefined)[] = [];
const requestMock = jest.fn(
  (
    url: string,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body?: string) => void;
      destroy: (error?: Error) => void;
    };
    req.destroy = (error) => {
      queueMicrotask(() =>
        req.emit("error", error ?? new Error("SECRET_SOCKET")),
      );
    };
    req.end = (body) => {
      bodies.push(body);
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected school request");
      queueMicrotask(() => {
        if (reply.hang) return;
        const res = Object.assign(new EventEmitter(), {
          statusCode: reply.status,
          headers: reply.headers,
        });
        callback(res as IncomingMessage);
        for (const chunk of reply.chunks) res.emit("data", chunk);
        if (reply.disconnect) res.emit("error", new Error("SECRET_DISCONNECT"));
        else res.emit("end");
      });
    };
    options.signal?.addEventListener("abort", () => req.destroy(), {
      once: true,
    });
    return req as ClientRequest;
  },
);
jest.unstable_mockModule("node:https", () => ({ request: requestMock }));
const { SchoolAuthClient } = await import("../dist/auth/index.js");
const encryptedImage =
  "ABEiM0RVZneImaq7zN3u/zJlgNtocJj+pe3pZHEYwfkXDXOGx9iyKBdVhrXnE0ffXUYkKo2GgldA5/PzRqw8OIWdjHfMV9PR3qiCeYrUjr91+6KgI0mlbKoLwM68qM0UPCBdR3/JeQPdeak3cs8wAvkgzIlLAsW4ikKWjSZ/vI+6jTsRR7aP3JMlGv/wZoNb";
const challengeReply = (): Reply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  chunks: [
    Buffer.from(
      JSON.stringify({
        code: 200,
        id: "fixture-uuid",
        requestId: "fixture-request",
        data: encryptedImage,
      }),
    ),
  ],
});
beforeEach(() => {
  replies.length = 0;
  bodies.length = 0;
  requestMock.mockClear();
});

describe("认证实际 HTTPS 传输", () => {
  it.each([302, 303, 307, 308])(
    "密码 POST 遇 %i 不追随任何 Location，也不自动重发",
    async (status) => {
      replies.push(challengeReply(), {
        status,
        headers: {
          "content-type": "text/html",
          location: "https://auth.sicau.edu.cn/api/v1/cas/login?ticket=SECRET",
        },
        chunks: [Buffer.from("SECRET_RESPONSE")],
      });
      const client = new SchoolAuthClient();
      try {
        const challenge = await client.createChallenge();
        await expect(
          client.submit({
            handle: challenge.handle,
            challengeVersion: challenge.challengeVersion,
            account: "fixture",
            password: "SECRET_PASSWORD",
            captcha: "ABCD",
          }),
        ).rejects.toMatchObject({ code: "unknown_response" });
        expect(requestMock).toHaveBeenCalledTimes(2);
        expect(requestMock.mock.calls.map(([url]) => url)).toEqual([
          "https://auth.sicau.edu.cn/api/v1/captcha?appid=sicau-cas",
          "https://auth.sicau.edu.cn/api/v1/cas/login",
        ]);
        expect(requestMock.mock.calls[1][1]).toMatchObject({
          agent: false,
          method: "POST",
          maxHeaderSize: 16384,
        });
        expect(bodies.filter(Boolean)).toHaveLength(1);
      } finally {
        client.dispose();
      }
    },
  );

  it("响应流超出上限时中止连接并安全失败", async () => {
    replies.push({
      ...challengeReply(),
      chunks: [Buffer.alloc(1025), Buffer.from("SECRET_EXTRA")],
    });
    const client = new SchoolAuthClient({ maxResponseBytes: 1024 });
    try {
      await expect(client.createChallenge()).rejects.toMatchObject({
        code: "unknown_response",
      });
      expect(requestMock).toHaveBeenCalledTimes(1);
    } finally {
      client.dispose();
    }
  });

  it("密码提交中断网不重试，也不暴露底层 socket 错误", async () => {
    replies.push(challengeReply(), {
      status: 200,
      headers: {},
      chunks: [],
      disconnect: true,
    });
    const client = new SchoolAuthClient();
    try {
      const challenge = await client.createChallenge();
      await expect(
        client.submit({
          handle: challenge.handle,
          challengeVersion: challenge.challengeVersion,
          account: "fixture",
          password: "SECRET_PASSWORD",
          captcha: "ABCD",
        }),
      ).rejects.toMatchObject({
        code: "upstream_unavailable",
        message: "upstream_unavailable",
      });
      expect(bodies.filter(Boolean)).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });

  it("密码提交超时销毁请求，不自动重试", async () => {
    jest.useFakeTimers();
    const client = new SchoolAuthClient({ requestTimeoutMs: 30 });
    try {
      replies.push(challengeReply(), {
        status: 200,
        headers: {},
        chunks: [],
        hang: true,
      });
      const challengePromise = client.createChallenge();
      await jest.advanceTimersByTimeAsync(0);
      const challenge = await challengePromise;
      const pending = expect(
        client.submit({
          handle: challenge.handle,
          challengeVersion: challenge.challengeVersion,
          account: "fixture",
          password: "SECRET_PASSWORD",
          captcha: "ABCD",
        }),
      ).rejects.toMatchObject({ code: "upstream_timeout" });
      await jest.advanceTimersByTimeAsync(31);
      await pending;
      expect(bodies.filter(Boolean)).toHaveLength(1);
    } finally {
      client.dispose();
      jest.useRealTimers();
    }
  });
});
