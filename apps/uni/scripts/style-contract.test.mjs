import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
/** 去掉注释，避免说明文字命中断言 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const entry = read("src/app.css");
const themeSource = read("src/styles/theme.css");
const baseSource = read("src/styles/base.css");
const theme = code(themeSource);
const base = code(baseSource);
const app = read("src/App.vue");
const pages = JSON.parse(read("src/pages.json"));
const pkg = JSON.parse(read("package.json"));
const viteConfig = read("vite.config.ts");

function listFiles(dir, extension) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) return listFiles(path, extension);
      return item.name.endsWith(extension) ? [path] : [];
    },
  );
}

function collect(pattern, source) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function check(condition, message) {
  assert.ok(condition, message);
}

test("样式入口唯一，页面不另建平行主题", () => {
  check(/import "\.\/app\.css";/.test(app), "App.vue 应只导入 src/app.css");
  assert.deepEqual(listFiles("src", ".css").sort(), [
    "src/app.css",
    "src/styles/base.css",
    "src/styles/theme.css",
  ]);
  check(
    /@import "tailwindcss" source\(none\);/.test(entry),
    "入口应关闭自动内容探测",
  );
  check(
    /@import "\.\/styles\/theme\.css";/.test(entry) &&
      /@import "\.\/styles\/base\.css";/.test(entry),
    "入口应导入主题与基础样式",
  );
  check(/@source "\.\/\*\*\/\*\.vue";/.test(entry), "入口应声明 Vue 内容源");
});

test("主题色与圆角全部映射为语义工具类", () => {
  const colorTokens = collect(/--hhr-color-([a-z-]+):/g, theme);
  const radiusTokens = collect(/--hhr-radius-([a-z-]+):/g, theme);
  check(colorTokens.length >= 15, "品牌色数量不应减少");
  assert.deepEqual(radiusTokens.sort(), ["badge", "card", "control", "panel"]);

  for (const token of colorTokens) {
    check(
      theme.includes(`--color-${token}: var(--hhr-color-${token});`),
      `缺少 --color-${token} 映射`,
    );
  }
  for (const token of radiusTokens) {
    check(
      theme.includes(`--radius-${token}: var(--hhr-radius-${token});`),
      `缺少 --radius-${token} 映射`,
    );
  }
});

test("字号刻度与断点固定 px，不随视口缩放", () => {
  const sizes = [...theme.matchAll(/--text-([a-z-]+):\s*([^;]+);/g)].filter(
    ([, name]) => !name.endsWith("--line-height"),
  );
  assert.deepEqual(sizes.map(([, name]) => name).sort(), [
    "body",
    "body-lg",
    "caption",
    "display",
    "eyebrow",
    "label",
    "title",
    "title-sm",
  ]);
  for (const [, name, value] of sizes) {
    check(/^\d+px$/.test(value.trim()), `--text-${name} 必须写 px`);
  }

  const breakpoints = collect(/--breakpoint-[a-z]+:\s*([^;]+);/g, theme);
  check(breakpoints.length >= 1, "应显式声明断点");
  for (const value of breakpoints) {
    check(/^\d+px$/.test(value.trim()), "断点必须写 px");
  }
});

test("基础样式不依赖 body、不写 rpx、不重复生成工具类", () => {
  check(!/(^|\n)\s*body\s*\{/.test(base), "不应直接给 body 写样式");
  check(!/@apply\b/.test(base), "组件类用普通 CSS，避免 @apply 跨端差异");
  check(!/\brpx\b/.test(base), "源码不写 rpx，由构建换算");
  check(/(^|\n)page\s*\{/.test(base), "页面根节点样式写在 page 上");

  const button = base.slice(base.indexOf(".hhr-button {"));
  check(/min-height: 44px;/.test(button), "主要操作保持 44px 触控下限");
  check(
    /\.hhr-input \{[\s\S]*?min-height: 44px;/.test(base),
    "输入框保持 44px 触控下限",
  );
});

test("禁用态使用 [disabled] 属性选择器覆盖框架默认样式", () => {
  check(!/:disabled/.test(base), "uni-button 不匹配 :disabled");
  for (const variant of ["", "--secondary", "--soft", "--danger"]) {
    const selector = `.hhr-button.hhr-button${variant}[disabled]`;
    check(base.includes(selector), `缺少 ${variant || "primary"} 禁用态覆盖`);
  }
});

test("只注册一个 Tailwind 生成器，并指向纯 CSS 入口", () => {
  for (const dependency of ["@tailwindcss/vite", "@tailwindcss/postcss"]) {
    check(
      (pkg.dependencies?.[dependency] ?? pkg.devDependencies?.[dependency]) ===
        undefined,
      `${dependency} 会与 weapp-tailwindcss 重复生成`,
    );
  }
  check(
    viteConfig.match(/WeappTailwindcss\(/g)?.length === 1,
    "只注册一次 weapp-tailwindcss",
  );
  check(!/tailwindcss\(\)/.test(viteConfig), "不应再注册 Tailwind Vite 插件");

  const entries = collect(/cssEntries:\s*\[([^\]]+)\]/g, viteConfig);
  assert.equal(entries.length, 1);
  check(
    /resolve\(__dirname, "src\/app\.css"\)/.test(entries[0]),
    "cssEntries 应指向 src/app.css 的绝对路径",
  );
});

test("窗口静态色与主题一致，页面均有标题", () => {
  const pageColor = theme.match(/--hhr-color-page:\s*(#[0-9a-f]{6});/)?.[1];
  check(Boolean(pageColor), "主题必须声明页面背景色");
  assert.equal(pages.globalStyle.backgroundColor, pageColor);
  assert.equal(pages.globalStyle.navigationBarBackgroundColor, pageColor);
  for (const page of pages.pages) {
    check(Boolean(page.style?.navigationBarTitleText), `${page.path} 缺少标题`);
  }
});

test("页面只消费语义工具类，不硬编码品牌色", () => {
  const palette = collect(/--hhr-color-[a-z-]+:\s*(#[0-9a-f]{6});/g, theme);
  const rawUtilities =
    /\b(?:bg|text|border)-(?:green|stone|slate|gray)-\d{2,3}\b/;
  for (const file of listFiles("src", ".vue")) {
    const source = read(file).toLowerCase();
    for (const color of palette) {
      check(
        !source.includes(color.toLowerCase()),
        `${file} 不应硬编码主题色 ${color}`,
      );
    }
    check(!rawUtilities.test(source), `${file} 应使用语义色工具类`);
  }
});
