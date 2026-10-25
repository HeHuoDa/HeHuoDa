import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
import { mount, textOf } from "./component-host.mjs";
import { useDraftForm } from "../src/forms/use-draft-form.ts";
import { validateProfile } from "@hehuoda/client-domain/profile";

const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
after(() => loader.deregister());

test("未登录时下拉承载授权开关与编辑资料，昵称只读", async () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  const app = await mount("../src/components/ProfileOverview.vue");
  const openMenu = async () => {
    const trigger = app.find(
      (node) =>
        node.props.role === "button" && node.props["aria-haspopup"] === "menu",
    );
    assert.ok(trigger, "账号入口应可操作");
    trigger.props.onClick();
    await nextTick();
  };
  const menuItem = async (label) => {
    const node = app.find(
      (n) =>
        n.props.role === "menuitem" &&
        n.props.onClick &&
        textOf(n).includes(label),
    );
    assert.ok(node, label);
    node.props.onClick();
    await nextTick();
  };
  const click = async (label) => {
    const button = app.find(
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(button, label);
    button.props.onClick();
    await nextTick();
  };
  const input = async (id, value) => {
    app
      .find((n) => n.type === "input" && n.props.id === id)
      .props.onInput({ detail: { value } });
    await nextTick();
  };
  try {
    await openMenu();
    const toggle = app.find((n) => n.type === "switch");
    assert.equal(toggle.props.checked, false);
    toggle.props.onChange({ detail: { value: true } });
    await nextTick();
    assert.equal(session.contactShared, true);
    assert.match(textOf(app.container), /演示已授权/);
    // 开关不下拉关闭：同一份下拉里仍能找到编辑资料。
    assert.ok(
      app.find(
        (n) => n.props.role === "menuitem" && textOf(n).includes("编辑资料"),
      ),
    );
    toggle.props.onKeydown({ key: " ", preventDefault() {} });
    await nextTick();
    assert.equal(session.contactShared, false);
    assert.equal(
      app.find((n) => n.type === "switch").props["aria-checked"],
      false,
    );

    await menuItem("编辑资料");
    const nickname = app.find((n) => n.props.id === "profile-nickname");
    assert.equal(nickname.props.value, "禾小苗");
    assert.equal(nickname.props.disabled, true);
    await input("profile-skills", " 编程,设计、编程 ");
    await click("保存资料");
    assert.equal(session.profile.skills, "编程、设计");
    assert.equal(session.profile.nickname, "禾小苗", "未登录不改示例昵称");
    assert.match(textOf(app.container), /未保存到服务器/);
  } finally {
    app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("重置示例先二次确认，取消不改动数据，确认后清空演示会话", async () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    onWindowResize() {},
    offWindowResize() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  const app = await mount("../src/components/ProfileOverview.vue");
  const openMenu = async () => {
    app
      .find(
        (node) =>
          node.props.role === "button" &&
          node.props["aria-haspopup"] === "menu",
      )
      .props.onClick();
    await nextTick();
  };
  const menuItem = async (label) => {
    const node = app.find(
      (n) =>
        n.props.role === "menuitem" &&
        n.props.onClick &&
        textOf(n).includes(label),
    );
    assert.ok(node, label);
    node.props.onClick();
    await nextTick();
  };
  const click = async (label) => {
    const button = app.find(
      (n) => n.type === "button" && textOf(n).includes(label),
    );
    assert.ok(button, label);
    button.props.onClick();
    await nextTick();
  };
  try {
    session.apply("demo-1", "调研", "保留申请");
    session.contactShared = true;
    session.saveProfile({ ...session.profile, skills: "编程" });

    await openMenu();
    await menuItem("重置示例");
    assert.ok(
      app.find((n) => n.props.role === "dialog"),
      "重置必须先二次确认",
    );
    await click("取消并关闭");
    assert.equal(session.contactShared, true, "取消不改动授权");
    assert.equal(session.profile.skills, "编程", "取消不改动资料");
    assert.ok(session.applications["demo-1"], "取消不清空申请");

    await openMenu();
    await menuItem("重置示例");
    await click("确认重置");
    assert.equal(session.contactShared, false);
    assert.notEqual(session.profile.skills, "编程");
    assert.equal(session.applications["demo-1"], undefined);
    assert.match(textOf(app.container), /示例数据已重置/);
  } finally {
    app.unmount();
    delete globalThis.uni;
    delete globalThis.getCurrentPages;
  }
});

test("七项资料非法输入逐项拒绝且不覆盖会话，失败后保留草稿", () => {
  const session = useSessionStore(createPinia());
  const original = { ...session.profile };
  const form = useDraftForm({
    read: () => session.profile,
    clone: (v) => ({ ...v }),
    validate: validateProfile,
    save: session.saveProfile,
  });
  const cases = [
    ["nickname", " "],
    ["nickname", "苗".repeat(21)],
    ["campus", "外部校区"],
    ["collegeId", "missing-college"],
    ["major", " "],
    ["major", "学".repeat(61)],
    ["grade", "1999"],
    ["grade", "20xx"],
    ["skills", "a,b,c,d,e,f,g,h,i"],
    ["skills", "字".repeat(21)],
    ["skills", " ".repeat(169)],
    ["bio", "介".repeat(201)],
  ];
  for (const [key, value] of cases) {
    form.begin();
    form.draft.value[key] = value;
    assert.equal(form.submit(), false, key);
    assert.equal(form.firstError.value, key);
    assert.equal(form.draft.value[key], value);
    assert.deepEqual(session.profile, original);
  }
  form.begin();
  Object.assign(form.draft.value, {
    major: "  软件工程  ",
    bio: "  ",
    skills: "",
  });
  assert.equal(form.submit(), true);
  assert.equal(session.profile.major, "软件工程");
  assert.equal(session.profile.bio, "");
});
