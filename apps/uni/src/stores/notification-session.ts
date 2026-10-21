import { DEMO_PARTICIPANT } from "@hehuoda/client-domain/team";
import type { TeamState } from "@hehuoda/client-domain/team-session";

export interface NotificationTarget {
  section: "applications" | "teams";
  teamId: string;
  recordId?: string;
  invitationId?: string;
}
export interface SessionNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  time: number;
  readAt: number | null;
  eventKey?: string;
  target?: NotificationTarget;
}
export function initialNotifications(): SessionNotification[] {
  return [
    {
      id: "announcement-welcome",
      type: "announcement",
      title: "在禾伙搭，找到一起出发的人",
      body: "欢迎来到站内通知。这里展示组队进展与平台公告示例。所有通知仅在当前会话中演示，不代表真实消息投递；刷新或重置会恢复初始示例。",
      time: Date.UTC(2026, 9, 18, 2),
      readAt: null,
    },
    {
      id: "announcement-safety",
      type: "announcement",
      title: "申请、邀请与入队是不同的步骤",
      body: "发出申请或收到邀请不会自动加入队伍，确认邀请后才建立成员关系。请在操作前核对招募条件；阅读通知不会接受邀请或改变成员人数。（固定演示公告）",
      time: Date.UTC(2026, 9, 17, 2),
      readAt: Date.UTC(2026, 9, 17, 3),
    },
  ];
}

/** Only transition metadata is captured, never a second business collection. */
export function captureNotificationBaseline(teams: TeamState) {
  return {
    teamIds: new Set(teams.teams.map((t) => t.id)),
    records: new Map(teams.records.map((r) => [r.id, r.state])),
    memberships: new Set(
      teams.teams
        .filter(
          (t) =>
            !t.dissolved && t.members.some((m) => m.id === DEMO_PARTICIPANT.id),
        )
        .map((t) => t.id),
    ),
  };
}
type Baseline = ReturnType<typeof captureNotificationBaseline>;

export function createNotificationActions(
  state: { notifications: SessionNotification[] },
  teams: TeamState,
  invitationProblem: (
    record: TeamState["records"][number],
    now: number,
  ) => string,
) {
  let sequence = 0;
  const seen = new Set<string>();
  const availability = new Map<string, boolean>();
  function add(
    key: string,
    title: string,
    target: NotificationTarget,
    now: number,
    body: string,
  ) {
    if (seen.has(key)) return;
    seen.add(key);
    state.notifications.push({
      id: `progress-${++sequence}`,
      type: "progress",
      title,
      body,
      time: now,
      readAt: null,
      eventKey: key,
      target,
    });
  }
  function sync(now = Date.now(), baseline = false) {
    for (const record of teams.records) {
      if (
        record.applicantId !== DEMO_PARTICIPANT.id ||
        record.state !== "INVITED"
      )
        continue;
      const invitation = teams.invitations.find(
        (i) => i.applicationId === record.id && i.state === "ACTIVE",
      );
      if (!invitation) continue;
      const problem = invitationProblem(record, now);
      const available = !problem;
      if (!baseline && availability.get(invitation.id) === true && !available) {
        add(
          `${invitation.id}:unavailable`,
          "邀请当前不可确认",
          {
            section: "applications",
            teamId: record.teamId,
            recordId: record.id,
            invitationId: invitation.id,
          },
          now,
          `当前原因：${problem}。请以实时招募条件为准；此提醒不会改变申请或邀请状态。`,
        );
      }
      availability.set(invitation.id, available);
    }
  }
  function recordChanges(before: Baseline, now = Date.now()) {
    for (const record of teams.records) {
      const previous = before.records.get(record.id);
      const team = teams.teams.find((t) => t.id === record.teamId);
      if (!team) continue;
      if (
        !previous &&
        record.applicantId !== DEMO_PARTICIPANT.id &&
        team.members.some((m) => m.id === DEMO_PARTICIPANT.id && m.captain) &&
        !team.dissolved
      ) {
        add(
          `${record.id}:created`,
          "你的队伍收到新申请",
          { section: "teams", teamId: team.id, recordId: record.id },
          now,
          `「${team.title}」收到${record.nickname}的演示申请，请到我的队伍查看。`,
        );
      }
      if (
        !previous ||
        previous === record.state ||
        record.applicantId !== DEMO_PARTICIPANT.id
      )
        continue;
      const invitation = teams.invitations.find(
        (i) => i.applicationId === record.id,
      );
      const title =
        previous === "PENDING" && record.state === "INVITED"
          ? "你的申请收到邀请"
          : previous === "PENDING" && record.state === "REJECTED"
            ? "你的申请未通过"
            : record.state === "REVOKED"
              ? "邀请已撤销"
              : record.state === "INVALID" && previous === "INVITED"
                ? "邀请已失效"
                : "";
      if (title) {
        const key = `${invitation?.id ?? record.id}:${record.state}`;
        add(
          key,
          title,
          {
            section: "applications",
            teamId: team.id,
            recordId: record.id,
            invitationId: invitation?.id,
          },
          now,
          `「${team.title}」的组队进展已变化。请查看当前记录；阅读通知不会处理申请或邀请。`,
        );
      }
    }
    const after = captureNotificationBaseline(teams);
    for (const id of new Set([...before.memberships, ...after.memberships])) {
      if (!before.teamIds.has(id)) continue;
      if (before.memberships.has(id) === after.memberships.has(id)) continue;
      const joined = after.memberships.has(id);
      const team = teams.teams.find((t) => t.id === id);
      add(
        `membership:${id}:${++sequence}`,
        joined ? "你已确认加入队伍" : "你的队伍成员关系已结束",
        { section: "teams", teamId: id },
        now,
        `「${team?.title ?? "原队伍"}」：${joined ? "确认入队已在当前会话生效。" : "你已退出、被移除或队伍已解散，管理入口可能不再可用。"}`,
      );
    }
    sync(now);
  }
  function markRead(id: string, now = Date.now()) {
    const item = state.notifications.find((n) => n.id === id);
    if (item && item.readAt === null) item.readAt = now;
  }
  function markAllRead(now = Date.now()) {
    for (const item of state.notifications) markRead(item.id, now);
  }
  function reset(now = Date.now()) {
    state.notifications = initialNotifications();
    sequence = 0;
    seen.clear();
    availability.clear();
    sync(now, true);
  }
  sync(Date.now(), true);
  return { recordChanges, sync, markRead, markAllRead, reset };
}

export function filterNotifications(
  items: SessionNotification[],
  unread: boolean,
  type: string,
) {
  return items
    .filter((n) => (!unread || n.readAt === null) && (!type || n.type === type))
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}
export function notificationType(type: string) {
  return type === "progress"
    ? "组队进展"
    : type === "announcement"
      ? "平台公告"
      : "其他通知";
}
