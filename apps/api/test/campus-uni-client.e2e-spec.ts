import { campusFixture, successResponse } from "./campus-fixture.js";
import { readFileSync } from "node:fs";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

// 动态加载消费端公共接口，避免将 uni 编译进 API 构建；生产不导入前端。
const campusModule = "../../uni/src/api/campus-client.ts";
const httpModule = "../../uni/src/api/http.ts";
async function consumerModule(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  // uni 未声明 ESM；显式用其构建目标转译同一源码，避免 Jest 按 API 的 NodeNext 误编为 CJS。
  const module = new SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  );
  await module.link(() => {
    throw new Error("消费端测试模块不应依赖运行时导入");
  });
  await module.evaluate();
  return module.namespace;
}

describe("uni 校园客户端与真实平台 HTTP/数据库联调", () => {
  let f: Awaited<ReturnType<typeof campusFixture>>;
  beforeEach(async () => {
    f = await campusFixture();
  });
  afterEach(async () => {
    await f?.close();
  });

  it("生成契约闭环：独立告知、刷新、提交、本人只读资料、旧资格保留与取消", async () => {
    const createCampusApi = Reflect.get(
      await consumerModule(campusModule),
      "createCampusApi",
    );
    const createHttpClient = Reflect.get(
      await consumerModule(httpModule),
      "createHttpClient",
    );
    const auth = await f.login();
    const methods: string[] = [];
    const api = createCampusApi(
      createHttpClient(
        (options: {
          method: "GET" | "POST" | "DELETE";
          url: string;
          data?: unknown;
          header: { Authorization: string };
          success(response: { statusCode: number; data: unknown }): void;
          fail(error: { errMsg: string }): void;
        }) => {
          methods.push(options.method);
          void f
            .request(
              options.method,
              options.url.replace("/api/v1/", ""),
              options.header.Authorization.slice(7),
              options.data,
            )
            .then((r) =>
              options.success({ statusCode: r.statusCode, data: r.json() }),
            )
            .catch(() => options.fail({ errMsg: "network" }));
          return { abort() {} };
        },
        () => ({ baseUrl: "/api/v1", timeout: 5000 }),
        {
          accessToken: () => auth.accessToken,
          refresh: async () => auth.accessToken,
        },
      ),
    );
    const policy = await api.policy().promise;
    expect(policy.version).toBe(1);
    expect((await api.status().promise).status).toBe("unverified");
    expect((await api.profile().promise).profile).toBeNull();
    // 创建事务不再携带告知版本；姓名与告知版本随提交发送（#167 契约）。
    const created = await api.create().promise;
    const refreshed = await api.refresh(created.id).promise;
    expect(refreshed.challenge.version).not.toBe(created.challenge.version);
    await expect(
      api.submit(created.id, {
        name: "合成姓名",
        account: "synthetic-account",
        password: " pass ",
        captcha: "ABCD",
        challengeVersion: created.challenge.version,
        consentVersion: policy.version,
      }).promise,
    ).rejects.toMatchObject({ code: "CAMPUS_STALE_CHALLENGE" });
    expect(f.counts.post).toBe(0);
    const success = await api.submit(created.id, {
      name: "合成姓名",
      account: "synthetic-account",
      password: " pass ",
      captcha: "ABCD",
      challengeVersion: refreshed.challenge.version,
      consentVersion: policy.version,
    }).promise;
    expect(success.status).toBe("succeeded");
    expect((await api.query(created.id).promise).status).toBe("succeeded");
    const valid = await api.status().promise;
    expect(valid.status).toBe("valid");
    expect((await api.profile().promise).profile).toMatchObject({
      accountNumber: "00123456",
      name: "合成姓名",
    });
    const renewal = await api.create().promise;
    f.transport(async () => successResponse("ANOTHER_SYNTHETIC_SUBJECT"));
    await expect(
      api.submit(renewal.id, {
        name: "合成姓名",
        account: "other",
        password: "synthetic",
        captcha: "ABCD",
        challengeVersion: renewal.challenge.version,
        consentVersion: policy.version,
      }).promise,
    ).rejects.toMatchObject({ code: "CAMPUS_BINDING_CONFLICT" });
    expect((await api.status().promise).validUntil).toBe(valid.validUntil);
    expect((await api.profile().promise).profile.accountNumber).toBe(
      "00123456",
    );
    f.transport(async () => {
      throw new Error("不应提交学校密码");
    });
    const ended = await api.cancel(renewal.id).promise;
    expect(ended.status).toBe("failed");
    expect(methods).toContain("DELETE");
    expect(f.counts.post).toBe(2);
  });
});
