// 用与资源测试相同的 Vue 自定义宿主执行真实 SFC，不模拟组件内部逻辑。
import { readFileSync } from "node:fs";
import { createRenderer, nextTick, h } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import ts from "typescript";

export function preprocess(source, platform) {
  const stack = [true];
  return source
    .split("\n")
    .filter((line) => {
      const match = line.match(
        /(?:\/\/|<!--)\s*#(ifdef|ifndef|endif)\s*([\w-]*)/,
      );
      if (!match) return stack.at(-1);
      if (match[1] === "endif") stack.pop();
      else
        stack.push(
          stack.at(-1) &&
            (match[1] === "ifdef"
              ? match[2] === platform
              : match[2] !== platform),
        );
      return false;
    })
    .join("\n");
}
const modules = new Map();
export async function component(file, platform = "MP-WEIXIN") {
  const url = file instanceof URL ? file : new URL(file, import.meta.url);
  const key = `${url.href}:${platform}`;
  if (modules.has(key)) return modules.get(key);
  const source = preprocess(readFileSync(url, "utf8"), platform);
  const isCustomElement = (tag) =>
    [
      "view",
      "text",
      "label",
      "input",
      "textarea",
      "button",
      "picker",
      "switch",
      "scroll-view",
    ].includes(tag);
  const { descriptor } = parse(source, {
    filename: url.pathname,
    templateParseOptions: { isCustomElement },
  });
  const compiled = compileScript(descriptor, {
    id: key,
    inlineTemplate: true,
    templateOptions: {
      compilerOptions: {
        isCustomElement: (tag) =>
          [
            "view",
            "text",
            "label",
            "input",
            "textarea",
            "button",
            "picker",
            "switch",
            "scroll-view",
          ].includes(tag),
      },
    },
  });
  let js = ts.transpileModule(compiled.content, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const imports = [...js.matchAll(/from ["']([^"']+)["']/g)];
  for (const match of imports) {
    const name = match[1];
    let target;
    if (name.endsWith(".vue"))
      target = await component(new URL(name, url), platform);
    else if (name === "@dcloudio/uni-app") {
      target = `data:text/javascript,${encodeURIComponent("export const onPageHide = (fn) => globalThis.__formPageHooks?.push(fn); export const onUnload = (fn) => globalThis.__formPageHooks?.push(fn);")}`;
    } else
      target = name.startsWith(".")
        ? new URL(/\.[a-z]+$/.test(name) ? name : `${name}.ts`, url).href
        : import.meta.resolve(name);
    js = js.replace(match[0], `from ${JSON.stringify(target)}`);
  }
  const target = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
  modules.set(key, target);
  return target;
}

export async function mount(file, props = {}, platform = "MP-WEIXIN") {
  const Component = (await import(await component(file, platform))).default;
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
    patchProp: (node, key, previous, value) => {
      node.props[key] = value;
    },
    insert(node, parent, anchor) {
      if (node.parent) {
        const index = node.parent.children.indexOf(node);
        if (index >= 0) node.parent.children.splice(index, 1);
      }
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(
        index < 0 ? parent.children.length : index,
        0,
        node,
      );
    },
    remove(node) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[node.parent.children.indexOf(node) + 1],
  });
  const container = create("root");
  const render = (nextProps) =>
    renderer.render(h(Component, nextProps), container);
  render(props);
  await nextTick();
  function find(predicate) {
    function walk(node) {
      if (predicate(node)) return node;
      for (const child of node.children) {
        const result = walk(child);
        if (result) return result;
      }
    }
    return walk(container);
  }
  return {
    render,
    find,
    container,
    unmount: () => renderer.render(null, container),
  };
}

export function textOf(node) {
  return node.text + node.children.map(textOf).join("");
}
