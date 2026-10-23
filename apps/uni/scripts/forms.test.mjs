import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { deadlineInstant } from "@hehuoda/client-domain/team";
import { readFileSync, readdirSync } from "node:fs";
import { preprocess } from "./component-host.mjs";

test("小程序可达源码排除 H5 DOM 适配器，公共组件无浏览器弹层与滚动锁", () => {
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
    const weixin = preprocess(source, "MP-WEIXIN")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(
      weixin,
      /(?:NativePicker\.h5|NativeTextControl\.h5|dialog-h5)/,
      normalized,
    );
    assert.doesNotMatch(
      weixin,
      /\b(?:document|window)\s*\.|HTMLDialogElement|\.showModal\(|querySelector|body\.style/,
      normalized,
    );
  }
});

test("输入组件传递密码原值，显隐不提交，禁用及错误关联有效", async () => {
  const values = [];
  const app = await mount("../src/components/FormInput.vue", {
    id: "password",
    label: "密码",
    modelValue: "  pass  ",
    secret: true,
    error: "请输入密码",
    "onUpdate:modelValue": (value) => values.push(value),
  });
  const input = () => app.find((node) => node.type === "input");
  assert.equal(input().props.password, true);
  input().props.onInput({ detail: { value: "  secret  " } });
  assert.deepEqual(values, ["  secret  "]);
  assert.equal(input().props["aria-describedby"], "password-error");
  app.find((node) => node.type === "button").props.onClick();
  await nextTick();
  assert.equal(input().props.password, false);
  assert.deepEqual(values, ["  secret  "]);
  app.render({
    id: "password",
    label: "密码",
    modelValue: "",
    disabled: true,
    "onUpdate:modelValue": (value) => values.push(value),
  });
  await nextTick();
  input().props.onInput({ detail: { value: "blocked" } });
  assert.equal(values.length, 1);
  app.unmount();
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

test("微信选择器按稳定值返回，取消/禁用不改变值", async () => {
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
  const app = await mount("../src/components/FormPicker.vue", props);
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
  const app = await mount("../src/components/FormDateTime.vue", props());
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

test("微信弹层使用键盘高度、固定滚动区及显式取消，卸载恢复平台资源", async () => {
  let listener;
  let removed;
  let hides = 0;
  let shows = 0;
  let cancels = 0;
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 671 }),
    onKeyboardHeightChange: (callback) => {
      listener = callback;
    },
    offKeyboardHeightChange: (callback) => {
      removed = callback;
    },
    onWindowResize() {},
    offWindowResize() {},
    hideTabBar: () => hides++,
    showTabBar: () => shows++,
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  try {
    const app = await mount("../src/components/FormDialog.vue", {
      id: "edit",
      open: true,
      title: "编辑资料",
      onCancel: () => cancels++,
    });
    assert.equal(hides, 1);
    listener({ height: 300 });
    await nextTick();
    assert.equal(
      app.find((node) => node.props.role === "dialog").props.style.height,
      "371px",
    );
    assert.equal(
      app.find((node) => node.type === "scroll-view").props["scroll-y"],
      "",
    );
    app
      .find((node) => node.type === "button" && textOf(node).includes("取消"))
      .props.onClick();
    assert.equal(cancels, 1);
    app.unmount();
    assert.equal(removed, listener);
    assert.equal(shows, 1);
  } finally {
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("微信弹层在旋转及键盘收起后使用当前窗口，隐藏后移除监听且忽略迟到事件", async () => {
  let keyboard;
  let resize;
  let windowHeight = 700;
  let bottom = 34;
  let removedKeyboard;
  let removedResize;
  let shows = 0;
  globalThis.__formPageHooks = [];
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight, safeAreaInsets: { bottom } }),
    onKeyboardHeightChange: (callback) => (keyboard = callback),
    offKeyboardHeightChange: (callback) => (removedKeyboard = callback),
    onWindowResize: (callback) => (resize = callback),
    offWindowResize: (callback) => (removedResize = callback),
    hideTabBar() {},
    showTabBar: () => shows++,
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  const app = await mount("../src/components/FormDialog.vue", {
    id: "resize",
    open: true,
    title: "编辑资料",
  });
  const height = () =>
    app.find((node) => node.props.role === "dialog").props.style.height;
  try {
    assert.equal(
      app.find((node) => node.props.role === "dialog").props.style[
        "--hhr-dialog-safe-bottom"
      ],
      "34px",
    );
    keyboard({ height: 200 });
    await nextTick();
    assert.equal(height(), "500px");
    assert.equal(
      app.find((node) => node.props.role === "dialog").props.style[
        "--hhr-dialog-safe-bottom"
      ],
      "0px",
    );
    windowHeight = 450;
    bottom = 21;
    assert.equal(typeof resize, "function");
    resize({ size: { windowWidth: 700, windowHeight } });
    await nextTick();
    assert.equal(height(), "250px");
    keyboard({ height: 0 });
    await nextTick();
    assert.equal(height(), "450px");
    assert.equal(
      app.find((node) => node.props.role === "dialog").props.style[
        "--hhr-dialog-safe-bottom"
      ],
      "21px",
    );
    keyboard({ height: 600 });
    await nextTick();
    assert.equal(height(), "0px");
    keyboard({ height: 0 });
    await nextTick();
    globalThis.__formPageHooks[0]();
    assert.equal(removedKeyboard, keyboard);
    assert.equal(removedResize, resize);
    assert.equal(shows, 1);
    keyboard({ height: 300 });
    resize({ size: { windowHeight: 900 } });
    await nextTick();
    assert.equal(height(), "450px");
    app.unmount();
    assert.equal(shows, 1);
  } finally {
    app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
    delete globalThis.__formPageHooks;
  }
});

test("完整微信表单 fixture：取消复原、错误不写回、保存防重及页面隐藏丢弃", async () => {
  globalThis.__formPageHooks = [];
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 671 }),
    onKeyboardHeightChange() {},
    offKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/style/index" }];
  const app = await mount("./fixtures/FormFixture.vue");
  const button = (label) =>
    app.find((node) => node.type === "button" && textOf(node).trim() === label);
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
    delete globalThis.getCurrentPages;
    delete globalThis.__formPageHooks;
  }
});
