/*
 * 登录/注册表单的平台无关规则。
 *
 * 规则与文案沿用旧 Web 的 AuthView.vue（apps/web/src/views/AuthView.vue），
 * 不针对新客户端调整措辞或放宽校验：
 * - 登录只校验邮箱格式与非空密码，旧账号的短密码不被注册规则拒绝；
 * - 注册要求昵称非空白、邮箱格式、密码至少 8 位、两次密码一致、验证码非空；
 * - 不新增密码字符组合限制，不 trim 密码原值，不猜测验证码格式；
 * - 认证与验证码服务尚未开放，合法提交只返回提示，不生成会话或假倒计时。
 *
 * 这里只包含纯函数，便于用 node --test 直接覆盖校验矩阵与首错顺序；
 * 焦点定位、显隐与页面生命周期由页面组件负责。
 */

export type AuthMode = "login" | "register";

export type AuthField =
  "nickname" | "email" | "password" | "confirmation" | "code";

/** 表单字段原值。密码与验证码保留用户输入的原始字符串。 */
export type AuthValues = Record<AuthField, string>;

/** 按提交顺序排列的字段；login/register 的可见字段集合不同。 */
export const LOGIN_FIELDS: readonly AuthField[] = ["email", "password"];

export const REGISTER_FIELDS: readonly AuthField[] = [
  "nickname",
  "email",
  "password",
  "confirmation",
  "code",
];

export const AUTH_FIELDS: readonly AuthField[] = REGISTER_FIELDS;

export type AuthErrors = Partial<Record<AuthField, string>>;

export const AUTH_MESSAGES = {
  nickname: "请输入昵称，不能只填写空格",
  emailRequired: "请输入邮箱",
  emailInvalid: "请输入有效的邮箱地址",
  passwordRequired: "请输入密码",
  passwordTooShort: "密码至少需要 8 位",
  confirmationRequired: "请再次输入密码",
  confirmationMismatch: "两次输入的密码不一致",
  codeRequired: "请输入邮箱验证码",
  authUnavailable: "认证服务暂未开放",
  codeUnavailable: "验证码服务暂未开放",
} as const;

/** 旧 Web 使用的邮箱形状校验；不引入更严格或更宽松的规则。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_MIN_LENGTH = 8;

export function emptyAuthValues(): AuthValues {
  return { nickname: "", email: "", password: "", confirmation: "", code: "" };
}

/** 当前模式可见且参与校验的字段，顺序即提交时的校验顺序。 */
export function visibleFields(mode: AuthMode): readonly AuthField[] {
  return mode === "register" ? REGISTER_FIELDS : LOGIN_FIELDS;
}

/**
 * 按 Unicode 码点计数，与旧 Web 的 Array.from(value).length 一致：
 * 一个 emoji 或增补平面汉字按 1 位计算，不因代理对把一个字符算成两位。
 */
export function passwordLength(value: string): number {
  return Array.from(value).length;
}

export function validateField(
  mode: AuthMode,
  field: AuthField,
  values: AuthValues,
): string {
  const value = values[field] ?? "";
  switch (field) {
    case "nickname":
      // 昵称允许首尾空格被忽略后判断，但只有注册展示该字段。
      return value.trim() ? "" : AUTH_MESSAGES.nickname;
    case "email": {
      const email = value.trim();
      if (!email) return AUTH_MESSAGES.emailRequired;
      return EMAIL_PATTERN.test(email) ? "" : AUTH_MESSAGES.emailInvalid;
    }
    case "password":
      if (!value) return AUTH_MESSAGES.passwordRequired;
      // 只有注册要求长度；登录沿用旧账号可能存在的短密码。
      if (mode === "register" && passwordLength(value) < PASSWORD_MIN_LENGTH)
        return AUTH_MESSAGES.passwordTooShort;
      return "";
    case "confirmation":
      if (!value) return AUTH_MESSAGES.confirmationRequired;
      // 比较原值，不 trim：前后空格也属于密码的一部分。
      return value === values.password
        ? ""
        : AUTH_MESSAGES.confirmationMismatch;
    case "code":
      return value.trim() ? "" : AUTH_MESSAGES.codeRequired;
  }
}

/** 校验当前模式的全部字段，返回按字段顺序的对象；合法字段不出现键。 */
export function validateValues(mode: AuthMode, values: AuthValues): AuthErrors {
  const errors: AuthErrors = {};
  for (const field of visibleFields(mode)) {
    const message = validateField(mode, field, values);
    if (message) errors[field] = message;
  }
  return errors;
}

/** 提交时定位的第一个错误字段；全部合法时返回空串。 */
export function firstErrorField(
  mode: AuthMode,
  values: AuthValues,
): AuthField | "" {
  for (const field of visibleFields(mode)) {
    if (validateField(mode, field, values)) return field;
  }
  return "";
}

/**
 * 已有错误字段的即时复验规则（对齐旧 Web 的 watch）：
 * 只复验此前报错的字段，加上用户一旦填写过确认密码就持续校验它。
 * 返回需要重新校验的字段集合，不产生新的错误提示。
 */
export function revalidateFields(
  mode: AuthMode,
  values: AuthValues,
  errors: AuthErrors,
): AuthField[] {
  const fields = visibleFields(mode).filter((field) => errors[field]);
  if (
    mode === "register" &&
    values.confirmation &&
    !fields.includes("confirmation")
  )
    fields.push("confirmation");
  return fields;
}

/** 修改密码后确认密码需要联动复验，避免停留在过期结论。 */
export function linkedFields(changed: AuthField): AuthField[] {
  return changed === "password" ? ["confirmation"] : [];
}

/**
 * 页面重新显示时清空的敏感字段。
 * 保留邮箱与昵称便于续填，密码、确认密码与验证码不跨显示周期留存。
 */
export const SENSITIVE_FIELDS: readonly AuthField[] = [
  "password",
  "confirmation",
  "code",
];

export function clearSensitive(values: AuthValues): AuthValues {
  const next = { ...values };
  for (const field of SENSITIVE_FIELDS) next[field] = "";
  return next;
}

/**
 * 组件的反馈状态：'' 表示没有提示。
 * 认证与验证码服务尚未开放，反馈只有这两种取值，不表达请求结果。
 */
export type AuthFeedback = "" | "auth" | "code";

export function feedbackMessage(feedback: AuthFeedback): string {
  if (feedback === "auth") return AUTH_MESSAGES.authUnavailable;
  if (feedback === "code") return AUTH_MESSAGES.codeUnavailable;
  return "";
}
