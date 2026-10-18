import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRenderer, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import ts from "typescript";
import { appIcons, resolveIcon } from "../src/components/app-icons.ts";
import { colleges } from "../src/data/colleges.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const pages = JSON.parse(read("src/pages.json"));

test("业务名称覆盖固定来源，未知/原型名称提供可见回退", () => {
  const names = [
    "home",
    "users",
    "team",
    "leaf",
    "book",
    "shield",
    "pencil",
    "mail",
    "star",
    "bell",
    "user",
  ];
  assert.deepEqual(Object.keys(appIcons), names);
  assert.equal(new Set(Object.values(appIcons)).size, 11);
  for (const name of names) assert.notEqual(resolveIcon(name), "?");
  for (const name of ["unknown", "", "constructor", "__proto__", "toString"])
    assert.equal(resolveIcon(name), "?");
  const css = read("src/styles/base.css");
  const font = css.match(/data:font\/ttf;base64,([\w+/=]+)/)?.[1];
  assert.ok(font, "字体必须内嵌以免依赖网络字体服务");
  assert.equal(Buffer.from(font, "base64").readUInt32BE(0), 0x00010000);
});

test("底栏的普通/选中图标离线可用，PNG 尺寸与静态预算受控", () => {
  for (const tab of pages.tabBar.list) {
    for (const key of ["iconPath", "selectedIconPath"]) {
      assert.match(tab[key], /^static\/icons\/[a-z]+-(muted|brand)\.png$/);
      const png = readFileSync(resolve(root, "src", tab[key]));
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 96);
      assert.equal(png.readUInt32BE(20), 96);
      assert.ok(png.length < 4096);
    }
  }
});

test("学院稳定 ID 和缺徽学院均保留，25 张 PNG 等比且无 Web 运行时导入", () => {
  assert.equal(colleges.length, 27);
  assert.equal(new Set(colleges.map((c) => c.id)).size, 27);
  assert.equal(colleges.filter((c) => c.emblem).length, 25);
  assert.deepEqual(
    colleges.filter((c) => !c.emblem).map((c) => c.id),
    ["agricultural-engineering", "civil-engineering"],
  );
  for (const college of colleges.filter((c) => c.emblem)) {
    assert.match(college.emblem, /^\/static\/colleges\/[a-z-]+\.png$/);
    const png = readFileSync(resolve(root, "src", college.emblem.slice(1)));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.readUInt32BE(16) <= 128);
    assert.ok(png.readUInt32BE(20) <= 128);
  }
  const files = (dir) =>
    readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(
      (entry) => {
        const path = `${dir}/${entry.name}`;
        return entry.isDirectory() ? files(path) : [path];
      },
    );
  assert.ok(
    files("src/static").reduce(
      (bytes, p) => bytes + statSync(resolve(root, p)).size,
      0,
    ) < 350_000,
  );
  for (const file of files("src").filter((p) => /\.(vue|ts)$/.test(p))) {
    assert.doesNotMatch(
      read(file),
      /(?:from|import\s*\()\s*["'][^"']*(?:apps\/web|@lucide\/vue)/,
    );
  }
});

// 用 Vue 自定义宿主执行真实 SFC setup/template，不需要模拟 uni 全局 API。
// 锁住图片错误和 props 更新的生命周期行为，而非仅检查模板字符串。
async function component(file) {
  const { descriptor } = parse(read(file));
  const compiled = compileScript(descriptor, {
    id: "asset-test",
    inlineTemplate: true,
    templateOptions: { compilerOptions: { isCustomElement: () => true } },
  });
  const js = ts
    .transpileModule(compiled.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(
      /from ["']vue["']/g,
      `from ${JSON.stringify(import.meta.resolve("vue"))}`,
    );
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
    )
  ).default;
}

function host() {
  const create = (type, text = "") => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
  });
  const renderer = createRenderer({
    createElement: create,
    createText: (text) => create("#text", text),
    createComment: (text) => create("#comment", text),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    patchProp: (node, key, prev, value) => {
      node.props[key] = value;
    },
    insert: (node, parent, anchor = null) => {
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(
        index < 0 ? parent.children.length : index,
        0,
        node,
      );
    },
    remove: (node) => {
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[node.parent.children.indexOf(node) + 1],
  });
  return { renderer, container: create("root") };
}

test("坏路径显示文字、更换 src 后重试，空资源不发图片请求", async () => {
  const { h } = await import("vue");
  const ResourceImage = await component("src/components/ResourceImage.vue");
  const { renderer, container } = host();
  const render = (props) => renderer.render(h(ResourceImage, props), container);
  render({ src: "/broken.png", label: "农学院院徽", fallback: "农学院" });
  const root = container.children[0];
  let image = root.children.find((node) => node.type === "image");
  assert.equal(image.props.mode, "aspectFit");
  image.props.onError();
  await nextTick();
  assert.equal(
    root.children.some((node) => node.type === "image"),
    false,
  );
  assert.equal(
    root.children.find((node) => node.type === "text").text,
    "农学院",
  );
  render({ src: "/valid.png", label: "农学院院徽", fallback: "农学院" });
  await nextTick();
  image = root.children.find((node) => node.type === "image");
  assert.equal(image.props.src, "/valid.png");
  render({ src: null, label: "未知学院", fallback: "未知学院" });
  await nextTick();
  assert.equal(
    root.children.some((node) => node.type === "image"),
    false,
  );
  assert.equal(root.props["aria-label"], "未知学院");
  renderer.render(null, container);
});

test("加载视觉有独立语义，装饰模式避免重复朗读", async () => {
  const { h } = await import("vue");
  const Loading = await component("src/components/LoadingIndicator.vue");
  const { renderer, container } = host();
  renderer.render(h(Loading, { label: "正在加载" }), container);
  assert.equal(container.children[0].props.role, "status");
  assert.equal(container.children[0].props["aria-label"], "正在加载");
  renderer.render(h(Loading), container);
  assert.equal(container.children[0].props["aria-hidden"], true);
  renderer.render(null, container);
});
