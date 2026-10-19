import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_MESSAGES,
  clearSensitive,
  emptyAuthValues,
  feedbackMessage,
  firstErrorField,
  linkedFields,
  passwordLength,
  revalidateFields,
  validateField,
  validateValues,
  visibleFields,
} from "../src/forms/auth-form.ts";

/** 合法注册数据；各用例只覆盖需要变化的字段。 */
function registration(overrides = {}) {
  return {
    ...emptyAuthValues(),
    nickname: "禾苗",
    email: "student@example.com",
    password: "abcdefgh",
    confirmation: "abcdefgh",
    code: "arbitrary-code",
    ...overrides,
  };
}

test("登录只校验邮箱与密码，旧账号短密码不被注册规则拒绝", () => {
  assert.deepEqual(visibleFields("login"), ["email", "password"]);
  const shortPassword = registration({ password: "x" });
  assert.deepEqual(validateValues("login", shortPassword), {});
  assert.equal(firstErrorField("login", shortPassword), "");

  const missing = validateValues(
    "login",
    registration({ email: "", password: "" }),
  );
  assert.deepEqual(missing, {
    email: AUTH_MESSAGES.emailRequired,
    password: AUTH_MESSAGES.passwordRequired,
  });
});

test("注册校验矩阵：非法邮箱、空白昵称、7/8 位密码、不一致确认与空验证码", () => {
  assert.deepEqual(validateValues("register", registration()), {});

  const cases = [
    [{ nickname: "   " }, "nickname", AUTH_MESSAGES.nickname],
    [{ email: "invalid" }, "email", AUTH_MESSAGES.emailInvalid],
    [{ email: "  " }, "email", AUTH_MESSAGES.emailRequired],
    [
      { password: "1234567", confirmation: "1234567" },
      "password",
      AUTH_MESSAGES.passwordTooShort,
    ],
    [
      { confirmation: "different" },
      "confirmation",
      AUTH_MESSAGES.confirmationMismatch,
    ],
    [{ code: "   " }, "code", AUTH_MESSAGES.codeRequired],
    [{ code: "" }, "code", AUTH_MESSAGES.codeRequired],
  ];
  for (const [overrides, field, message] of cases) {
    const values = registration(overrides);
    assert.equal(validateField("register", field, values), message, field);
    // 非法字段有反馈时不能出现“认证服务暂未开放”式的合法结论。
    assert.notEqual(firstErrorField("register", values), "");
  }

  // 8 位是通过边界，7 位不通过；按码点计数不受代理对影响。
  assert.equal(passwordLength("12345678"), 8);
  assert.equal(
    validateField(
      "register",
      "password",
      registration({ password: "12345678" }),
    ),
    "",
  );
  assert.equal(
    passwordLength("😀😀😀😀😀😀😀😀"),
    8,
    "增补平面字符按 1 位计算",
  );
});

test("密码不 trim：前后空格是密码的一部分，确认需原值一致", () => {
  const spaced = registration({
    password: " 123456 ",
    confirmation: " 123456 ",
  });
  assert.deepEqual(validateValues("register", spaced), {});
  assert.equal(passwordLength(spaced.password), 8);

  const trimmedConfirmation = registration({
    password: " 123456 ",
    confirmation: "123456",
  });
  assert.equal(
    validateField("register", "confirmation", trimmedConfirmation),
    AUTH_MESSAGES.confirmationMismatch,
  );
});

test("不新增密码字符组合限制：纯数字与纯符号都按长度规则通过", () => {
  for (const password of ["12345678", "!!!!!!!!", "密码密码密码密码"]) {
    const values = registration({ password, confirmation: password });
    assert.deepEqual(validateValues("register", values), {}, password);
  }
});

test("提交时首错按字段顺序定位", () => {
  assert.equal(firstErrorField("register", emptyAuthValues()), "nickname");
  assert.equal(
    firstErrorField("register", registration({ nickname: "禾苗" })),
    "",
  );
  assert.equal(firstErrorField("register", registration({ code: "" })), "code");
  assert.equal(
    firstErrorField("login", emptyAuthValues()),
    "email",
    "登录从邮箱开始",
  );
});

test("即时复验只覆盖已报错字段，确认密码填写后持续校验", () => {
  const values = registration({ confirmation: "" });
  const errors = { email: AUTH_MESSAGES.emailInvalid, code: "" };
  assert.deepEqual(revalidateFields("register", values, errors), ["email"]);

  const filledConfirmation = registration({ confirmation: "other" });
  assert.deepEqual(revalidateFields("register", filledConfirmation, {}), [
    "confirmation",
  ]);
  assert.deepEqual(
    revalidateFields("login", registration(), {}),
    [],
    "登录不追踪确认密码",
  );
  assert.deepEqual(linkedFields("password"), ["confirmation"]);
  assert.deepEqual(linkedFields("email"), []);
});

test("重新显示时清空密码与验证码，保留邮箱与昵称", () => {
  const values = registration({ password: " 123456 " });
  const cleared = clearSensitive(values);
  assert.equal(cleared.password, "");
  assert.equal(cleared.confirmation, "");
  assert.equal(cleared.code, "");
  assert.equal(cleared.email, values.email);
  assert.equal(cleared.nickname, values.nickname);
  // 不修改传入对象，避免与响应式源共享引用。
  assert.equal(values.password, " 123456 ");
});

test("反馈文案只有未开放提示，不表达假成功", () => {
  assert.equal(feedbackMessage("auth"), "认证服务暂未开放");
  assert.equal(feedbackMessage("code"), "验证码服务暂未开放");
  assert.equal(feedbackMessage(""), "");
  const all = Object.values(AUTH_MESSAGES).join("");
  assert.doesNotMatch(all, /成功|已发送|已注册|已登录/);
});
