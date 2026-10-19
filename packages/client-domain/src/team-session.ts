import {
  initialTeams,
  initialApplications,
  initialInvitations,
  validateDraft,
  DEMO_PARTICIPANT,
  deadlineInstant,
  applicationStatus,
  recruitmentStatus,
  type Team,
  type TeamDraft,
  type TeamApplication,
  type TeamInvitation,
  type Role,
  type ApplicationState,
} from "./team.ts";
export interface TeamState {
  teams: Team[];
  records: TeamApplication[];
  invitations: TeamInvitation[];
  contactAuthorizations: Record<string, boolean>;
}
export function initialTeamState(now = Date.now()): TeamState {
  return {
    teams: initialTeams(now),
    records: initialApplications(),
    invitations: initialInvitations(),
    contactAuthorizations: {},
  };
}
export function pendingApplications(state: TeamState) {
  return Object.fromEntries(
    state.records
      .filter(
        (a) =>
          a.applicantId === DEMO_PARTICIPANT.id &&
          ["PENDING", "INVITED"].includes(a.state),
      )
      .map((a) => [a.teamId, { role: a.role, note: a.note }]),
  );
}
export function createTeamActions(
  state: TeamState,
  profile: { readonly contactShared: boolean; reset(): void },
) {
  let sequence = 0;
  function reset() {
    state.teams = initialTeams();
    state.records = initialApplications();
    state.invitations = initialInvitations();
    state.contactAuthorizations = {};
    profile.reset();
  }
  function publish(draft: TeamDraft, now = Date.now()) {
    if (Object.keys(validateDraft(draft, now)).length) return undefined;
    const team: Team = {
      id: "session-" + ++sequence,
      title: draft.title.trim(),
      type: draft.type as Team["type"],
      goal: draft.goal.trim(),
      progress: draft.progress.trim(),
      roles: [...draft.roles],
      skills: draft.skills.trim(),
      mode: draft.mode as Team["mode"],
      location: draft.location.trim(),
      capacity: Number(draft.capacity),
      deadline: new Date(deadlineInstant(draft.deadline)).toISOString(),
      publishedAt: new Date(now).toISOString(),
      state: "open",
      members: [{ ...DEMO_PARTICIPANT, role: "项目统筹", captain: true }],
      competition: draft.competition,
      trackId: draft.trackId || undefined,
    };
    state.teams.unshift(team);
    return team;
  }
  function apply(id: string, role: Role, note: string, now = Date.now()) {
    const team = state.teams.find((t) => t.id === id);
    if (
      !team ||
      !applicationStatus(team, now, !!pendingApplications(state)[id])
        .available ||
      !team.roles.includes(role) ||
      note.trim().length > 500
    )
      return false;
    state.records.push({
      id: "application-" + ++sequence,
      teamId: id,
      applicantId: DEMO_PARTICIPANT.id,
      nickname: DEMO_PARTICIPANT.nickname,
      role,
      note: note.trim(),
      state: "PENDING",
    });
    return true;
  }
  function captainTeam(id: string) {
    return state.teams.find(
      (t) =>
        t.id === id &&
        !t.dissolved &&
        t.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain),
    );
  }
  function activeInvitation(a: TeamApplication) {
    return state.invitations.find(
      (i) => i.applicationId === a.id && i.state === "ACTIVE",
    );
  }
  function finish(a: TeamApplication, state: ApplicationState) {
    const invitation = activeInvitation(a);
    if (invitation)
      invitation.state =
        state === "ACCEPTED"
          ? "ACCEPTED"
          : state === "DECLINED"
            ? "DECLINED"
            : state === "REVOKED"
              ? "REVOKED"
              : "INVALID";
    a.state = state;
  }
  function invitationProblem(a: TeamApplication, now = Date.now()) {
    const team = state.teams.find((t) => t.id === a.teamId);
    if (
      a.state !== "INVITED" ||
      !activeInvitation(a) ||
      !team ||
      team.dissolved
    )
      return "邀请已失效";
    if (team.members.some((m) => m.id === a.applicantId))
      return "已经是队伍成员";
    const status = recruitmentStatus(team, now);
    if (!status.available) return status.label;
    if (!team.roles.includes(a.role)) return "角色需求已变更";
    return "";
  }
  function processApplication(
    id: string,
    action: "invite" | "reject" | "revoke",
    now = Date.now(),
  ) {
    const a = state.records.find((a) => a.id === id);
    const t = a && captainTeam(a.teamId);
    if (!a || !t) return "操作失败：仅有效队长可以处理申请。";
    if (action === "revoke" && a.state === "INVITED" && activeInvitation(a)) {
      finish(a, "REVOKED");
      return "演示邀请已撤销。";
    }
    if (a.state !== "PENDING") return "操作失败：申请状态已变化。";
    if (action === "reject") {
      finish(a, "REJECTED");
      return "演示申请已拒绝。";
    }
    if (
      action !== "invite" ||
      !recruitmentStatus(t, now).available ||
      !t.roles.includes(a.role)
    )
      return "操作失败：当前招募条件不允许邀请。";
    a.state = "INVITED";
    state.invitations.push({
      id: "invitation-" + ++sequence,
      applicationId: a.id,
      state: "ACTIVE",
    });
    return "演示邀请已发出，不预占名额，也未真实送达。";
  }
  function respond(
    id: string,
    action: "withdraw" | "accept" | "decline",
    now = Date.now(),
  ) {
    const a = state.records.find(
      (a) => a.id === id && a.applicantId === DEMO_PARTICIPANT.id,
    );
    if (!a) return "操作失败：找不到自己的申请。";
    if (action === "withdraw" && ["PENDING", "INVITED"].includes(a.state)) {
      finish(a, "WITHDRAWN");
      return "演示申请已撤回。";
    }
    if (a.state !== "INVITED" || !activeInvitation(a))
      return "操作失败：邀请已失效或已处理。";
    if (action === "decline") {
      finish(a, "DECLINED");
      return "演示邀请已拒绝。";
    }
    const problem = invitationProblem(a, now);
    if (problem) return "操作失败：" + problem + "，未增加成员。";
    const t = state.teams.find((t) => t.id === a.teamId)!;
    t.members.push({
      id: a.applicantId,
      nickname: a.nickname,
      role: a.role,
      captain: false,
    });
    finish(a, "ACCEPTED");
    state.records
      .filter(
        (other) =>
          other.id !== a.id &&
          other.teamId === t.id &&
          other.applicantId === a.applicantId &&
          ["PENDING", "INVITED"].includes(other.state),
      )
      .forEach((other) => finish(other, "INVALID"));
    return "演示入队已确认，仅更新会话内成员关系。";
  }
  function editTeam(id: string, draft: TeamDraft, now = Date.now()) {
    const t = captainTeam(id);
    const errors = validateDraft(draft, now);
    if (t && Number(draft.capacity) < t.members.length)
      errors.capacity = "容量不能小于当前成员人数。";
    if (!t || Object.keys(errors).length)
      return { ok: false, errors, message: "操作失败：请核对权限与招募字段。" };
    Object.assign(t, {
      title: draft.title.trim(),
      type: draft.type,
      goal: draft.goal.trim(),
      progress: draft.progress.trim(),
      roles: [...draft.roles],
      skills: draft.skills.trim(),
      mode: draft.mode,
      location: draft.location.trim(),
      capacity: Number(draft.capacity),
      deadline: new Date(deadlineInstant(draft.deadline)).toISOString(),
    });
    return {
      ok: true,
      errors,
      message: "演示招募已更新，找队友页面同步显示。",
    };
  }
  function manage(
    id: string,
    action:
      | "open"
      | "paused"
      | "closed"
      | "transfer"
      | "dissolve"
      | "leave"
      | "remove",
    memberId?: string,
  ) {
    const t = state.teams.find((t) => t.id === id && !t.dissolved);
    const me = t?.members.find((m) => m.id === DEMO_PARTICIPANT.id);
    if (!t || !me) return "操作失败：有效成员关系已失效。";
    if (action === "leave") {
      if (me.captain) return "操作失败：队长须先移交或解散，不能直接退出。";
      t.members = t.members.filter((m) => m.id !== me.id);
      delete state.contactAuthorizations[me.id];
    } else {
      if (!me.captain) return "操作失败：仅队长可执行此操作。";
      if (t.state === "closed" && (action === "open" || action === "paused"))
        return "操作失败：招募已关闭，不能暂停或恢复。";
      if (action === "transfer") {
        const next = t.members.find((m) => m.id === memberId && m.id !== me.id);
        if (!next) return "操作失败：请选择其他有效成员。";
        me.captain = false;
        next.captain = true;
      } else if (action === "remove") {
        const member = t.members.find((m) => m.id === memberId && !m.captain);
        if (!member) return "操作失败：请选择普通成员。";
        t.members = t.members.filter((m) => m.id !== memberId);
        delete state.contactAuthorizations[member.id];
      } else if (action === "dissolve") {
        t.dissolved = true;
        t.state = "closed";
        t.members.forEach((m) => delete state.contactAuthorizations[m.id]);
        t.members = [];
      } else t.state = action;
    }
    if (action === "dissolve" || action === "closed")
      state.records
        .filter(
          (a) => a.teamId === id && ["PENDING", "INVITED"].includes(a.state),
        )
        .forEach((a) => finish(a, "INVALID"));
    return "演示操作已完成，仅在当前会话内生效。";
  }
  function canViewContact(
    teamId: string,
    ownerId: string,
    viewerId = DEMO_PARTICIPANT.id,
  ) {
    const t = state.teams.find((t) => t.id === teamId && !t.dissolved);
    const authorized =
      ownerId === DEMO_PARTICIPANT.id
        ? profile.contactShared
        : state.contactAuthorizations[ownerId] === true;
    return (
      !!t &&
      authorized &&
      t.members.some((m) => m.id === ownerId) &&
      t.members.some((m) => m.id === viewerId)
    );
  }
  return {
    reset,
    publish,
    apply,
    processApplication,
    respond,
    invitationProblem,
    editTeam,
    manage,
    canViewContact,
  };
}
