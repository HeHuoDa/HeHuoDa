import { afterEach, expect, it, vi } from "vitest";
import { createAdminHttp } from "./http";

afterEach(() => vi.unstubAllGlobals());
it("响应来自另一个管理员时清理旧身份，不接收该响应的数据", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: "admin-a", displayName: "A", expiresAt: "2099" }),
      )
      .mockResolvedValueOnce(
        Response.json({ adminId: "admin-a", csrfToken: "csrf-a" }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { modules: [] },
          { headers: { "X-Admin-Id": "admin-b" } },
        ),
      ),
  );
  const http = createAdminHttp();
  await http.restore();
  await expect(http.request("/dashboard")).rejects.toMatchObject({
    status: 401,
  });
  expect(http.state.session).toBeNull();
});
it("跨标签切换账号后不把另一管理员的CSRF与旧会话配对", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: "admin-a", displayName: "A", expiresAt: "2099" }),
      )
      .mockResolvedValueOnce(
        Response.json({ adminId: "admin-b", csrfToken: "csrf-b" }),
      ),
  );
  const http = createAdminHttp();
  await expect(http.restore()).rejects.toMatchObject({ status: 409 });
  expect(http.state.session).toBeNull();
});
it("未确认受理存在时阻止退出，保留恢复资料", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ id: "admin-a", displayName: "A", expiresAt: "2099" }),
    )
    .mockResolvedValueOnce(
      Response.json({ adminId: "admin-a", csrfToken: "csrf" }),
    );
  vi.stubGlobal("fetch", fetcher);
  const http = createAdminHttp();
  await http.restore();
  sessionStorage.setItem(
    "hh-admin-ingestion",
    JSON.stringify({ actor: "admin-a", body: { operationId: "pending" } }),
  );
  await expect(http.logout()).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(sessionStorage.getItem("hh-admin-ingestion")).not.toBeNull();
  sessionStorage.removeItem("hh-admin-ingestion");
});
it("退出请求等待期间不允许开始新的业务写入", async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: "admin-a", displayName: "A", expiresAt: "2099" }),
      )
      .mockResolvedValueOnce(
        Response.json({ adminId: "admin-a", csrfToken: "csrf" }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      ),
  );
  const http = createAdminHttp();
  await http.restore();
  const logout = http.logout();
  await expect(
    http.request("/ingestion/scans", { method: "POST", body: {} }),
  ).rejects.toMatchObject({ status: 409 });
  finish(new Response(null, { status: 204 }));
  await logout;
});
it("退出网络失败后，重试会恢复CSRF再撤销服务端会话", async () => {
  const session = {
    id: "admin-a",
    displayName: "维护者",
    expiresAt: "2099-01-01",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(
      Response.json({ adminId: "admin-a", csrfToken: "csrf-a" }),
    )
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(
      Response.json({ adminId: "admin-a", csrfToken: "csrf-a" }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const http = createAdminHttp();
  await http.restore();
  await expect(http.logout()).rejects.toThrow("network");
  await http.logout();
  expect(fetcher.mock.calls.at(-1)?.[1].headers).toMatchObject({
    "X-CSRF-Token": "csrf-a",
  });
  expect(http.state.session).toBeNull();
});
it("先恢复 Cookie 会话，写请求使用该会话 CSRF，凭证不持久化", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: "admin-a",
        displayName: "维护者",
        expiresAt: "2099-01-01",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ adminId: "admin-a", csrfToken: "session-csrf" }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const http = createAdminHttp();
  await http.restore();
  await http.request("/ingestion/scans", {
    method: "POST",
    body: { operationId: "command" },
  });
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    "/api/v1/admin/auth/session",
    "/api/v1/admin/auth/csrf",
    "/api/v1/admin/ingestion/scans",
  ]);
  expect(fetcher.mock.calls[2]![1]).toMatchObject({
    credentials: "include",
    cache: "no-store",
    headers: { "X-CSRF-Token": "session-csrf" },
  });
});
it("会话清理后拒绝迟到响应，旧请求的401不能清除新身份", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        finish = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const http = createAdminHttp();
  const pending = http.request("/dashboard");
  http.clear();
  finish(Response.json({ modules: [] }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(http.state.session).toBeNull();
});
