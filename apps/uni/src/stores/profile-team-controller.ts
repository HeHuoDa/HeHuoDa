import {
  DEMO_PARTICIPANT,
  draftFromTeam,
  type Team,
  type TeamApplication,
  type TeamDraft,
} from "@hehuoda/client-domain/team";
import type {
  TeamState,
  createTeamActions,
} from "@hehuoda/client-domain/team-session";
import type { ProfileSection } from "../navigation/params";

type TeamSession = TeamState & ReturnType<typeof createTeamActions>;
type TeamMember = Team["members"][number];

export type ProfileManageAction =
  "open" | "paused" | "closed" | "transfer" | "dissolve" | "leave" | "remove";
export type ProfileProcessAction = "invite" | "reject" | "revoke";
export type ProfileRespondAction = "withdraw" | "accept" | "decline";

/**
 * 确认上下文在打开时固定目标，提交时再按对象身份与实时状态复核。
 * 标题与后果文案在打开时生成，提交时不重新拼接。
 */
export type ProfileTeamConfirmation =
  | {
      kind: "manage";
      action: ProfileManageAction;
      teamId: string;
      memberId: string;
      title: string;
      description: string;
    }
  | {
      kind: "process";
      action: ProfileProcessAction;
      teamId: string;
      recordId: string;
      title: string;
      description: string;
    }
  | {
      kind: "respond";
      action: ProfileRespondAction;
      teamId: string;
      recordId: string;
      title: string;
      description: string;
    };

export function initialProfileTeamState() {
  return {
    section: "profile" as ProfileSection,
    /** 选中队伍只影响本页展示；权限仍由派生成员关系决定。 */
    selectedId: "",
    now: Date.now(),
    draft: null as TeamDraft | null,
    errors: {} as Record<string, string>,
    errorTarget: "",
    confirm: null as ProfileTeamConfirmation | null,
    successor: "",
    saving: false,
    feedback: "",
  };
}
export type ProfileTeamState = ReturnType<typeof initialProfileTeamState>;

/** 编辑表单自上而下的字段顺序，用于选择可定位的首个错误。 */
const editFieldOrder = [
  "type",
  "title",
  "goal",
  "progress",
  "skills",
  "location",
  "mode",
  "roles",
  "capacity",
  "deadline",
  "competition",
  "trackId",
] as const;

const manageCopy: Record<
  ProfileManageAction,
  { label: string; description: string }
> = {
  open: {
    label: "恢复招募",
    description:
      "恢复后找队友页面重新显示招募中；此前失效的申请与邀请不会恢复。",
  },
  paused: {
    label: "暂停招募",
    description: "暂停后找队友页面不再接受新申请，待处理的申请与邀请保留。",
  },
  closed: {
    label: "关闭招募",
    description:
      "关闭后不能暂停或恢复招募；待处理的申请与邀请将失效，成员关系保留。",
  },
  transfer: {
    label: "移交队长",
    description: "移交后你立即成为普通成员并失去管理权限，此后可以退出队伍。",
  },
  remove: {
    label: "移除成员",
    description: "移除后该成员的联系方式授权立即失效，不再属于这支队伍。",
  },
  dissolve: {
    label: "解散队伍",
    description: "解散后成员关系与联系方式授权被清除，待处理的申请与邀请失效。",
  },
  leave: {
    label: "退出队伍",
    description: "退出后不再属于这支队伍，联系方式授权立即失效。",
  },
};

const processCopy: Record<
  ProfileProcessAction,
  { label: string; description: string }
> = {
  invite: {
    label: "邀请申请者",
    description:
      "邀请只把申请标记为已邀请并生成邀请，不预占名额、不增加成员；不会送达真实用户。",
  },
  reject: {
    label: "拒绝申请",
    description: "拒绝后申请进入终态，不能再次处理，队伍人数不变。",
  },
  revoke: {
    label: "撤销邀请",
    description: "撤销后受邀者无法再确认入队，历史记录保留，队伍人数不变。",
  },
};

const respondCopy: Record<
  ProfileRespondAction,
  { label: string; description: string }
> = {
  withdraw: {
    label: "撤回申请",
    description: "撤回后申请进入终态，不能再次处理，队伍人数不变。",
  },
  accept: {
    label: "确认入队",
    description:
      "确认时会重新检查邀请、队伍、名额、截止与角色需求；只有成功才增加成员并占用名额。",
  },
  decline: {
    label: "拒绝邀请",
    description: "拒绝后邀请失效，队伍人数不变。",
  },
};

/**
 * 个人中心队伍管理与申请邀请的界面状态。
 *
 * 队伍、申请、邀请、成员与授权仍由共享会话持有；这里只保存分区、选中队伍、
 * 编辑草稿、字段错误、确认上下文与反馈，不建立第二套业务集合。
 */
export function createProfileTeamController(
  state: ProfileTeamState,
  session: TeamSession,
  clock = () => Date.now(),
) {
  // 打开编辑或确认时固定对象身份，提交前与实时会话比对，避免重置后误操作新对象。
  let editTarget: Team | undefined;
  let confirmTeam: Team | undefined;
  let confirmRecord: TeamApplication | undefined;
  let confirmMember: TeamMember | undefined;

  function syncClock() {
    state.now = clock();
  }
  function isCaptain(team: Team | undefined) {
    return !!team?.members.some(
      (m) => m.id === DEMO_PARTICIPANT.id && m.captain,
    );
  }
  function mine() {
    return session.teams.filter(
      (t) =>
        !t.dissolved && t.members.some((m) => m.id === DEMO_PARTICIPANT.id),
    );
  }
  function selectedTeam() {
    return mine().find((t) => t.id === state.selectedId);
  }
  /** 选中队伍的全部申请与发出的邀请；终态记录同样保留。 */
  function teamRecords(team: Team | undefined) {
    return team ? session.records.filter((a) => a.teamId === team.id) : [];
  }
  function ownRecords() {
    return session.records.filter((a) => a.applicantId === DEMO_PARTICIPANT.id);
  }
  function activeInvitation(record: TeamApplication) {
    return session.invitations.some(
      (i) => i.applicationId === record.id && i.state === "ACTIVE",
    );
  }
  function resetCaptures() {
    editTarget = confirmTeam = confirmRecord = confirmMember = undefined;
  }
  /** 关闭编辑、确认与旧操作上下文；不动业务集合。 */
  function clearTransient() {
    state.draft = null;
    state.errors = {};
    state.errorTarget = "";
    state.confirm = null;
    state.successor = "";
    state.saving = false;
    resetCaptures();
  }
  function switchSection(next: ProfileSection) {
    if (state.section === next) return;
    state.section = next;
    state.selectedId = "";
    state.feedback = "";
    clearTransient();
  }
  function select(teamId: string) {
    clearTransient();
    state.feedback = "";
    state.selectedId = mine().some((t) => t.id === teamId) ? teamId : "";
  }
  function beginEdit() {
    const team = selectedTeam();
    if (!team || !isCaptain(team)) return false;
    clearTransient();
    state.feedback = "";
    editTarget = team;
    state.draft = draftFromTeam(team);
    return true;
  }
  function cancelEdit() {
    editTarget = undefined;
    state.draft = null;
    state.errors = {};
    state.errorTarget = "";
  }
  function saveEdit() {
    const draft = state.draft;
    const target = editTarget;
    if (!draft || !target || state.saving) return false;
    const live = session.teams.find((t) => t.id === target.id);
    if (live !== target) {
      cancelEdit();
      state.feedback = "操作失败：队伍已变化，请重新选择后再编辑。";
      return false;
    }
    state.saving = true;
    try {
      syncClock();
      const result = session.editTeam(target.id, draft, state.now);
      state.errors = result.errors;
      if (result.ok) {
        cancelEdit();
        state.feedback = result.message;
        return true;
      }
      // 首错按表单视觉顺序选择，不依赖 validateDraft 的键插入顺序。
      const first =
        editFieldOrder.find((key) => result.errors[key]) ??
        Object.keys(result.errors)[0] ??
        "";
      state.errorTarget = first ? `profile-team-${first}-field` : "";
      state.feedback = result.message;
      return false;
    } finally {
      state.saving = false;
    }
  }
  function beginManage(action: ProfileManageAction, memberId = "") {
    const team = selectedTeam();
    if (!team) return false;
    const captain = isCaptain(team);
    let member: TeamMember | undefined;
    if (action === "leave") {
      if (captain) return false;
    } else {
      if (!captain) return false;
      if (team.state === "closed" && (action === "open" || action === "paused"))
        return false;
      if (action === "transfer" || action === "remove") {
        member = team.members.find((m) => m.id === memberId && !m.captain);
        if (!member) return false;
      }
    }
    clearTransient();
    state.feedback = "";
    confirmTeam = team;
    confirmMember = member;
    const copy = manageCopy[action];
    // 移交与移除的目标是成员，确认标题必须写明是谁，而不是只写队伍。
    const target = member ? member.nickname : team.title;
    state.confirm = {
      kind: "manage",
      action,
      teamId: team.id,
      memberId: action === "transfer" || action === "remove" ? memberId : "",
      title: `确认${copy.label}「${target}」？`,
      description: copy.description,
    };
    // 确认期间保留已选成员，取消后仍能直接重试。
    if (action === "transfer") state.successor = memberId;
    return true;
  }
  function beginProcess(recordId: string, action: ProfileProcessAction) {
    const record = session.records.find((a) => a.id === recordId);
    const team =
      record &&
      session.teams.find((t) => t.id === record.teamId && !t.dissolved);
    if (!record || !team || !isCaptain(team)) return false;
    if (action === "revoke") {
      if (record.state !== "INVITED" || !activeInvitation(record)) return false;
    } else if (record.state !== "PENDING") return false;
    clearTransient();
    state.feedback = "";
    confirmTeam = team;
    confirmRecord = record;
    const copy = processCopy[action];
    state.confirm = {
      kind: "process",
      action,
      teamId: team.id,
      recordId: record.id,
      title: `确认${copy.label}「${record.nickname}」？`,
      description: copy.description,
    };
    return true;
  }
  function beginRespond(recordId: string, action: ProfileRespondAction) {
    const record = session.records.find(
      (a) => a.id === recordId && a.applicantId === DEMO_PARTICIPANT.id,
    );
    if (!record) return false;
    syncClock();
    if (action === "withdraw") {
      if (!["PENDING", "INVITED"].includes(record.state)) return false;
    } else {
      if (record.state !== "INVITED" || !activeInvitation(record)) return false;
      if (action === "accept" && session.invitationProblem(record, state.now))
        return false;
    }
    clearTransient();
    state.feedback = "";
    confirmTeam = session.teams.find((t) => t.id === record.teamId);
    confirmRecord = record;
    const copy = respondCopy[action];
    state.confirm = {
      kind: "respond",
      action,
      teamId: record.teamId,
      recordId: record.id,
      title: `确认${copy.label}？`,
      description: copy.description,
    };
    return true;
  }
  function cancelConfirm() {
    confirmTeam = confirmRecord = confirmMember = undefined;
    state.confirm = null;
  }
  function fail(message: string) {
    state.confirm = null;
    state.feedback = message;
    confirmTeam = confirmRecord = confirmMember = undefined;
  }
  function finish(message: string) {
    const teamId = state.confirm?.teamId;
    state.confirm = null;
    state.feedback = message;
    confirmTeam = confirmRecord = confirmMember = undefined;
    if (teamId && !mine().some((t) => t.id === teamId)) state.selectedId = "";
  }
  function submit() {
    const confirm = state.confirm;
    if (!confirm || state.saving) return;
    syncClock();
    state.saving = true;
    try {
      if (confirm.kind === "manage") {
        const team = confirmTeam;
        if (!team || session.teams.find((t) => t.id === team.id) !== team)
          return fail("操作失败：队伍已变化，请重新选择。");
        if (confirmMember) {
          const current = team.members.find((m) => m.id === confirmMember?.id);
          if (current !== confirmMember)
            return fail("操作失败：成员关系已变化，请重新选择。");
        }
        finish(
          session.manage(
            team.id,
            confirm.action,
            confirm.memberId || undefined,
          ),
        );
        return;
      }
      const record = confirmRecord;
      if (!record || session.records.find((a) => a.id === record.id) !== record)
        return fail("操作失败：申请记录已变化，请重新操作。");
      if (confirm.kind === "process") {
        const team = confirmTeam;
        if (!team || session.teams.find((t) => t.id === team.id) !== team)
          return fail("操作失败：队伍已变化，请重新选择。");
        finish(
          session.processApplication(record.id, confirm.action, state.now),
        );
        return;
      }
      finish(session.respond(record.id, confirm.action, state.now));
    } finally {
      state.saving = false;
    }
  }
  /** 会话统一重置后的清理；不反向调用 session.reset()，避免递归。 */
  function reset() {
    state.selectedId = "";
    state.feedback = "";
    clearTransient();
    syncClock();
  }
  function resetAll() {
    // 先丢弃本页上下文，再重置会话；注册的清理回调可能再次调用 reset()。
    reset();
    session.reset();
    state.feedback = "队伍、申请、邀请、资料与联系方式授权已重置为初始示例。";
  }
  return {
    state,
    syncClock,
    isCaptain,
    mine,
    selectedTeam,
    teamRecords,
    ownRecords,
    switchSection,
    select,
    beginEdit,
    cancelEdit,
    saveEdit,
    beginManage,
    beginProcess,
    beginRespond,
    submit,
    cancelConfirm,
    clearTransient,
    reset,
    resetAll,
  };
}

export type ProfileTeamController = ReturnType<
  typeof createProfileTeamController
>;
