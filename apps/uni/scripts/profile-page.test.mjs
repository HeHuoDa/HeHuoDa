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

test("资料编辑取消不写回，校验首错保留草稿，保存规范化且资料重置保留队伍", async () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  globalThis.uni = {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange() {},
    offKeyboardHeightChange() {},
    hideTabBar() {},
    showTabBar() {},
  };
  globalThis.getCurrentPages = () => [{ route: "pages/profile/index" }];
  const app = await mount("../src/components/ProfileOverview.vue");
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
    const toggle = app.find((n) => n.type === "switch");
    assert.equal(toggle.props.checked, false);
    toggle.props.onChange({ detail: { value: true } });
    await nextTick();
    assert.equal(session.contactShared, true);
    assert.match(textOf(app.container), /未提供真实联系方式/);
    toggle.props.onChange({ detail: { value: false } });
    await nextTick();
    assert.equal(session.contactShared, false);
    await click("编辑资料");
    await input("profile-nickname", "不保存");
    await click("取消并关闭");
    await click("编辑资料");
    assert.equal(
      app.find((n) => n.props.id === "profile-nickname").props.value,
      "禾小苗",
    );
    await input("profile-nickname", " ");
    await click("保存示例资料");
    assert.match(textOf(app.container), /请输入 1–20 字昵称/);
    assert.equal(
      app.find((n) => n.props.id === "profile-nickname").props.focus,
      true,
    );
    assert.equal(session.profile.nickname, "禾小苗");
    await input("profile-nickname", " 新伙伴 ");
    await input("profile-skills", " 编程,设计、编程 ");
    await click("保存示例资料");
    assert.equal(session.profile.nickname, "新伙伴");
    assert.equal(session.profile.skills, "编程、设计");
    assert.match(textOf(app.container), /未保存到服务器/);
    session.apply("demo-1", "调研", "保留申请");
    session.contactShared = true;
    await click("重置示例");
    assert.equal(session.profile.nickname, "禾小苗");
    assert.equal(session.contactShared, false);
    assert.ok(session.applications["demo-1"]);
    await click("编辑资料");
    await input("profile-nickname", "统一重置时丢弃");
    session.reset();
    await nextTick();
    assert.equal(
      app.find((n) => n.props.role === "dialog"),
      undefined,
    );
    await click("编辑资料");
    assert.equal(
      app.find((n) => n.props.id === "profile-nickname").props.value,
      "禾小苗",
    );
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
