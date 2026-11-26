import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptsDir, "..");

/**
 * 用临时目录包一层真实脚本：DCloud CLI 换成会打印 argv/env 并写产物的桩，
 * 这样能在不启动真实编译的前提下观测 App 入口的实际参数、输出目录与失败行为。
 * `vite` 用目录链接指向真实依赖；fixture 必须放在 node_modules 之外，
 * 否则 Node 拒绝为 node_modules 下的 .ts 文件剥离类型。
 */
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "hhd-app-entry-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src", "api"), { recursive: true });
  const stubDir = join(dir, "node_modules", "@dcloudio", "vite-plugin-uni");
  mkdirSync(join(stubDir, "bin"), { recursive: true });
  symlinkSync(
    join(appRoot, "node_modules", "vite"),
    join(dir, "node_modules", "vite"),
    "junction",
  );
  for (const name of ["run-uni.mjs", "run-config.mjs", "platform-config.mjs"]) {
    copyFileSync(join(scriptsDir, name), join(dir, "scripts", name));
  }
  copyFileSync(
    join(appRoot, "manifest.template.json"),
    join(dir, "manifest.template.json"),
  );
  copyFileSync(
    join(appRoot, "src", "api", "config.ts"),
    join(dir, "src", "api", "config.ts"),
  );
  writeFileSync(
    join(stubDir, "package.json"),
    JSON.stringify({ name: "@dcloudio/vite-plugin-uni", version: "0.0.0" }),
  );
  writeFileSync(
    join(stubDir, "bin", "uni.js"),
    [
      "const outDir = process.env.UNI_OUTPUT_DIR;",
      'console.log("STUB_ARGV:" + JSON.stringify(process.argv.slice(2)));',
      'console.log("STUB_OUT:" + outDir);',
      'console.log("STUB_IN:" + process.env.UNI_INPUT_DIR);',
      'console.log("STUB_TIMEOUT:" + process.env.VITE_API_TIMEOUT_MS);',
      'if (process.env.STUB_FAIL === "1") process.exit(1);',
      'require("node:fs").mkdirSync(outDir, { recursive: true });',
      'require("node:fs").writeFileSync(require("node:path").join(outDir, "app-service.js"), "ok");',
      "",
    ].join("\n"),
  );
  return dir;
};

const run = (dir, { command = "build", args = [], env = {} } = {}) => {
  const base = { ...process.env };
  for (const key of [
    "VITE_API_BASE_URL",
    "VITE_API_TIMEOUT_MS",
    "UNI_OUTPUT_DIR",
    "UNI_INPUT_DIR",
    "UNI_SUBPACKAGE",
    "UNI_SUBPACKGE",
    "UNI_MP_PLUGIN",
    "STUB_FAIL",
    "UNI_RELEASE",
    "UNI_ANDROID_PACKAGE_NAME",
  ]) {
    delete base[key];
  }
  const result = spawnSync(
    process.execPath,
    [join(dir, "scripts", "run-uni.mjs"), command, "app", ...args],
    { cwd: dir, env: { ...base, ...env }, encoding: "utf8" },
  );
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const markPreviousBuild = (dir) => {
  const outDir = join(dir, "dist", "build", "app");
  mkdirSync(outDir, { recursive: true });
  const marker = join(outDir, "previous-build-marker.txt");
  writeFileSync(marker, "上一次成功构建");
  return { outDir, marker };
};

const fixtures = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});
const makeFixture = () => {
  const dir = fixture();
  fixtures.push(dir);
  return dir;
};

test("App 构建：平台与 mode 由脚本固定，产物目录与成功日志同源", () => {
  const dir = makeFixture();
  const result = run(dir, {
    env: { VITE_API_BASE_URL: "https://api.example.test/api/v1" },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /STUB_ARGV:\["build","-p","app","-m","production"\]/,
  );
  const expectedOut = join(dir, "dist", "build", "app");
  assert.equal(
    result.stdout.includes(`STUB_OUT:${expectedOut}`),
    true,
    result.stdout,
  );
  assert.equal(result.stdout.includes(`STUB_IN:${join(dir, "src")}`), true);
  assert.match(result.stdout, /STUB_TIMEOUT:5000/);
  assert.equal(existsSync(join(expectedOut, "app-service.js")), true);
  // 成功时才打印产物目录，且与真实产物目录一致。
  assert.equal(String(result.stdout).includes(`输出目录 ${expectedOut}`), true);

  const dev = run(dir, {
    command: "dev",
    env: { VITE_API_BASE_URL: "https://api.example.test/api/v1" },
  });
  assert.equal(dev.code, 0, dev.stderr);
  assert.match(dev.stdout, /STUB_ARGV:\["-p","app","-m","development"\]/);
  assert.equal(
    dev.stdout.includes(`STUB_OUT:${join(dir, "dist", "dev", "app")}`),
    true,
  );
});

test("App 入口拒绝额外参数与输入/输出目录覆盖，且不动旧产物", () => {
  const dir = makeFixture();
  const { marker } = markPreviousBuild(dir);
  const env = { VITE_API_BASE_URL: "https://api.example.test/api/v1" };
  for (const args of [
    ["--outDir", "dist/elsewhere"],
    ["-p", "h5"],
    ["-m", "staging"],
  ]) {
    const result = run(dir, { args, env });
    assert.notEqual(result.code, 0, args.join(" "));
    assert.match(result.stderr, /不接受额外 CLI 参数/);
    assert.doesNotMatch(result.stdout, /STUB_ARGV/);
    assert.doesNotMatch(result.stdout, /输出目录/);
    assert.equal(existsSync(marker), true, args.join(" "));
  }
  for (const key of ["UNI_OUTPUT_DIR", "UNI_INPUT_DIR"]) {
    const result = run(dir, { env: { ...env, [key]: join(dir, "elsewhere") } });
    assert.notEqual(result.code, 0, key);
    assert.match(result.stderr, /不接受.*覆盖/);
    assert.equal(existsSync(marker), true, key);
  }
});

test("缺配置或非法 .env 超时：命令非零、旧产物保留、不打印成功信息", () => {
  const dir = makeFixture();
  const { marker } = markPreviousBuild(dir);

  const missing = run(dir);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /VITE_API_BASE_URL/);
  assert.doesNotMatch(missing.stdout, /STUB_ARGV|输出目录/);
  assert.equal(existsSync(marker), true);

  writeFileSync(
    join(dir, ".env"),
    "VITE_API_BASE_URL=https://api.example.test/api/v1\nVITE_API_TIMEOUT_MS=abc\n",
  );
  const badTimeout = run(dir);
  assert.notEqual(badTimeout.code, 0);
  assert.match(badTimeout.stderr, /VITE_API_TIMEOUT_MS/);
  assert.doesNotMatch(badTimeout.stdout, /STUB_ARGV|输出目录/);
  assert.equal(existsSync(marker), true);
});

test("合法 HTTPS 与 .env 超时通过预检，子进程拿到归一化配置", () => {
  const dir = makeFixture();
  writeFileSync(
    join(dir, ".env"),
    "VITE_API_BASE_URL=https://API.Example.TEST/api/v1/\nVITE_API_TIMEOUT_MS= 8000 \n",
  );
  const result = run(dir);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /API 基址 https:\/\/api\.example\.test\/api\/v1；超时 8000ms/,
  );
  assert.match(result.stdout, /STUB_TIMEOUT:8000/);
  // 进程 env 优先于 .env：显式传入的地址会覆盖文件值。
  const overridden = run(dir, {
    env: { VITE_API_BASE_URL: "https://override.example.test/api/v2" },
  });
  assert.equal(overridden.code, 0, overridden.stderr);
  assert.match(
    overridden.stdout,
    /API 基址 https:\/\/override\.example\.test\/api\/v2/,
  );
});

test("子进程失败时不打印成功产物信息", () => {
  const dir = makeFixture();
  const result = run(dir, {
    env: {
      VITE_API_BASE_URL: "https://api.example.test/api/v1",
      STUB_FAIL: "1",
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /STUB_ARGV/);
  assert.doesNotMatch(result.stdout, /输出目录/);
});

test("生成的 src/manifest.json 写入实际注入的包名", () => {
  const dir = makeFixture();
  const result = run(dir, {
    env: {
      VITE_API_BASE_URL: "https://api.example.test/api/v1",
      UNI_RELEASE: "true",
      UNI_ANDROID_PACKAGE_NAME: "cn.edu.sicau.hehuoda",
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(dir, "src", "manifest.json"), "utf8"),
  );
  assert.equal(
    manifest["app-plus"].distribute.android.packagename,
    "cn.edu.sicau.hehuoda",
  );
  assert.equal(manifest.appid, "");
});
