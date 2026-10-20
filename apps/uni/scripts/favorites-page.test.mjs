import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { compileScript, parse } from "vue/compiler-sfc";
import { detail } from "./fixtures/competition-detail.mjs";
import { useSessionStore } from "../src/stores/session.ts";

const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { show: [], hide: [], unload: [] };
  export const onShow = fn => hooks.show.push(fn);
  export const onHide = fn => hooks.hide.push(fn);
  export const onUnload = fn => hooks.unload.push(fn);
`)}`;
const requests = [];
const apiUrl = `data:text/javascript,export const competitionApi = { detail: id => globalThis.__favoritePageRequest(id) };`;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@dcloudio/uni-app")
      return { url: lifecycleUrl, shortCircuit: true };
    if (specifier.endsWith(".vue"))
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    if (specifier.endsWith("/api/competitions.ts"))
      return { url: apiUrl, shortCircuit: true };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());
const { hooks } = await import(lifecycleUrl);
const pageUrl = new URL("../src/pages/my/favorites.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "favorites-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, quote, specifier) => {
    const target = specifier.startsWith(".")
      ? new URL(extname(specifier) ? specifier : `${specifier}.ts`, pageUrl)
          .href
      : specifier === "@dcloudio/uni-app"
        ? specifier
        : import.meta.resolve(specifier);
    return `from ${quote}${target}${quote}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;

test("真实收藏页跟随会话增删、隐藏返回与统一重置，卸载后不再发请求", async () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const original = globalThis.__favoritePageRequest;
  globalThis.__favoritePageRequest = (id) => {
    let resolve;
    const promise = new Promise((yes) => {
      resolve = yes;
    });
    const request = { id, resolve, cancelled: false };
    requests.push(request);
    return {
      promise,
      cancel() {
        request.cancelled = true;
      },
    };
  };
  const scope = effectScope();
  try {
    const page = scope.run(() => Page.setup({}, { expose() {} }));
    hooks.show.forEach((fn) => fn());
    assert.equal(requests.length, 0);
    session.addFavorite("a");
    assert.equal(requests.length, 1);
    requests[0].resolve(detail("a"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.state.rows[0].detail.name, "校园创新比赛");
    session.addFavorite("b");
    assert.deepEqual(
      page.state.rows.map((row) => row.id),
      ["b", "a"],
    );
    page.remove("b");
    assert.equal(session.favoriteCount, 1);
    assert.equal(requests[1].cancelled, true);
    hooks.hide.forEach((fn) => fn());
    session.addFavorite("c");
    assert.equal(requests.length, 2);
    hooks.show.forEach((fn) => fn());
    assert.equal(requests.length, 4);
    session.reset();
    assert.equal(requests[2].cancelled, true);
    assert.equal(requests[3].cancelled, true);
    assert.deepEqual(page.state.rows, []);
    requests[2].resolve(detail("c"));
    await nextTick();
    assert.deepEqual(page.state.rows, []);
    hooks.unload.forEach((fn) => fn());
    scope.stop();
    session.addFavorite("after-unload");
    assert.equal(requests.length, 4);
  } finally {
    scope.stop();
    if (original === undefined) delete globalThis.__favoritePageRequest;
    else globalThis.__favoritePageRequest = original;
  }
});
