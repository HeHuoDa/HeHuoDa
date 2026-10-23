import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { after, test } from "node:test";
import { effectScope, nextTick } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { createPinia, setActivePinia } from "pinia";
import { detail } from "./fixtures/competition-detail.mjs";

const lifecycleUrl = `data:text/javascript,${encodeURIComponent(`
  export const hooks = { load: [], ready: [], show: [], hide: [], unload: [] };
  export const onLoad = fn => hooks.load.push(fn);
  export const onReady = fn => hooks.ready.push(fn);
  export const onShow = fn => hooks.show.push(fn);
  export const onHide = fn => hooks.hide.push(fn);
  export const onUnload = fn => hooks.unload.push(fn);
`)}`;
const { hooks } = await import(lifecycleUrl);
const apiUrl = new URL("../src/api/competition-client.ts", import.meta.url)
  .href;
const httpUrl = new URL("../src/api/http.ts", import.meta.url).href;
// 仅替换平台配置和 transport，仍执行真实契约校验、请求控制器和页面生命周期。
const apiModule = `data:text/javascript,${encodeURIComponent(`
  import {createCompetitionApi} from ${JSON.stringify(apiUrl)};
  import {createHttpClient} from ${JSON.stringify(httpUrl)};
  export const competitionApi = createCompetitionApi(createHttpClient(
    options => globalThis.uni.request(options), () => ({baseUrl:'/api/v1',timeout:5000})));
`)}`;
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
      return { url: apiModule, shortCircuit: true };
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());
const pageUrl = new URL("../src/pages/home/competition.vue", import.meta.url);
const { descriptor } = parse(readFileSync(pageUrl, "utf8"));
const compiled = compileScript(descriptor, { id: "competition-page" });
const source = stripTypeScriptTypes(compiled.content).replace(
  /from\s+(["'])([^"']+)\1/g,
  (_, q, s) => {
    const target = s.startsWith(".")
      ? new URL(extname(s) ? s : `${s}.ts`, pageUrl).href
      : s === "@dcloudio/uni-app"
        ? s
        : import.meta.resolve(s);
    return `from ${q}${target}${q}`;
  },
);
const Page = (
  await import(`data:text/javascript,${encodeURIComponent(source)}`)
).default;
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await nextTick();
};

test("实际页面等待 onReady 和详情渲染后定位；定位失败仍保留详情，隐藏时取消请求", async () => {
  const original = globalThis.uni;
  const requests = [],
    scrolls = [];
  globalThis.uni = {
    request(options) {
      requests.push(options);
      return { abort() {} };
    },
    pageScrollTo(options) {
      scrolls.push(options);
    },
  };
  Object.values(hooks).forEach((list) => {
    list.length = 0;
  });
  const scope = effectScope();
  setActivePinia(createPinia());
  const page = scope.run(() => Page.setup({}, { expose() {} }));
  try {
    hooks.load.forEach((fn) => fn({ id: "competition-a", stage: "stage-a" }));
    hooks.show.forEach((fn) => fn());
    requests[0].success({ statusCode: 200, data: detail() });
    await flush();
    assert.equal(scrolls.length, 0);
    hooks.ready.forEach((fn) => fn());
    await flush();
    assert.equal(scrolls[0].selector, "#competition-stage-0");
    scrolls[0].fail();
    assert.match(page.stageFeedback.value, /无法自动定位/);
    assert.equal(page.competition.value.id, "competition-a");
    hooks.hide.forEach((fn) => fn());
    hooks.load.forEach((fn) => fn({ id: "competition-b", stage: "removed" }));
    hooks.show.forEach((fn) => fn());
    assert.equal(page.competition.value, null);
    requests[1].success({ statusCode: 200, data: detail("competition-b") });
    await flush();
    assert.match(page.stageFeedback.value, /指定赛段不存在/);
    assert.equal(scrolls.length, 1);
    hooks.hide.forEach((fn) => fn());
    hooks.load.forEach((fn) => fn({ id: "competition-c" }));
    hooks.show.forEach((fn) => fn());
    hooks.hide.forEach((fn) => fn());
    requests[2].success({ statusCode: 200, data: detail("competition-c") });
    await flush();
    assert.equal(page.competition.value, null);
    hooks.show.forEach((fn) => fn());
    requests[3].success({ statusCode: 200, data: detail("competition-c") });
    await flush();
    assert.equal(page.competition.value.id, "competition-c");
  } finally {
    hooks.unload.forEach((fn) => fn());
    scope.stop();
    globalThis.uni = original;
  }
});
