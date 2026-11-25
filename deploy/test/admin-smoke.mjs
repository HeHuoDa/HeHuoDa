import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

export async function verifyAdminRoutes(base, h5Html) {
  const get = (path) =>
    fetch(new URL(path, base), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  const redirect = await get("/admin?from=smoke");
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/admin/?from=smoke");

  let adminHtml;
  for (const path of [
    "/admin/",
    "/admin/index.html",
    "/admin/login",
    "/admin/competitions/new?from=smoke",
    "/admin/unknown-page",
  ]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(
      response.headers.get("content-type") || "",
      /text\/html/,
      path,
    );
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    const body = await response.text();
    adminHtml ??= body;
    assert.equal(body, adminHtml, path);
  }
  assert.notEqual(adminHtml, h5Html);
  const assets = [
    ...adminHtml.matchAll(/(?:src|href)=["']([^"']+\.(js|css))["']/g),
  ];
  for (const extension of ["js", "css"]) {
    assert.ok(
      assets.some(([, , type]) => type === extension),
      extension,
    );
  }
  for (const [, asset, extension] of assets) {
    assert.match(asset, /^\/admin\/assets\//);
    const response = await get(asset);
    assert.equal(response.status, 200, asset);
    assert.match(
      response.headers.get("content-type") || "",
      extension === "js" ? /javascript/ : /text\/css/,
      asset,
    );
    assert.match(
      response.headers.get("cache-control") || "",
      /immutable/,
      asset,
    );
    assert.ok((await response.arrayBuffer()).byteLength > 0, asset);
  }
  for (const path of [
    "/admin/assets/absent-AbCd1234.js",
    "/admin/assets/absent",
    "/admin/absent.css",
    "/admin/.env",
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.notEqual(await response.text(), adminHtml, path);
  }
}

export function createSmokeAdmin(compose) {
  const credentials = {
    username: `image-smoke-${randomBytes(8).toString("hex")}`,
    password: randomBytes(24).toString("base64url"),
  };
  const id = compose(
    [
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import { Pool } from 'pg';
      import { createAdminAccount } from './dist/admin/admin.service.js';
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const { username, password } = JSON.parse(input);
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createAdminAccount(client, username, '隔离镜像管理员', password);
        const audit = await client.query(
          "SELECT 1 FROM admin_operations WHERE action='account.create' AND object_id=$1 AND result='success'",
          [id],
        );
        assert.equal(audit.rowCount, 1);
        await client.query('COMMIT');
        console.log(id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
      `,
    ],
    undefined,
    { input: JSON.stringify(credentials), stdio: ["pipe", "pipe", "pipe"] },
  );
  assert.match(id, /^[a-f0-9-]{36}$/i);
  return { credentials, id };
}

export async function verifyAdminCompetition(base, origin, compose, fixture) {
  const { credentials, id: adminId } = createSmokeAdmin(compose);
  const id = `admin-smoke-${randomBytes(8).toString("hex")}`;
  const open = "/api/v1/competitions";
  const admin = "/api/v1/admin";
  const target = `${admin}/competitions/${id}`;
  async function request(path, status, { body, headers } = {}) {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, path);
    if (status === 204) return { headers: response.headers };
    assert.match(
      response.headers.get("content-type") || "",
      /application\/json/,
      path,
    );
    return { data: await response.json(), headers: response.headers };
  }

  await request(`${admin}/auth/session`, 401);
  const login = await request(`${admin}/auth/login`, 200, {
    body: credentials,
    headers: { origin },
  });
  const setCookie = login.headers.get("set-cookie") || "";
  assert.ok(/^hh_admin_session=[^;]+;/.test(setCookie), "admin session cookie");
  for (const attribute of [
    /;\s*HttpOnly(?:;|$)/i,
    /;\s*Secure(?:;|$)/i,
    /;\s*SameSite=Lax(?:;|$)/i,
    /;\s*Path=\/api\/v1\/admin(?:;|$)/i,
  ]) {
    assert.ok(attribute.test(setCookie), String(attribute));
  }
  // HTTP smoke validates the server contract with an explicitly forwarded Secure cookie.
  const cookie = setCookie.split(";")[0];
  const session = await request(`${admin}/auth/session`, 200, {
    headers: { cookie },
  });
  assert.equal(session.data.id, adminId);
  const csrf = await request(`${admin}/auth/csrf`, 200, {
    headers: { cookie },
  });
  assert.equal(csrf.data.adminId, adminId);
  assert.ok(csrf.data.csrfToken);
  const headers = { cookie, origin, "x-csrf-token": csrf.data.csrfToken };

  const baseline = await request(`${admin}/competitions/baseline/${id}`, 200, {
    headers: { cookie },
  });
  assert.equal(baseline.data.exists, false);
  const patch = structuredClone(fixture.competitions[0]);
  delete patch.publication;
  patch.id = id;
  patch.name = "隔离镜像管理端新建比赛";
  patch.notices[0].id = `${id}-notice`;
  patch.notices[0].publishedAt = "2026-01-01";
  patch.notices[0].checkedAt = "2026-01-01";
  patch.tracks[0].id = `${id}-track`;
  patch.stages[0].id = `${id}-stage`;
  patch.stages[0].sourceIds = [patch.notices[0].id];
  const reason = "同源管理端镜像冒烟";
  const save = {
    action: "save",
    operationId: randomUUID(),
    reason,
    baseline: baseline.data.baseline,
    patch,
  };
  for (const rejected of [
    { cookie, "x-csrf-token": csrf.data.csrfToken },
    { ...headers, origin: "https://other.invalid" },
    { cookie, origin },
  ]) {
    await request(`${target}/commands`, 403, { body: save, headers: rejected });
  }
  const preview = await request(`${target}/preview`, 200, {
    body: { ...save, operationId: randomUUID() },
    headers,
  });
  assert.equal(preview.data.publication, "draft");

  async function visibility(visible) {
    const { data: list } = await request(open, 200);
    assert.equal(
      list.items.some(({ competition }) => competition.id === id),
      visible,
    );
    const { data: detail } = await request(
      `${open}/${id}`,
      visible ? 200 : 404,
    );
    if (visible) assert.equal(detail.id, id);
  }

  await visibility(false);
  let currentBaseline = save.baseline;
  for (const [action, publication] of [
    ["save", "draft"],
    ["publish", "published"],
    ["hide", "hidden"],
  ]) {
    const { data } = await request(`${target}/commands`, 200, {
      body:
        action === "save"
          ? { ...save, previewId: preview.data.previewId }
          : {
              action,
              operationId: randomUUID(),
              reason,
              baseline: currentBaseline,
            },
      headers,
    });
    assert.equal(data.publication, publication);
    assert.equal(data.targetId, id);
    await visibility(publication === "published");
    currentBaseline = data.baseline;
  }
  await request(`${admin}/auth/logout`, 204, { body: {}, headers });
  await request(`${admin}/auth/session`, 401, { headers: { cookie } });
}
