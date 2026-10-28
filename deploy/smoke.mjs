import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { colleges } from "../packages/client-domain/src/colleges.ts";

const temporary = mkdtempSync(join(tmpdir(), "hehuoda-image-smoke-"));
const project = `hehuoda-smoke-${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
Object.assign(process.env, {
  COMPOSE_PROJECT_NAME: project,
  POSTGRES_USER: "smoke",
  POSTGRES_DB: "hehuoda_smoke_test",
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://smoke:${password}@db:5432/hehuoda_smoke_test`,
  HTTP_BIND: "127.0.0.1",
  HTTP_PORT: "0",
  INGESTION_ENABLED: "false",
  DEPLOY_TLS: "false",
  DEPLOY_PUBLIC_URL: "",
  IMAGE_PREFIX: process.env.IMAGE_PREFIX || "hehuoda-local",
  IMAGE_TAG: process.env.IMAGE_TAG || "0".repeat(40),
  DEPLOY_ENV_FILE: join(temporary, ".env"),
  DEPLOY_BACKUP_DIR: join(temporary, "backups"),
  DEPLOY_STATE_DIR:
    process.env.DEPLOY_STATE_DIR || join(import.meta.dirname, "state", project),
});
writeFileSync(process.env.DEPLOY_ENV_FILE, "# isolated smoke configuration\n", {
  mode: 0o600,
});
const { compose, docker, waitFor } = await import("./runtime.mjs");
const { validateDeploymentConfig, verifyApplication, verifyPublicApplication } =
  await import("./runtime.mjs");
const { release, configurationHash } = await import("./release.mjs");
const { backup, verifyBackup } = await import("./backup.mjs");
let base;
const imageAliases = [];
try {
  if (!process.argv.includes("--no-build")) compose(["build", "api", "web"]);
  compose(["up", "-d", "--wait", "--wait-timeout", "120", "db"]);
  compose(["up", "-d", "--no-deps", "api"]);
  waitFor(() => {
    compose([
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.status===503?0:1)).catch(()=>process.exit(1))",
    ]);
    return true;
  });
  for (let count = 0; count < 2; count++)
    compose([
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "dist-openapi/scripts/migrate.js",
    ]);
  compose(["up", "-d", "--wait", "--wait-timeout", "180", "api", "web"]);
  // Exercise the deployed package rather than workspace source or host dist.
  compose([
    "exec",
    "-T",
    "api",
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { parseCandidate, sourceById } from '@hehuoda/sicau-connectors/notices';
    import { SchoolAuthClient, SchoolAuthError } from '@hehuoda/sicau-connectors/auth';
    assert.ok(import.meta.resolve('@hehuoda/sicau-connectors/notices').endsWith('/dist/notices/index.js'));
    assert.ok(import.meta.resolve('@hehuoda/sicau-connectors/auth').endsWith('/dist/auth/index.js'));
    const auth = new SchoolAuthClient();
    auth.dispose();
    await assert.rejects(auth.createChallenge(), error => error instanceof SchoolAuthError && error.code === 'disposed');
    const paragraph = '报名截止：2026年10月20日。';
    const candidate = parseCandidate({
      title: '2026年测试竞赛报名通知', publishedAt: null,
      text: paragraph, paragraphs: [paragraph], attachments: [],
    }, sourceById('information-engineering').listUrl, []);
    assert.deepEqual(candidate.fields.deadline, {precision: 'date', value: '2026-10-20'});
    assert.equal(sourceById('life-sciences').version, '1');
  `,
  ]);
  // Run the real packaged parser even though scheduled ingestion is disabled in
  // this isolated stack. The image must provide a fail-closed Landlock ABI 3
  // sandbox; a plain Node subprocess is not sufficient for this contract.
  compose([
    "exec",
    "-T",
    "api",
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { deflateRawSync } from 'node:zlib';
    import { readFileSync, rmSync, writeFileSync } from 'node:fs';
    import { randomUUID } from 'node:crypto';
    import { parseAttachmentIsolated } from './dist/ingestion/attachment-parser.js';

    const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    function zip(files) {
      const locals = [], centrals = [];
      let offset = 0;
      for (const [name, value] of Object.entries(files)) {
        const filename = Buffer.from(name), content = Buffer.from(value);
        const compressed = deflateRawSync(content);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(filename.length, 26);
        locals.push(local, filename, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(filename.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, filename);
        offset += local.length + filename.length + compressed.length;
      }
      const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(Object.keys(files).length, 8);
      end.writeUInt16LE(Object.keys(files).length, 10);
      end.writeUInt32LE(directory.length, 12);
      end.writeUInt32LE(offset, 16);
      return Buffer.concat([...locals, directory, end]);
    }
    function chinesePdf() {
      const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <6BD4> <02> <8D5B> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
      const stream = 'BT /F1 12 Tf 10 100 Td <0102> Tj ET';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
        '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream',
        '<< /Length ' + cmap.length + ' >>\\nstream\\n' + cmap + '\\nendstream',
      ];
      let pdf = '%PDF-1.4\\n';
      const offsets = [0];
      for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf, 'latin1'));
        pdf += (index + 1) + ' 0 obj\\n' + object + '\\nendobj\\n';
      }
      const xref = Buffer.byteLength(pdf, 'latin1');
      pdf += 'xref\\n0 7\\n0000000000 65535 f \\n' + offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n ').join('\\n') + '\\ntrailer\\n<< /Size 7 /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF';
      return Buffer.from(pdf, 'latin1');
    }
    async function parse(bytes, mediaType, options) {
      try { return await parseAttachmentIsolated(bytes, mediaType, options); }
      catch (error) {
        if (error?.code === 'sandbox-unavailable')
          throw new Error('API 镜像附件隔离器不可用：smoke 要求 Linux Landlock ABI 3；生产解析必须 fail closed', { cause: error });
        throw error;
      }
    }

    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>比赛章程与报名规则</w:t></w:r></w:p></w:body></w:document>',
    });
    const pdfBytes = chinesePdf();
    const docxResult = await parse(docx, docxType);
    const pdfResult = await parse(pdfBytes, 'application/pdf');
    assert.deepEqual(docxResult.segments, [{ kind: 'paragraph', index: 1, text: '比赛章程与报名规则' }]);
    assert.deepEqual(pdfResult.segments, [{ kind: 'page', index: 1, text: '比赛' }]);
    console.log('isolated-Chinese-DOCX-ok');
    console.log('isolated-Chinese-PDF-ok');

    const timeoutProbe = '/app/dist/ingestion/attachment-smoke-timeout-' + randomUUID() + '.mjs';
    writeFileSync(timeoutProbe, 'for await (const _chunk of process.stdin) {}\\nawait new Promise(resolve => setTimeout(resolve, 60000));\\n', { flag: 'wx' });
    try {
      await assert.rejects(
        parseAttachmentIsolated(docx, docxType, { timeoutMs: 1000, workerPath: timeoutProbe }),
        error => error?.code === 'parse-timeout',
      );
      console.log('timeout-killed-ok');
    } finally { rmSync(timeoutProbe, { force: true }); }
    // A second real parse proves timeout termination did not poison later work.
    assert.deepEqual((await parse(docx, docxType)).segments, docxResult.segments);
    console.log('post-timeout-parse-ok');

    const accessProbe = '/app/dist/ingestion/attachment-smoke-access-' + randomUUID() + '.mjs';
    const probeLines = [
      "import { readFileSync } from 'node:fs';",
      "import { connect } from 'node:net';",
      "let rawInput = ''; for await (const chunk of process.stdin) rawInput += chunk; const input = JSON.parse(rawInput);",
      "const ipcOnlyBytesAndType = Object.keys(input).sort().join(',') === 'bytes,mediaType';",
      "const inheritedCredential = Object.keys(process.env).some(name => /SECRET|PASSWORD|TOKEN|COOKIE|DATABASE_URL|API_KEY|ACCESS_KEY/i.test(name));",
      "let fileResult = 'allowed'; try { readFileSync('/app/package.json'); } catch (error) { fileResult = error.code || 'denied'; }",
      "const networkResult = await new Promise(resolve => { let socket, timer, settled = false; const finish = value => { if (settled) return; settled = true; if (timer) clearTimeout(timer); socket?.destroy(); resolve(value); }; try { socket = connect({ host: '8.8.8.8', port: 443 }); } catch (error) { finish(error.code || 'error'); } if (!settled) { timer = setTimeout(() => finish('timeout'), 2000); socket.once('connect', () => finish('connected')); socket.once('error', error => finish(error.code || 'error')); } });",
      "process.stdout.write(JSON.stringify({ mediaType: 'application/pdf', extractorVersion: 'smoke', status: 'extracted', segments: [{ kind: 'paragraph', index: 1, text: 'ipc=' + ipcOnlyBytesAndType + ';file=' + fileResult + ';network=' + networkResult + ';credentials=' + inheritedCredential }] }));",
    ];
    writeFileSync(accessProbe, probeLines.join('\\n'), { flag: 'wx' });
    try {
      const access = await parse(pdfBytes, 'application/pdf', { workerPath: accessProbe });
      const accessResult = access.segments[0]?.text || '';
      assert.match(accessResult, /ipc=true;file=(ERR_ACCESS_DENIED|EACCES|EPERM);network=EPERM;credentials=false/);
      console.log('external-access-denied:' + accessResult);
    } finally { rmSync(accessProbe, { force: true }); }
    console.log('PASS: packaged Chinese PDF/DOCX extraction, timeout termination/recovery, and filesystem/network isolation (Landlock ABI 3)');
    `,
  ]);
  const fixture = JSON.parse(
    readFileSync(new URL("./test/fixture.json", import.meta.url), "utf8"),
  );
  fixture.colleges = colleges.map((college, order) => ({ ...college, order }));
  compose(
    [
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      `
    import { Pool } from 'pg';
    import { importBatch, validateInput } from './dist/competitions/import.js';
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const pool = new Pool({connectionString: process.env.DATABASE_URL});
    try { await importBatch(pool, validateInput(JSON.parse(input)), {production:true, confirmPublished:true}); }
    finally { await pool.end(); }
  `,
    ],
    undefined,
    { input: JSON.stringify(fixture), stdio: ["pipe", "pipe", "pipe"] },
  );
  base = `http://${compose(["port", "web", "80"]).trim()}`;

  async function json(path, status = 200) {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, path);
    assert.match(
      response.headers.get("content-type") || "",
      /application\/json/,
      path,
    );
    return response.json();
  }
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("cache-control") || "", /no-store/);
  const html = await home.text();
  assert.match(html, /<html/i);
  const assets = [
    ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),
  ].map((match) => match[1]);
  assert.ok(assets.length > 0, "H5 must reference built assets");
  for (const asset of assets) {
    const response = await fetch(new URL(asset, base));
    assert.equal(response.status, 200, asset);
    assert.match(
      response.headers.get("cache-control") || "",
      /immutable/,
      asset,
    );
  }
  for (const path of [
    "/assets/absent.js",
    "/static/absent.svg",
    "/absent.js",
    "/docs",
    "/docs-json",
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  for (const path of [
    "/home/competitions/smoke-competition/?id=other&%69d=third&stage=a&stage=b",
    "/my/teams/?section=applications&%73ection=other",
    "/teams/new/?next=%2Fhome",
    "/teams/team-1/?id=other",
    "/unknown-page",
  ]) {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("location"), null, path);
    assert.equal(await response.text(), html, path);
  }
  assert.equal((await json("/api/v1/health/ready")).status, "ready");
  assert.equal((await json("/api/v1/health")).status, "ok");
  assert.ok((await json("/api/v1/colleges")).some((c) => c.id === "law"));
  assert.equal((await json("/api/v1/competitions")).totalCompetitions, 1);
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  for (const path of ["/api/v1/absent", "/api/v1/absent.js"])
    await json(path, 404);

  const dump = backup();
  assert.deepEqual(verifyBackup(dump), {
    migrations: readdirSync(
      new URL("../apps/api/migrations/", import.meta.url),
    ).filter((name) => name.endsWith(".sql")).length,
    colleges: colleges.length,
    competitions: 1,
    ingestionRuns: 0,
  });
  console.log(
    "PASS: H5, assets, cache, deep links, JSON routing, real queries and isolated backup restore",
  );

  // Exercise actual replacement and failure recovery against the isolated stack.
  // The only test seam replaces registry pulls with local image existence checks.
  const originalTag = process.env.IMAGE_TAG;
  const successTag = randomBytes(20).toString("hex");
  const failedTag = randomBytes(20).toString("hex");
  const prefix = process.env.IMAGE_PREFIX;
  for (const [service, tag] of [
    ["api", successTag],
    ["web", successTag],
    ["api", failedTag],
  ]) {
    const image = `${prefix}/${service}:${tag}`;
    docker(["tag", `${prefix}/${service}:${originalTag}`, image]);
    imageAliases.push(image);
  }
  const failedImage = `${prefix}/web:${failedTag}`;
  docker(["build", "-t", failedImage, "-"], {
    input: `FROM ${prefix}/web:${originalTag}\nRUN printf 'invalid_directive;\\n' > /etc/nginx/conf.d/default.conf\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  imageAliases.push(failedImage);
  const releaseState = join(temporary, "release-state");
  mkdirSync(releaseState);
  writeFileSync(
    join(releaseState, "current.json"),
    JSON.stringify({
      sha: originalTag,
      releaseDirectory: resolve(import.meta.dirname, ".."),
      configurationHash: configurationHash(
        JSON.parse(compose(["config", "--format", "json"], originalTag)),
      ),
    }),
  );
  const localOperations = {
    // The smoke seam uses locally built tags instead of a registry manifest.
    releaseContext(_tag, record) {
      return (
        record || {
          releaseDirectory: resolve(import.meta.dirname, ".."),
          tls: false,
          publicUrl: "",
        }
      );
    },
    compose(args, tag, options) {
      if (args[0] === "pull") {
        for (const service of ["api", "web"])
          docker(["image", "inspect", `${prefix}/${service}:${tag}`]);
        return "";
      }
      const adjusted = [...args];
      if (tag === failedTag && adjusted.includes("--wait-timeout"))
        adjusted[adjusted.indexOf("--wait-timeout") + 1] = "15";
      return compose(adjusted, tag, options);
    },
    docker,
    backup,
    validateDeploymentConfig,
    verifyApplication,
    verifyPublicApplication,
  };
  await release(successTag, localOperations, releaseState);
  assert.equal(
    JSON.parse(readFileSync(join(releaseState, "current.json"), "utf8")).sha,
    successTag,
  );
  await assert.rejects(release(failedTag, localOperations, releaseState));
  assert.equal(
    JSON.parse(readFileSync(join(releaseState, "current.json"), "utf8")).sha,
    successTag,
  );
  process.env.IMAGE_TAG = successTag;
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  console.log(
    "PASS: actual isolated release, failed candidate recovery and preserved business data",
  );

  compose(["stop", "db"]);
  assert.deepEqual(
    Object.keys(await json("/api/v1/health/ready", 503)).sort(),
    ["requestId", "status"],
  );
  assert.equal((await json("/api/v1/health")).status, "ok");
  compose(["up", "-d", "--wait", "--wait-timeout", "120", "db"]);
  waitFor(() => {
    compose([
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    ]);
    return true;
  });
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );

  const api = compose(["ps", "-q", "api"]);
  const before = Number(
    docker(["inspect", "--format", "{{.RestartCount}}", api]),
  );
  // Kill node, not an intentional docker stop, to exercise the runtime restart policy.
  try {
    compose(
      ["exec", "-T", "-u", "root", "api", "sh", "-c", "kill -9 $(pidof node)"],
      undefined,
    );
  } catch {
    /* Exec may lose its connection when the process exits; RestartCount below must increase. */
  }
  waitFor(
    () =>
      Number(docker(["inspect", "--format", "{{.RestartCount}}", api])) >
      before,
  );
  compose(["up", "-d", "--wait", "--wait-timeout", "180", "api"]);
  // Nginx upstream may still refer to a replaced API IP; a release always recreates web too.
  compose(["up", "-d", "--force-recreate", "--no-deps", "--wait", "web"]);
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal((await json("/api/v1/health/ready")).status, "ready");
  compose(["down"]);
  compose(["up", "-d", "--wait", "--wait-timeout", "180"]);
  base = `http://${compose(["port", "web", "80"]).trim()}`;
  assert.equal(
    (await json("/api/v1/competitions/smoke-competition")).id,
    "smoke-competition",
  );
  console.log(
    "PASS: database outage/recovery, process crash restart and persistent data after stack rebuild",
  );
} catch (error) {
  console.error(error);
  // Raw container logs may contain request data; only runtime's safe reports are exported.
  process.exitCode = 1;
} finally {
  // project is generated here, never supplied by the caller; cleanup affects only this test stack.
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } catch {
    console.error(
      `Cleanup failed for isolated project ${project}; inspect it manually`,
    );
    process.exitCode = 1;
  }
  for (const alias of imageAliases) {
    try {
      docker(["image", "rm", alias]);
    } catch {
      console.error(`Could not remove temporary image alias ${alias}`);
      process.exitCode = 1;
    }
  }
  rmSync(temporary, { recursive: true, force: true });
}
