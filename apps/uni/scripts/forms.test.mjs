import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { deadlineInstant } from "@hehuoda/client-domain/team";
import { readFileSync, readdirSync } from "node:fs";
import { preprocess } from "./component-host.mjs";

test("App-Plus 可达源码排除 H5 DOM 适配器，公共组件无浏览器弹层与滚动锁", () => {
  const root = new URL("../src/", import.meta.url);
  for (const file of readdirSync(root, { recursive: true })) {
    const normalized = file.replaceAll("\\", "/");
    if (
      !/\.(vue|ts)$/.test(file) ||
      normalized.includes("/.local/") ||
      normalized.startsWith(".local/")
    )
      continue;
    const source = readFileSync(new URL(normalized, root), "utf8");
    if (normalized.endsWith(".h5.vue") || normalized === "forms/dialog-h5.ts")
      continue;
    const app = preprocess(source, "APP-PLUS")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(
      app,
      /(?:NativePicker\.h5|NativeTextControl\.h5|dialog-h5)/,
      normalized,
    );
    assert.doesNotMatch(
      app,
      /\b(?:document|window)\s*\.|HTMLDialogElement|\.showModal\(|querySelector|body\.style/,
      normalized,
    );
  }
});

test("生产源码不再包含小程序条件编译分支", () => {
  const root = new URL("../src/", import.meta.url);
  for (const file of readdirSync(root, { recursive: true })) {
    const normalized = file.replaceAll("\\", "/");
    if (!/\.(vue|ts|css)$/.test(file)) continue;
    const source = readFileSync(new URL(normalized, root), "utf8");
    assert.doesNotMatch(
      source,
      /#(?:ifdef|ifndef)\s+MP-WEIXIN/,
      `${normalized} 不应再有微信条件编译分支`,
    );
  }
});

test("App-Plus 输入组件渲染 uni 原生输入控件并传递密码原值", async () => {
  const values = [];
  const app = await mount(
    "../src/components/FormInput.vue",
    {
      id: "password",
      label: "密码",
      modelValue: "  pass  ",
      secret: true,
      error: "请输入密码",
      "onUpdate:modelValue": (value) => values.push(value),
    },
    "APP-PLUS",
  );
  const input = () => app.find((node) => node.type === "input");
  assert.equal(input().props.password, true);
  input().props.onInput({ detail: { value: "  secret  " } });
  assert.deepEqual(values, ["  secret  "]);
  assert.equal(input().props["aria-describedby"], "password-error");
  app.find((node) => node.props.role === "button").props.onClick();
  await nextTick();
  assert.equal(input().props.password, false);
  assert.deepEqual(values, ["  secret  "]);
  app.render({
    id: "password",
    label: "密码",
    modelValue: "",
    secret: true,
    disabled: true,
    "onUpdate:modelValue": (value) => values.push(value),
  });
  await nextTick();
  input().props.onInput({ detail: { value: "blocked" } });
  assert.equal(values.length, 1);
  app.unmount();
});

test("H5 输入组件传递密码原值，显隐不提交，禁用及错误关联有效", async () => {
  const values = [];
  const app = await mount(
    "../src/components/FormInput.vue",
    {
      id: "password",
      label: "密码",
      modelValue: "  pass  ",
      secret: true,
      error: "请输入密码",
      "onUpdate:modelValue": (value) => values.push(value),
    },
    "H5",
  );
  const input = () => app.find((node) => node.type === "input");
  // H5 适配器把 secret 映射为原生 type=password，不靠平台属性。
  assert.equal(input().props.type, "password");
  assert.equal(input().props.value, "  pass  ");
  input().props.onInput({ target: { value: "  secret  " } });
  await nextTick();
  assert.deepEqual(values, ["  secret  "]);
  assert.equal(input().props["aria-describedby"], "password-error");
  app.find((node) => node.props.role === "button").props.onClick();
  await nextTick();
  assert.equal(input().props.type, "text");
  assert.deepEqual(values, ["  secret  "]);
  app.unmount();
});

test("表单组件 WXSS 不依赖属性选择器，禁用与加载态由类名表达", async () => {
  const source = readFileSync(
    new URL("../src/components/FormButton.vue", import.meta.url),
    "utf8",
  );
  const style = source.match(/<style scoped>([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(style, /\[[^\]]+\]/);
  let clicks = 0;
  const page = await mount(
    "../src/components/FormButton.vue",
    {
      variant: "reveal",
      onClick: () => clicks++,
    },
    "APP-PLUS",
  );
  const button = () => page.find((node) => node.props.role === "button");
  try {
    button().props.onClick();
    assert.equal(clicks, 1);
    for (const state of [{ disabled: true }, { loading: true }]) {
      page.render({ ...state, variant: "reveal", onClick: () => clicks++ });
      await nextTick();
      assert.equal(button().props["aria-disabled"], true);
      assert.match(button().props.class, /is-disabled|is-loading/);
      button().props.onClick();
      assert.equal(clicks, 1);
    }
  } finally {
    page.unmount();
  }
});

test("H5 按钮 Enter/Space 与点击可操作，加载/禁用不触发", async () => {
  let count = 0;
  const app = await mount(
    "../src/components/FormButton.vue",
    { onClick: () => count++ },
    "H5",
  );
  const button = () => app.find((node) => node.props.role === "button");
  assert.equal(button().props.tabindex, 0);
  button().props.onKeydown({ key: "Enter", preventDefault() {} });
  button().props.onKeydown({ key: " ", preventDefault() {} });
  button().props.onKeydown({ key: "Enter", repeat: true, preventDefault() {} });
  assert.equal(count, 2);
  app.render({ loading: true, onClick: () => count++ });
  await nextTick();
  button().props.onClick();
  assert.equal(count, 2);
  assert.equal(button().props.tabindex, -1);
  app.unmount();
});

test("H5 选择器的空值业务选项不会被占位选项遮挡", async () => {
  const app = await mount(
    "../src/forms/NativePicker.h5.vue",
    {
      mode: "selector",
      modelValue: "",
      options: [
        { value: "", label: "全部状态" },
        { value: "open", label: "报名时段内" },
      ],
    },
    "H5",
  );
  const select = app.find((node) => node.type === "select");
  const emptyOptions = select.children.filter(
    (node) => node.type === "option" && node.props.value === "",
  );
  assert.equal(emptyOptions.length, 1);
  assert.equal(emptyOptions[0].props.disabled, undefined);
  app.unmount();
});

test("App-Plus 选择器按稳定值返回，取消/禁用不改变值", async () => {
  const values = [];
  let cancels = 0;
  const props = {
    id: "campus",
    label: "校区",
    modelValue: "ya",
    options: [
      { value: "ya", label: "雅安校区" },
      { value: "cd", label: "成都校区" },
    ],
    "onUpdate:modelValue": (value) => values.push(value),
    onCancel: () => cancels++,
  };
  const app = await mount(
    "../src/components/FormPicker.vue",
    props,
    "APP-PLUS",
  );
  const picker = () => app.find((node) => node.type === "picker");
  picker().props.onCancel();
  assert.equal(cancels, 1);
  assert.deepEqual(values, []);
  picker().props.onChange({ detail: { value: 1 } });
  assert.deepEqual(values, ["cd"]);
  app.render({ ...props, disabled: true });
  await nextTick();
  picker().props.onChange({ detail: { value: 0 } });
  assert.deepEqual(values, ["cd"]);
  app.unmount();
});

test("日期与时间分开输入，按北京时间跨 UTC 日期边界组合并拒绝非法日期", async () => {
  let value = "2026-10-19T00:30";
  const props = () => ({
    id: "deadline",
    label: "截止时间",
    modelValue: value,
    "onUpdate:modelValue": (next) => {
      value = next;
    },
  });
  const app = await mount(
    "../src/components/FormDateTime.vue",
    props(),
    "APP-PLUS",
  );
  app
    .find((node) => node.type === "picker" && node.props.mode === "date")
    .props.onChange({ detail: { value: "2026-10-20" } });
  assert.equal(value, "2026-10-20T00:30");
  assert.equal(
    new Date(deadlineInstant(value)).toISOString(),
    "2026-10-19T16:30:00.000Z",
  );
  app.render(props());
  await nextTick();
  app
    .find((node) => node.type === "picker" && node.props.mode === "time")
    .props.onChange({ detail: { value: "08:45" } });
  assert.equal(value, "2026-10-20T08:45");
  assert.ok(Number.isNaN(deadlineInstant("2026-02-30T08:45")));
  app.unmount();
});

test("H5 弹层用视口高度、固定滚动区及显式取消，卸载后解除监听", async () => {
  // H5 适配器直接操作 DOM；宿主替身下 document 不存在，适配器应安全降级为空实现。
  let cancels = 0;
  const app = await mount(
    "../src/components/FormDialog.vue",
    {
      id: "edit",
      open: true,
      title: "编辑资料",
      onCancel: () => cancels++,
    },
    "H5",
  );
  const dialog = () => app.find((node) => node.props.role === "dialog");
  assert.ok(dialog());
  assert.equal(dialog().props["aria-modal"], "true");
  assert.equal(
    app.find((node) => node.type === "scroll-view").props["scroll-y"],
    "",
  );
  app
    .find(
      (node) => node.props.role === "button" && textOf(node).includes("取消"),
    )
    .props.onClick();
  assert.equal(cancels, 1);
  app.unmount();
});

test("App-Plus 弹层用当前窗口高度并响应窗口变化，隐藏后解除监听且忽略迟到事件", async () => {
  let resize;
  let removedResize;
  let windowHeight = 700;
  globalThis.__formPageHooks = [];
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight }),
    onWindowResize: (callback) => (resize = callback),
    offWindowResize: (callback) => (removedResize = callback),
  };
  const app = await mount(
    "../src/components/FormDialog.vue",
    { id: "resize", open: true, title: "编辑资料" },
    "APP-PLUS",
  );
  const height = () =>
    app.find((node) => node.props.role === "dialog").props.style.height;
  try {
    assert.equal(height(), "700px");
    windowHeight = 450;
    assert.equal(typeof resize, "function");
    resize({ size: { windowWidth: 700, windowHeight } });
    await nextTick();
    assert.equal(height(), "450px");
    globalThis.__formPageHooks[0]();
    assert.equal(removedResize, resize);
    windowHeight = 900;
    resize({ size: { windowHeight: 900 } });
    await nextTick();
    assert.equal(height(), "450px");
  } finally {
    app.unmount();
    delete globalThis.uni;
    delete globalThis.__formPageHooks;
  }
});

test("App-Plus 弹层关闭重开不重复绑定，旧回调不能改写新窗口", async () => {
  const windows = new Set();
  let windowHeight = 700;
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight }),
    onWindowResize: (callback) => windows.add(callback),
    offWindowResize: (callback) => windows.delete(callback),
  };
  const props = { id: "reopen", open: true, title: "申请加入" };
  const app = await mount(
    "../src/components/FormDialog.vue",
    props,
    "APP-PLUS",
  );
  try {
    const oldResize = [...windows][0];
    app.render({ ...props, open: false });
    await nextTick();
    assert.equal(windows.size, 0);
    assert.equal(
      app.find((node) => node.props.role === "dialog"),
      undefined,
    );
    windowHeight = 480;
    app.render(props);
    await nextTick();
    await nextTick();
    assert.equal(windows.size, 1);
    oldResize({ size: { windowHeight: 900 } });
    await nextTick();
    assert.equal(
      app.find((node) => node.props.role === "dialog").props.style.height,
      "480px",
    );
  } finally {
    app.unmount();
    delete globalThis.uni;
  }
});

test("完整 App-Plus 表单 fixture：取消复原、错误不写回、保存防重及页面隐藏丢弃", async () => {
  globalThis.__formPageHooks = [];
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 671 }),
    onWindowResize() {},
    offWindowResize() {},
  };
  const app = await mount("./fixtures/FormFixture.vue", {}, "APP-PLUS");
  const button = (label) =>
    app.find(
      (node) =>
        (node.type === "button" || node.props.role === "button") &&
        textOf(node).trim() === label,
    );
  const input = () =>
    app.find(
      (node) => node.type === "input" && node.props.id === "fixture-nickname",
    );
  const tick = async () => {
    await nextTick();
    await nextTick();
  };
  try {
    button("编辑表单").props.onClick();
    await tick();
    input().props.onInput({ detail: { value: "未保存" } });
    await tick();
    button("取消并关闭").props.onClick();
    await tick();
    button("编辑表单").props.onClick();
    await tick();
    assert.equal(input().props.value, "禾小苗");
    input().props.onInput({ detail: { value: " " } });
    await tick();
    button("保存").props.onClick();
    await tick();
    assert.ok(app.find((node) => node.props.id === "fixture-nickname-error"));
    assert.equal(input().props.focus, true);
    assert.match(textOf(app.container), /保存次数：0/);
    input().props.onInput({ detail: { value: "新昵称" } });
    await tick();
    const save = button("保存");
    save.props.onClick();
    save.props.onClick();
    await tick();
    assert.match(textOf(app.container), /已保存昵称：新昵称；保存次数：1/);
    assert.equal(
      app.find((node) => node.props.role === "dialog"),
      undefined,
    );
    button("编辑表单").props.onClick();
    await tick();
    input().props.onInput({ detail: { value: "返回丢弃" } });
    for (const callback of globalThis.__formPageHooks) callback();
    await tick();
    button("编辑表单").props.onClick();
    await tick();
    assert.equal(input().props.value, "新昵称");
  } finally {
    app.unmount();
    delete globalThis.uni;
    delete globalThis.__formPageHooks;
  }
});
