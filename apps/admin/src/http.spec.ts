import { afterEach, expect, it, vi } from "vitest";
import { createAdminHttp } from "./http";

afterEach(() => vi.unstubAllGlobals());
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
    .mockResolvedValueOnce(Response.json({ csrfToken: "session-csrf" }))
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
