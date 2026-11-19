import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { createPinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";
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
