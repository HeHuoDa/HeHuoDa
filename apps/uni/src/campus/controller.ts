import type {
  CampusPolicy,
  CampusQualification,
  CampusProfile,
  CampusTransaction,
} from "@hehuoda/api-types";
import type { createCampusApi } from "../api/campus-client.ts";
import { RequestError, type PendingRequest } from "../api/http.ts";
import { campusFailure } from "./presentation.ts";

/** 页面上可编辑的身份字段；错误就地显示在对应输入框下。 */
export type CampusField = "name" | "account" | "password" | "captcha";

export function initialCampusState() {
  return {
    policy: null as CampusPolicy | null,
    qualification: null as CampusQualification | null,
    profile: null as CampusProfile["profile"],
    transaction: null as CampusTransaction | null,
    consented: false,
    name: "",
    account: "",
    password: "",
    captcha: "",
    fieldErrors: {} as Partial<Record<CampusField, string>>,
    pending: "",
    message: "",
    profileError: "",
    uncertain: false,
    imageFailed: false,
    creationFailed: false,
  };
}
export type CampusState = ReturnType<typeof initialCampusState>;

export function createCampusController(
  state: CampusState,
  api: ReturnType<typeof createCampusApi>,
  generation: () => number,
  now: () => number = Date.now,
) {
  let epoch = 0;
  let owner = generation();
  let active = false;
  /** 自动取码每次进入只尝试一次；失败后由用户主动重试，不循环创建。 */
  let autoAttempted = false;
  let createRetryAt = 0;
  const requests = new Set<PendingRequest<unknown>>();
  function clearSecrets() {
    state.password = "";
    state.captcha = "";
  }
  function imageError() {
    clearSecrets();
    state.imageFailed = true;
    state.message =
      "验证码图片加载失败，请点击图片换一张；不要填写不可见图片的答案。";
  }
  function stop() {
    epoch++;
    clearSecrets();
    for (const pending of requests) pending.cancel();
    requests.clear();
    state.pending = "";
  }
  function reset() {
    active = false;
    autoAttempted = false;
    createRetryAt = 0;
    stop();
    Object.assign(state, initialCampusState());
    owner = generation();
  }
  async function tracked<T>(request: PendingRequest<T>): Promise<T> {
    requests.add(request);
    try {
      return await request.promise;
    } finally {
      requests.delete(request);
    }
  }
  function current(at: number, account: number) {
    return active && epoch === at && generation() === account;
  }
  function apply(transaction: CampusTransaction) {
    state.transaction = transaction;
    state.uncertain = false;
    if (transaction.challenge) state.imageFailed = false;
    if (transaction.status !== "waiting") clearSecrets();
    if (
      transaction.status === "failed" &&
      !(transaction.reason === "internal_failure" && state.message)
    )
      state.message = campusFailure(
        new RequestError("http", "", {
          code: `CAMPUS_${transaction.reason?.toUpperCase() ?? "FAILED"}`,
        }),
      );
    else if (transaction.status === "succeeded") state.message = "认证成功。";
    else if (transaction.status === "expired")
      state.message = "本次认证已过期，请重新认证。";
    else if (transaction.status === "cancelled")
      state.message = "本次认证已取消，可继续浏览。";
  }
  async function loadDetails(at: number, account: number) {
    const loadFailure = (error: unknown) =>
      error instanceof RequestError && error.kind === "http"
        ? campusFailure(error)
        : "认证信息加载失败，请重新查询。";
    await Promise.all([
      (async () => {
        try {
          const v = await tracked(api.status());
          if (current(at, account)) state.qualification = v;
        } catch (e) {
          if (current(at, account)) state.message = loadFailure(e);
        }
      })(),
      (async () => {
        try {
          const v = await tracked(api.policy());
          if (current(at, account)) {
            if (state.policy?.version !== v.version) state.consented = false;
            state.policy = v;
          }
        } catch (e) {
          if (current(at, account)) {
            state.policy = null;
            state.consented = false;
            state.message = loadFailure(e);
          }
        }
      })(),
      (async () => {
        try {
          const v = await tracked(api.profile());
          if (current(at, account)) {
            state.profile = v.profile;
            state.profileError = "";
          }
        } catch (e) {
          if (current(at, account)) state.profileError = campusFailure(e);
        }
      })(),
    ]);
  }
  async function query() {
    if (!active || state.pending || !state.transaction) return;
    const id = state.transaction.id,
      at = epoch,
      account = generation();
    state.pending = "querying";
    clearSecrets();
    try {
      const v = await tracked(api.query(id));
      if (!current(at, account)) return;
      // 查询不恢复旧挑战：恢复前台与结果不明时不能重放旧密码。
      apply({ ...v, challenge: undefined });
      if (v.status === "succeeded") await loadDetails(at, account);
    } catch (e) {
      if (!current(at, account)) return;
      state.uncertain = true;
      state.message = campusFailure(e);
      if (e instanceof RequestError && e.statusCode === 404) {
        state.transaction = null;
        state.uncertain = false;
      }
    } finally {
      if (current(at, account)) state.pending = "";
    }
  }
  /** 只有可新认证、没有既有事务且尚无有效资格时才需要立刻取码。 */
  function autoEligible() {
    const qualification = state.qualification;
    return (
      !autoAttempted &&
      !!qualification?.available &&
      !!qualification.currentTerm &&
      qualification.status !== "valid"
    );
  }
  async function show() {
    if (owner !== generation()) reset();
    owner = generation();
    active = true;
    if (state.pending) return;
    if (state.transaction) {
      await query();
      return;
    }
    const at = epoch,
      account = generation();
    state.pending = "loading";
    await loadDetails(at, account);
    if (!current(at, account)) return;
    state.pending = "";
    // 未认证用户进入即取码，不需要先勾选同意；已有有效资格先看资料卡。
    if (autoEligible()) {
      autoAttempted = true;
      await start();
    }
  }
  async function start() {
    if (state.creationFailed && now() < createRetryAt) {
      state.message =
        "创建结果尚未确认且没有事务编号，请在五分钟后点击“重新认证”。";
      return;
    }
    if (
      !active ||
      state.pending ||
      !state.policy ||
      !state.qualification?.available ||
      !state.qualification.currentTerm ||
      state.uncertain
    )
      return;
    if (
      state.transaction &&
      ["waiting", "processing"].includes(state.transaction.status)
    )
      return;
    const at = epoch,
      account = generation();
    state.pending = "creating";
    state.message = "";
    clearSecrets();
    try {
      const v = await tracked(api.create());
      if (current(at, account)) {
        state.creationFailed = false;
        createRetryAt = 0;
        apply(v);
      }
    } catch (e) {
      if (!current(at, account)) return;
      state.creationFailed = true;
      state.message = campusFailure(e);
      if (
        !(e instanceof RequestError) ||
        ["network", "timeout", "invalid-response", "cancelled"].includes(
          e.kind,
        ) ||
        (e.statusCode !== null && e.statusCode >= 500) ||
        e.code === "CAMPUS_TRANSACTION_ACTIVE"
      ) {
        createRetryAt = now() + 300_000;
        state.message =
          "创建结果尚未确认且没有事务编号，请在五分钟后点击“重新认证”。";
      }
      if (e instanceof RequestError && e.code === "CAMPUS_CONSENT_MISMATCH") {
        state.consented = false;
        await loadDetails(at, account);
      }
    } finally {
      if (current(at, account)) state.pending = "";
    }
  }
  /** 失败、取消或过期后新建事务；保留姓名与学号，密码与验证码必须重填。 */
  async function restart() {
    if (!active || state.pending) return;
    if (
      state.transaction &&
      (state.transaction.status === "processing" ||
        (state.transaction.status === "waiting" && state.transaction.challenge))
    )
      return;
    if (state.transaction?.status === "waiting") {
      const account = generation();
      await cancel();
      if (!active || generation() !== account || state.uncertain) return;
    }
    state.transaction = null;
    state.uncertain = false;
    state.message = "";
    state.imageFailed = false;
    state.fieldErrors = {};
    clearSecrets();
    await start();
  }
  /** 资格、告知或资料读取失败后的整页重查。 */
  async function reload() {
    if (!active || state.pending) return;
    if (state.creationFailed) {
      await restart();
      return;
    }
    if (state.transaction) {
      const at = epoch,
        account = generation();
      state.pending = "loading";
      state.message = "";
      clearSecrets();
      try {
        await loadDetails(at, account);
      } finally {
        if (current(at, account)) state.pending = "";
      }
      return;
    }
    reset();
    await show();
  }
  function validateSubmission() {
    const errors: Partial<Record<CampusField, string>> = {};
    if (!state.name.trim()) errors.name = "请填写姓名";
    if (!state.account.trim()) errors.account = "请填写学号";
    if (!state.password) errors.password = "请填写统一身份认证密码";
    if (!state.captcha) errors.captcha = "请填写验证码";
    state.fieldErrors = errors;
    if (Object.keys(errors).length > 0) return false;
    if (!state.policy) {
      state.message = "认证说明未加载，请稍后重试。";
      return false;
    }
    if (!state.consented) {
      state.message = "请先勾选同意上述认证说明。";
      return false;
    }
    return true;
  }
  async function mutate(kind: "refreshing" | "submitting") {
    const tx = state.transaction;
    if (
      !active ||
      state.pending ||
      state.uncertain ||
      tx?.status !== "waiting" ||
      !tx.challenge
    )
      return;
    if (
      Date.parse(tx.expiresAt) <= now() ||
      Date.parse(tx.challenge.expiresAt) <= now()
    ) {
      clearSecrets();
      state.transaction = { ...tx, challenge: undefined };
      state.message = "验证码或事务已过期，请重新认证。";
      return;
    }
    if (kind === "submitting" && state.imageFailed) {
      clearSecrets();
      return;
    }
    if (kind === "submitting" && !validateSubmission()) return;
    const policy = state.policy;
    if (!policy) return;
    const at = epoch,
      account = generation();
    state.pending = kind;
    state.message = "";
    state.fieldErrors = {};
    const body = {
      name: state.name.trim(),
      account: state.account.trim(),
      password: state.password,
      captcha: state.captcha,
      challengeVersion: tx.challenge.version,
      consentVersion: policy.version,
    };
    clearSecrets();
    try {
      const request =
        kind === "refreshing" ? api.refresh(tx.id) : api.submit(tx.id, body);
      body.password = "";
      body.captcha = "";
      const v = await tracked(request);
      if (!current(at, account)) return;
      apply(v);
      if (v.status === "succeeded") await loadDetails(at, account);
    } catch (e) {
      if (!current(at, account)) return;
      if (e instanceof RequestError && e.code === "CAMPUS_CONSENT_MISMATCH") {
        // 告知已更新：取消勾选并重新读取说明，不自动重发凭据。
        state.consented = false;
        state.message = campusFailure(e);
        await loadDetails(at, account);
      } else {
        state.transaction = { ...tx, challenge: undefined };
        state.uncertain = true;
        state.message = campusFailure(e);
      }
    } finally {
      body.password = "";
      body.captcha = "";
      if (current(at, account)) state.pending = "";
    }
    if (current(at, account) && state.uncertain) await query();
  }
  async function cancel() {
    if (state.pending === "cancelling") return;
    if (!active || !state.transaction) {
      clearSecrets();
      return;
    }
    const id = state.transaction.id;
    stop();
    const at = epoch,
      account = generation();
    state.pending = "cancelling";
    state.transaction = { ...state.transaction, challenge: undefined };
    try {
      const v = await tracked(api.cancel(id));
      if (current(at, account)) apply(v);
    } catch (e) {
      if (current(at, account)) {
        state.uncertain = true;
        state.message = `${campusFailure(e)} 未确认取消，后端仍会按期限结束。`;
      }
    } finally {
      if (current(at, account)) state.pending = "";
    }
  }
  function hide(leaving = false) {
    const tx = state.transaction;
    active = false;
    stop();
    if (tx) state.transaction = { ...tx, challenge: undefined };
    if (leaving && tx && ["waiting", "processing"].includes(tx.status)) {
      // 离页不等待网络；旧账号代次时不使用新凭据撤销旧事务。
      if (owner === generation()) {
        try {
          api.cancel(tx.id).promise.catch(() => {});
        } catch {
          /* 由后端期限收敛。 */
        }
      }
      state.transaction = null;
    }
  }
  function edit(field: CampusField, value: string) {
    state[field] = value;
    if (state.fieldErrors[field])
      state.fieldErrors = { ...state.fieldErrors, [field]: "" };
  }
  return {
    show,
    hide,
    reset,
    start,
    restart,
    reload,
    edit,
    refresh: () => mutate("refreshing"),
    submit: () => mutate("submitting"),
    query,
    cancel,
    clearSecrets,
    imageError,
  };
}
