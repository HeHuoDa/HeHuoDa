import {
  applicationStatus,
  DEMO_PARTICIPANT,
  type Role,
} from "@hehuoda/client-domain/team";
import type {
  TeamState,
  createTeamActions,
} from "@hehuoda/client-domain/team-session";

type TeamSession = TeamState & ReturnType<typeof createTeamActions>;
export type TeamDetailAction =
  "apply" | "report" | "withdraw" | "accept" | "decline";
export function initialTeamDetailState() {
  return {
    id: "",
    now: Date.now(),
    action: null as TeamDetailAction | null,
    recordId: "",
    role: "",
    note: "",
    error: "",
    errorTarget: "",
    feedback: "",
  };
}
export type TeamDetailState = ReturnType<typeof initialTeamDetailState>;

/** Detail actions share the app session. A confirmation captures its record ID,
 * while submission rechecks the live team and invitation through domain actions. */
export function createTeamDetailController(
  state: TeamDetailState,
  session: TeamSession,
  clock = () => Date.now(),
) {
  let selectedTeam: TeamState["teams"][number] | undefined;
  let selectedRecord: TeamState["records"][number] | undefined;
  function syncClock() {
    state.now = clock();
  }
  function view() {
    const team = session.teams.find((t) => t.id === state.id && !t.dissolved);
    const records = session.records.filter(
      (a) => a.teamId === state.id && a.applicantId === DEMO_PARTICIPANT.id,
    );
    const record =
      records.find((a) => ["PENDING", "INVITED"].includes(a.state)) ??
      records.at(-1);
    const hasOpenApplication =
      !!record && ["PENDING", "INVITED"].includes(record.state);
    const invited = record?.state === "INVITED";
    const status = team
      ? applicationStatus(team, state.now, hasOpenApplication)
      : { available: false, label: "队伍不存在" };
    if (status.available && !team?.roles.length) {
      status.available = false;
      status.label = "暂无角色需求";
    }
    return {
      team,
      record,
      canWithdraw: hasOpenApplication,
      invited,
      status,
      invitationProblem: invited
        ? session.invitationProblem(record, state.now)
        : "",
    };
  }
  function cancel() {
    state.action = null;
    state.recordId =
      state.role =
      state.note =
      state.error =
      state.errorTarget =
        "";
    selectedTeam = selectedRecord = undefined;
  }
  function load(id: string) {
    cancel();
    state.id = id;
    state.feedback = "";
    syncClock();
  }
  function begin(action: TeamDetailAction) {
    syncClock();
    const current = view();
    if (
      !current.team ||
      (action === "apply" && !current.status.available) ||
      (action === "withdraw" && !current.canWithdraw) ||
      (["accept", "decline"].includes(action) && !current.invited) ||
      (action === "accept" && !!current.invitationProblem)
    )
      return;
    cancel();
    selectedTeam = current.team;
    selectedRecord = current.record;
    state.action = action;
    state.recordId = current.record?.id ?? "";
    state.role = action === "apply" ? (current.team.roles[0] ?? "") : "";
    state.feedback = "";
  }
  function submit() {
    const action = state.action;
    if (!action) return;
    syncClock();
    const current = view();
    if (!current.team || current.team !== selectedTeam) {
      cancel();
      state.feedback = "操作失败：队伍已失效，请返回列表。";
      return;
    }
    if (action === "apply" || action === "report") {
      const choices =
        action === "apply"
          ? current.team.roles
          : ["信息不实", "不当内容", "其他问题"];
      if (
        !choices.includes(state.role as Role) ||
        state.note.trim().length > 500
      ) {
        state.error = "请选择有效的角色或举报原因；补充说明不能超过 500 字。";
        state.errorTarget =
          state.note.trim().length > 500
            ? "team-action-note-field"
            : "team-action-role-field";
        return;
      }
      state.feedback =
        action === "report"
          ? "演示举报已结束：没有外发，没有实际进入审核。"
          : session.apply(state.id, state.role as Role, state.note, state.now)
            ? "演示申请已创建，状态为待处理；成员人数不变，没有送达真实队长。"
            : "当前无法申请，请核对招募状态、角色需求及申请记录。";
    } else {
      // Never redirect a stale confirmation to a newer application for this team.
      state.feedback =
        session.records.find((a) => a.id === state.recordId) !== selectedRecord
          ? "操作失败：申请记录已变化，请重新操作。"
          : session.respond(state.recordId, action, state.now);
    }
    cancel();
  }
  function reset() {
    cancel();
    session.reset();
    syncClock();
    state.feedback = "已重置会话内演示。";
  }
  return { view, load, begin, submit, cancel, reset, syncClock };
}
