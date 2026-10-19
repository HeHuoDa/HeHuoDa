import assert from "node:assert/strict";
import { test } from "node:test";
import { useDraftForm } from "../src/forms/use-draft-form.ts";

test("打开复制草稿，取消及重开不会写回已保存值", () => {
  let saved = { nickname: "禾小苗", roles: ["设计"] };
  const form = useDraftForm({
    read: () => saved,
    clone: (value) => ({ ...value, roles: [...value.roles] }),
    validate: () => ({}),
    save: (value) => {
      saved = value;
    },
  });
  form.begin();
  form.draft.value.nickname = "未保存";
  form.draft.value.roles.push("调研");
  form.cancel();
  form.begin();
  assert.deepEqual(form.draft.value, { nickname: "禾小苗", roles: ["设计"] });
  assert.deepEqual(saved, { nickname: "禾小苗", roles: ["设计"] });
});

test("错误提交保留草稿并返回首错，修正后保存一次且不 trim 密码", () => {
  let saved = { nickname: "禾小苗", password: "  password  " };
  let saves = 0;
  const form = useDraftForm({
    read: () => saved,
    clone: (value) => ({ ...value }),
    validate: (value) =>
      value.nickname.trim() ? {} : { nickname: "请输入昵称" },
    save: (value) => {
      saved = value;
      saves++;
    },
  });
  form.begin();
  form.draft.value.nickname = " ";
  assert.equal(form.submit(), false);
  assert.equal(form.opened.value, true);
  assert.equal(form.firstError.value, "nickname");
  assert.equal(saved.nickname, "禾小苗");
  form.draft.value.nickname = "新昵称";
  assert.equal(form.submit(), true);
  assert.equal(form.submit(), false);
  assert.equal(saves, 1);
  assert.equal(saved.password, "  password  ");
});

test("保存异常保留草稿供重试，父层取消后不能提交", () => {
  const form = useDraftForm({
    read: () => ({ value: "原值" }),
    clone: (value) => ({ ...value }),
    validate: () => ({}),
    save: () => {
      throw new Error("失效动作");
    },
  });
  form.begin();
  form.draft.value.value = "修改";
  assert.equal(form.submit(), false);
  assert.equal(form.draft.value.value, "修改");
  assert.match(form.submitError.value, /保存失败/);
  assert.equal(form.submitting.value, false);
  form.cancel();
  assert.equal(form.submit(), false);
});
