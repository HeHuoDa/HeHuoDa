import type {
  CampusPolicy,
  H5CredentialResponse,
  SchoolLoginChallenge,
  SchoolLoginH5Credential,
  SchoolLoginSubmit,
  SchoolLoginTransaction,
} from "@hehuoda/api-types";
import { RequestError, type PendingRequest } from "../api/http.ts";

export type SchoolLoginField = "name" | "account" | "password" | "captcha";

export interface SchoolLoginApi {
  schoolPolicy(): PendingRequest<CampusPolicy>;
  schoolCreateChallenge(): PendingRequest<SchoolLoginChallenge>;
  schoolRefreshChallenge(
    id: string,
    holderToken: string,
  ): PendingRequest<SchoolLoginChallenge>;
  schoolSubmitH5(
    id: string,
    body: SchoolLoginSubmit,
  ): PendingRequest<SchoolLoginH5Credential>;
  schoolQueryStatus(
    id: string,
    holderToken: string,
  ): PendingRequest<SchoolLoginTransaction>;
  schoolCancel(
    id: string,
    holderToken: string,
  ): PendingRequest<SchoolLoginTransaction>;
}

export interface SchoolLoginControllerOptions {
  now?: () => number;
  generation?: () => number;
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
  delay?: (ms: number) => Promise<void>;
  onAuthenticated: (credential: H5CredentialResponse) => Promise<void> | void;
}

export function initialSchoolLoginState() {
  return {
    policy: null as CampusPolicy | null,
    transaction: null as SchoolLoginTransaction | null,
    consented: false,
    name: "",
    account: "",
    password: "",
    captcha: "",
    fieldErrors: {} as Partial<Record<SchoolLoginField, string>>,
    pending: "" as
      | ""
      | "loading"
      | "creating"
      | "refreshing"
      | "submitting"
      | "querying"
      | "cancelling",
    message: "",
    uncertain: false,
    imageFailed: false,
    creationFailed: false,
    policyFailed: false,
    succeeded: false,
  };
}

export type SchoolLoginState = ReturnType<typeof initialSchoolLoginState>;

function detailNumber(error: RequestError, key: string): number | null {
  const value = error.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function schoolLoginFailureMessage(error: unknown): string {
  if (!(error instanceof RequestError)) return "登录未完成，请稍后重试。";
  if (error.kind === "cancelled") return "操作已取消。";
  if (error.kind === "timeout") return "连接超时，结果尚未确认，正在查询结果。";
  if (error.kind === "network") return "连接中断，结果尚未确认，正在查询结果。";
  if (error.kind === "invalid-response")
    return "服务响应异常，请查询结果或重新获取验证码。";

  if (
    error.statusCode === 429 ||
    error.code === "CAMPUS_RATE_LIMITED" ||
    error.code === "TOO_MANY_REQUESTS"
  ) {
    const seconds = detailNumber(error, "retryAfterSeconds");
    return seconds === null
      ? "请求过于频繁，请稍后再试。"
      : `请求过于频繁，请 ${seconds} 秒后再试。`;
  }
  if (error.code === "ACCOUNT_RESTRICTED") {
    return "账号当前受限，无法登录。";
  }
  if (error.code === "FORBIDDEN" || error.statusCode === 403) {
    return "当前访问来源未获授权，请检查访问地址后重试。";
  }
  if (error.statusCode === 404) {
    return "原登录会话已失效，请重新获取验证码。";
  }

  const errorCode = (error.code ?? "").replace(/^CAMPUS_/, "").toLowerCase();
  const code =
    errorCode === "unsupported_verification" &&
    error.details?.reason === "multiple_identities"
      ? "multiple_identities"
      : errorCode;
  const messages: Record<string, string> = {
    consent_mismatch: "认证说明已更新，请重新阅读并勾选同意。",
    identity_mismatch: "验证失败，姓名与学号不匹配。",
    credentials_failed: "学校未接受本次账号凭据，请核对后重新获取验证码再试。",
    captcha_failed: "验证码未通过，请重新获取验证码并输入新图片中的字符。",
    stale_challenge: "验证码已更换，请点击“换一张”后再试。",
    unsupported_verification: "学校返回的验证方式暂不支持，请稍后再试。",
    multiple_identities: "学校返回多个身份，暂不支持使用此账号登录。",
    unsupported_identity: "学校返回的身份无法安全识别，暂不能登录。",
    unknown_response: "学校返回的身份信息无法安全确认，暂不能登录。",
    verification_unavailable:
      "统一身份认证暂未开放或缺少当期配置，当前可先浏览公开比赛。",
    session_capacity: "当前登录人数较多，请稍后再试。",
    upstream_unavailable: "学校认证服务暂时不可用，请稍后再试。",
    upstream_timeout: "学校响应超时，结果未确认，正在查询本次结果。",
    transaction_busy: "登录正在处理，请稍候查询结果。",
    transaction_ended: "本次登录已结束，请重新获取验证码。",
    invalid_session: "学校登录会话已失效，请重新获取验证码。",
    session_expired: "验证码或登录会话已过期，请重新获取验证码。",
    cancelled: "已取消本次登录。",
    invalid_input: "请检查姓名、学号、密码与验证码是否填写完整。",
  };
  if (messages[code]) return messages[code];
  if (error.statusCode !== null && error.statusCode >= 500) {
    return "服务暂时不可用，请稍后重试。";
  }
  return "登录未完成，请稍后重试。";
}

function isUncertainSubmitError(error: unknown): boolean {
  if (!(error instanceof RequestError)) return false;
  if (
    error.kind === "timeout" ||
    error.kind === "network" ||
    error.kind === "invalid-response"
  ) {
    return true;
  }
  if (
    error.code === "CAMPUS_UPSTREAM_TIMEOUT" ||
    error.code === "CAMPUS_TRANSACTION_BUSY" ||
    error.code === "CAMPUS_UPSTREAM_UNAVAILABLE" ||
    error.code === "CAMPUS_UNKNOWN_RESPONSE"
  ) {
    return true;
  }
  return (
    error.statusCode !== null &&
    error.statusCode >= 500 &&
    error.code !== "CAMPUS_VERIFICATION_UNAVAILABLE" &&
    error.code !== "CAMPUS_SESSION_CAPACITY"
  );
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSchoolLoginController(
  state: SchoolLoginState,
  api: SchoolLoginApi,
  options: SchoolLoginControllerOptions,
) {
  const now = options.now ?? Date.now;
  const generation = options.generation ?? (() => 0);
  const pollMaxAttempts = options.pollMaxAttempts ?? 4;
  const pollIntervalMs = options.pollIntervalMs ?? 1200;
  const delay = options.delay ?? defaultDelay;

  let epoch = 0;
  let owner = generation();
  let active = false;
  let holderToken: string | null = null;
  let autoAttempted = false;
  const requests = new Set<PendingRequest<unknown>>();

  function clearSecrets() {
    state.password = "";
    state.captcha = "";
  }

  function stopInflight() {
    epoch += 1;
    clearSecrets();
    for (const req of requests) req.cancel();
    requests.clear();
    state.pending = "";
  }

  function current(at: number, accountGen: number): boolean {
    return active && epoch === at && generation() === accountGen;
  }

  async function tracked<T>(req: PendingRequest<T>): Promise<T> {
    requests.add(req);
    try {
      return await req.promise;
    } finally {
      requests.delete(req);
    }
  }

  function stripTransaction(
    tx: SchoolLoginChallenge | SchoolLoginTransaction,
  ): SchoolLoginTransaction {
    return {
      id: tx.id,
      status: tx.status,
      expiresAt: tx.expiresAt,
      reason: tx.reason,
      ...(tx.challenge ? { challenge: tx.challenge } : {}),
    };
  }

  function applyTransaction(
    tx: SchoolLoginTransaction,
    { preserveMessage = false }: { preserveMessage?: boolean } = {},
  ) {
    state.transaction = tx;
    state.uncertain = false;
    if (tx.challenge) state.imageFailed = false;
    if (tx.status !== "waiting") clearSecrets();
    if (preserveMessage) return;

    if (tx.status === "failed") {
      if (tx.reason === "credential_unavailable") {
        state.message =
          "学校身份已确认，但未下发登录凭据，请重新获取验证码后再试。";
        return;
      }
      state.message = schoolLoginFailureMessage(
        new RequestError("http", "", {
          code: `CAMPUS_${(tx.reason ?? "FAILED").toUpperCase()}`,
        }),
      );
    } else if (tx.status === "expired") {
      state.message = "本次登录已过期，请重新获取验证码。";
    } else if (tx.status === "cancelled") {
      state.message = "已取消本次登录。";
    } else if (tx.status === "succeeded") {
      // 状态接口不发凭据，这里不能建立登录态
      state.transaction = {
        ...tx,
        status: "failed",
        reason: "credential_unavailable",
        challenge: undefined,
      };
      state.message =
        "学校身份已确认，但登录凭据未送达，请重新获取验证码后再试。";
    }
  }

  async function loadPolicy(at: number, accountGen: number): Promise<boolean> {
    state.policyFailed = false;
    try {
      const policy = await tracked(api.schoolPolicy());
      if (!current(at, accountGen)) return false;
      if (state.policy?.version !== policy.version) {
        state.consented = false;
      }
      state.policy = policy;
      return true;
    } catch (error) {
      if (!current(at, accountGen)) return false;
      state.policyFailed = true;
      state.consented = false;
      state.message = schoolLoginFailureMessage(error);
      return false;
    }
  }

  async function show() {
    if (owner !== generation()) {
      reset();
    }
    const wasActive = active;
    owner = generation();
    active = true;
    if (state.pending) return;
    if (
      wasActive &&
      state.policy &&
      state.transaction?.status === "waiting" &&
      state.transaction.challenge
    ) {
      return;
    }

    const at = epoch;
    const accountGen = generation();
    state.pending = "loading";
    state.message = "";
    const ok = await loadPolicy(at, accountGen);
    if (!current(at, accountGen)) return;
    state.pending = "";
    if (ok && !autoAttempted && !state.transaction) {
      autoAttempted = true;
      await start();
    }
  }

  async function start() {
    if (!active || state.pending || state.policyFailed || !state.policy) return;
    if (
      state.transaction &&
      ["waiting", "processing"].includes(state.transaction.status) &&
      state.transaction.challenge
    ) {
      return;
    }
    const at = epoch;
    const accountGen = generation();
    state.pending = "creating";
    state.creationFailed = false;
    state.uncertain = false;
    state.imageFailed = false;
    state.message = "";
    clearSecrets();
    holderToken = null;
    try {
      const created = await tracked(api.schoolCreateChallenge());
      if (!current(at, accountGen)) return;
      holderToken = created.holderToken;
      applyTransaction(stripTransaction(created));
    } catch (error) {
      if (!current(at, accountGen)) return;
      state.creationFailed = true;
      state.message = schoolLoginFailureMessage(error);
    } finally {
      if (current(at, accountGen)) state.pending = "";
    }
  }

  async function refresh() {
    const tx = state.transaction;
    if (
      !active ||
      state.pending ||
      !tx ||
      !holderToken ||
      tx.status !== "waiting"
    ) {
      return;
    }
    if (Date.parse(tx.expiresAt) <= now()) {
      clearSecrets();
      holderToken = null;
      state.transaction = { ...tx, status: "expired", challenge: undefined };
      state.message = "本次登录已过期，请重新获取验证码。";
      return;
    }

    const at = epoch;
    const accountGen = generation();
    const token = holderToken;
    state.pending = "refreshing";
    state.message = "";
    // 验证码刷新立即清除旧答案
    state.captcha = "";
    state.fieldErrors = { ...state.fieldErrors, captcha: "" };
    try {
      const next = await tracked(api.schoolRefreshChallenge(tx.id, token));
      if (!current(at, accountGen)) return;
      holderToken = next.holderToken;
      state.imageFailed = false;
      applyTransaction(stripTransaction(next));
    } catch (error) {
      if (!current(at, accountGen)) return;
      if (
        error instanceof RequestError &&
        (error.statusCode === 409 || error.statusCode === 404)
      ) {
        holderToken = null;
        state.transaction = { ...tx, status: "expired", challenge: undefined };
      }
      state.message = schoolLoginFailureMessage(error);
    } finally {
      if (current(at, accountGen)) state.pending = "";
    }
  }

  async function queryOnce(
    at: number,
    accountGen: number,
  ): Promise<SchoolLoginTransaction | null> {
    const tx = state.transaction;
    if (!tx || !holderToken) return null;
    const result = await tracked(api.schoolQueryStatus(tx.id, holderToken));
    if (!current(at, accountGen)) return null;
    return { ...result, challenge: undefined };
  }

  async function query() {
    const tx = state.transaction;
    if (!active || state.pending || !tx || !holderToken) return;
    const at = epoch;
    const accountGen = generation();
    state.pending = "querying";
    clearSecrets();
    try {
      const result = await queryOnce(at, accountGen);
      if (!result || !current(at, accountGen)) return;
      if (result.status === "processing") {
        state.transaction = result;
        state.uncertain = true;
        state.message = "学校正在核验，请稍候再次查询结果。";
      } else {
        applyTransaction(result);
      }
    } catch (error) {
      if (!current(at, accountGen)) return;
      if (error instanceof RequestError && error.statusCode === 404) {
        holderToken = null;
        state.transaction = null;
        state.uncertain = false;
      } else {
        state.uncertain = true;
      }
      state.message = schoolLoginFailureMessage(error);
    } finally {
      if (current(at, accountGen)) state.pending = "";
    }
  }

  async function boundedPollStatus(at: number, accountGen: number) {
    for (let attempt = 0; attempt < pollMaxAttempts; attempt += 1) {
      if (!current(at, accountGen) || !state.transaction || !holderToken)
        return;
      if (attempt > 0) {
        await delay(pollIntervalMs);
        if (!current(at, accountGen) || !state.transaction || !holderToken)
          return;
      }
      try {
        const result = await queryOnce(at, accountGen);
        if (!result || !current(at, accountGen)) return;
        if (result.status !== "processing") {
          applyTransaction(result);
          return;
        }
        state.transaction = result;
        state.uncertain = true;
      } catch (error) {
        if (!current(at, accountGen)) return;
        if (error instanceof RequestError && error.statusCode === 404) {
          holderToken = null;
          state.transaction = null;
          state.uncertain = false;
          state.message = schoolLoginFailureMessage(error);
          return;
        }
      }
    }
    if (current(at, accountGen)) {
      state.uncertain = true;
      state.message =
        "核验仍未返回终态，请点击“查询本次结果”或重新获取验证码。";
    }
  }

  function validateSubmission(): boolean {
    const errors: Partial<Record<SchoolLoginField, string>> = {};
    if (!state.name.trim()) errors.name = "请填写姓名";
    if (!state.account.trim()) errors.account = "请填写学号";
    if (!state.password) errors.password = "请填写统一身份认证密码";
    if (!state.captcha.trim()) errors.captcha = "请填写验证码";
    state.fieldErrors = errors;
    if (Object.keys(errors).length > 0) return false;
    if (!state.policy) {
      state.message = "认证说明尚未加载，请重试。";
      return false;
    }
    if (!state.consented) {
      state.message = "请先阅读并勾选同意上述认证说明。";
      return false;
    }
    return true;
  }

  async function submit(): Promise<boolean> {
    const tx = state.transaction;
    if (
      !active ||
      state.pending ||
      state.uncertain ||
      !tx ||
      !holderToken ||
      tx.status !== "waiting" ||
      !tx.challenge
    ) {
      return false;
    }
    if (Date.parse(tx.expiresAt) <= now()) {
      clearSecrets();
      holderToken = null;
      state.transaction = { ...tx, status: "expired", challenge: undefined };
      state.message = "本次登录已过期，请重新获取验证码。";
      return false;
    }
    if (Date.parse(tx.challenge.expiresAt) <= now()) {
      const at = epoch;
      const accountGen = generation();
      clearSecrets();
      await refresh();
      if (
        current(at, accountGen) &&
        state.transaction?.status === "waiting" &&
        state.transaction.challenge &&
        !state.message
      ) {
        state.message = "验证码已过期，已自动刷新，请重新输入密码与新验证码。";
      }
      return false;
    }
    if (state.imageFailed) {
      clearSecrets();
      state.message = "验证码图片加载失败，请点击“换一张”后再试。";
      return false;
    }
    if (!validateSubmission()) return false;
    const policy = state.policy;
    if (!policy) return false;

    const at = epoch;
    const accountGen = generation();
    const body: SchoolLoginSubmit = {
      holderToken,
      name: state.name.trim(),
      account: state.account.trim(),
      password: state.password,
      captcha: state.captcha.trim(),
      challengeVersion: tx.challenge.version,
      consentVersion: policy.version,
    };
    // 提交后立即清空页面密码与验证码
    clearSecrets();
    state.pending = "submitting";
    state.message = "";
    state.fieldErrors = {};

    let shouldPoll = false;
    try {
      const res = await tracked(api.schoolSubmitH5(tx.id, body));
      body.password = "";
      body.captcha = "";
      if (!current(at, accountGen)) return false;

      if (res.status === "succeeded" && res.credential) {
        holderToken = null;
        state.transaction = {
          id: res.id,
          status: "succeeded",
          expiresAt: res.expiresAt,
          reason: res.reason,
        };
        state.uncertain = false;
        try {
          await options.onAuthenticated(res.credential);
        } catch (authError) {
          if (active && epoch === at) {
            state.message =
              authError instanceof RequestError &&
              authError.kind === "cancelled"
                ? "登录状态已变化，请确认当前账号状态。"
                : schoolLoginFailureMessage(authError);
          }
          return false;
        }
        if (!active || epoch !== at) return false;
        state.succeeded = true;
        state.message = "登录成功。";
        return true;
      }

      if (res.status === "succeeded" && !res.credential) {
        holderToken = null;
        applyTransaction({
          id: res.id,
          status: "failed",
          expiresAt: res.expiresAt,
          reason: "credential_unavailable",
        });
        return false;
      }

      if (res.status === "processing") {
        state.transaction = {
          id: res.id,
          status: "processing",
          expiresAt: res.expiresAt,
          reason: res.reason,
        };
        state.uncertain = true;
        shouldPoll = true;
      } else {
        holderToken = res.status === "waiting" ? holderToken : null;
        applyTransaction({
          id: res.id,
          status: res.status as SchoolLoginTransaction["status"],
          expiresAt: res.expiresAt,
          reason: res.reason,
        });
      }
    } catch (error) {
      body.password = "";
      body.captcha = "";
      if (!current(at, accountGen)) return false;

      if (
        error instanceof RequestError &&
        error.code === "CAMPUS_CONSENT_MISMATCH"
      ) {
        // 告知版本过期：取消勾选并重读说明，不自动重发密码。
        state.consented = false;
        state.message = schoolLoginFailureMessage(error);
        await loadPolicy(at, accountGen);
        return false;
      }

      if (
        error instanceof RequestError &&
        error.code === "CAMPUS_STALE_CHALLENGE"
      ) {
        state.transaction = { ...tx, challenge: undefined };
        state.message = schoolLoginFailureMessage(error);
        return false;
      }

      if (
        error instanceof RequestError &&
        (error.statusCode === 429 ||
          error.code === "CAMPUS_RATE_LIMITED" ||
          error.code === "TOO_MANY_REQUESTS")
      ) {
        state.message = schoolLoginFailureMessage(error);
        return false;
      }

      if (isUncertainSubmitError(error)) {
        state.transaction = {
          ...tx,
          status: "processing",
          challenge: undefined,
        };
        state.uncertain = true;
        state.message = schoolLoginFailureMessage(error);
        shouldPoll = true;
      } else {
        holderToken = null;
        state.transaction = { ...tx, status: "failed", challenge: undefined };
        state.uncertain = false;
        state.message = schoolLoginFailureMessage(error);
      }
    } finally {
      body.password = "";
      body.captcha = "";
      if (epoch === at) state.pending = "";
    }

    if (shouldPoll && current(at, accountGen)) {
      state.pending = "querying";
      try {
        await boundedPollStatus(at, accountGen);
      } finally {
        if (epoch === at) state.pending = "";
      }
    }
    return false;
  }

  async function cancel() {
    if (state.pending === "cancelling") return;
    const tx = state.transaction;
    if (!active || !tx || !holderToken) {
      clearSecrets();
      return;
    }
    const id = tx.id;
    const token = holderToken;
    stopInflight();
    const at = epoch;
    const accountGen = generation();
    state.pending = "cancelling";
    state.transaction = { ...tx, challenge: undefined };
    try {
      const res = await tracked(api.schoolCancel(id, token));
      if (!current(at, accountGen)) return;
      holderToken = null;
      applyTransaction({ ...res, challenge: undefined });
    } catch (error) {
      if (!current(at, accountGen)) return;
      holderToken = null;
      state.uncertain = false;
      state.transaction = { ...tx, status: "cancelled", challenge: undefined };
      state.message = `${schoolLoginFailureMessage(error)}（已本地结束本次登录，原事务将自动过期。）`;
    } finally {
      if (current(at, accountGen)) state.pending = "";
    }
  }

  async function restart() {
    if (!active || state.pending) return;
    if (
      state.transaction &&
      state.transaction.status === "waiting" &&
      holderToken
    ) {
      await cancel();
      if (!active) return;
    }
    state.transaction = null;
    state.uncertain = false;
    state.creationFailed = false;
    state.imageFailed = false;
    state.succeeded = false;
    state.message = "";
    state.fieldErrors = {};
    clearSecrets();
    if (!state.policy || state.policyFailed) {
      const at = epoch;
      const accountGen = generation();
      state.pending = "loading";
      const ok = await loadPolicy(at, accountGen);
      if (!current(at, accountGen)) return;
      state.pending = "";
      if (!ok) return;
    }
    await start();
  }

  function hide(leaving = false) {
    const tx = state.transaction;
    const token = holderToken;
    active = false;
    stopInflight();
    if (tx) state.transaction = { ...tx, challenge: undefined };
    if (
      leaving &&
      tx &&
      token &&
      ["waiting", "processing"].includes(tx.status)
    ) {
      holderToken = null;
      try {
        api.schoolCancel(tx.id, token).promise.catch(() => {});
      } catch {
        /* 由后端期限收敛 */
      }
      state.transaction = null;
    }
  }

  function reset() {
    active = false;
    autoAttempted = false;
    holderToken = null;
    stopInflight();
    Object.assign(state, initialSchoolLoginState());
    owner = generation();
  }

  function edit(field: SchoolLoginField, value: string) {
    state[field] = value;
    if (state.fieldErrors[field]) {
      state.fieldErrors = { ...state.fieldErrors, [field]: "" };
    }
  }

  function setConsented(value: boolean) {
    if (state.pending) return;
    state.consented = value;
    if (value && state.message === "请先阅读并勾选同意上述认证说明。") {
      state.message = "";
    }
  }

  function imageError() {
    clearSecrets();
    state.imageFailed = true;
    state.message = "验证码图片加载失败，请点击“换一张”后再试。";
  }

  return {
    show,
    hide,
    reset,
    start,
    restart,
    refresh,
    submit,
    query,
    cancel,
    edit,
    setConsented,
    clearSecrets,
    imageError,
  };
}
