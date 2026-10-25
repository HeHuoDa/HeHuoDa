import type {
  CampusPolicy,
  CampusQualification,
  CampusProfile,
  CampusTransaction,
} from "@hehuoda/api-types";
import type { createCampusApi } from "../api/campus-client.ts";
import { RequestError, type PendingRequest } from "../api/http.ts";
import { campusFailure } from "./presentation.ts";

export function initialCampusState() {
  return {
    policy: null as CampusPolicy | null,
    qualification: null as CampusQualification | null,
    profile: null as CampusProfile["profile"],
    transaction: null as CampusTransaction | null,
    consented: false,
    account: "",
    password: "",
    captcha: "",
    pending: "",
    message: "",
    profileError: "",
    uncertain: false,
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
  const requests = new Set<PendingRequest<unknown>>();
  function clearSecrets() {
    state.password = "";
    state.captcha = "";
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
    if (transaction.status !== "waiting") clearSecrets();
    if (transaction.status === "failed")
      state.message = campusFailure(
        new RequestError("http", "", {
          code: `CAMPUS_${transaction.reason?.toUpperCase() ?? "FAILED"}`,
        }),
      );
    else if (transaction.status === "succeeded")
      state.message = "校园账号已验证。返回后请自行确认原操作。";
    else if (transaction.status === "expired")
      state.message = "本次核验已过期，请重新开始。";
    else if (transaction.status === "cancelled")
      state.message = "本次核验已取消，可继续浏览。";
  }
  async function loadDetails(at: number, account: number) {
    await Promise.all([
      (async () => {
        try {
          const v = await tracked(api.status());
          if (current(at, account)) state.qualification = v;
        } catch (e) {
          if (current(at, account)) state.message = campusFailure(e);
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
          if (current(at, account)) state.message = campusFailure(e);
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
    if (current(at, account)) state.pending = "";
  }
  async function start() {
    if (
      !active ||
      state.pending ||
      !state.consented ||
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
      const v = await tracked(api.create(state.policy.version));
      if (current(at, account)) apply(v);
    } catch (e) {
      if (!current(at, account)) return;
      state.message = campusFailure(e);
      if (e instanceof RequestError && e.code === "CAMPUS_CONSENT_MISMATCH") {
        state.consented = false;
        await loadDetails(at, account);
      }
    } finally {
      if (current(at, account)) state.pending = "";
    }
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
      state.message = "验证码或事务已过期，请取消后重新开始。";
      return;
    }
    if (
      kind === "submitting" &&
      (!state.account || !state.password || !state.captcha)
    ) {
      state.message = "请填写账号、密码和图片验证码。";
      return;
    }
    const at = epoch,
      account = generation();
    state.pending = kind;
    state.message = "";
    const body = {
      account: state.account,
      password: state.password,
      captcha: state.captcha,
      challengeVersion: tx.challenge.version,
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
      state.transaction = { ...tx, challenge: undefined };
      state.uncertain = true;
      state.message = campusFailure(e);
    } finally {
      body.password = "";
      body.captcha = "";
      if (current(at, account)) state.pending = "";
    }
    if (current(at, account) && state.uncertain) await query();
  }
  async function cancel() {
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
  return {
    show,
    hide,
    reset,
    start,
    refresh: () => mutate("refreshing"),
    submit: () => mutate("submitting"),
    query,
    cancel,
    clearSecrets,
  };
}
