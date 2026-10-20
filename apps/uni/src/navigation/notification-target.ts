import { DEMO_PARTICIPANT } from "@hehuoda/client-domain/team";
import type {
  TeamState,
  createTeamActions,
} from "@hehuoda/client-domain/team-session";
import type { NotificationTarget } from "../stores/notification-session.ts";
import {
  parseBusinessId,
  parseSingleParam,
  type ProfileSection,
  type RouteQuery,
} from "./params.ts";

type TargetSession = TeamState & {
  sessionRevision: number;
  invitationProblem: ReturnType<typeof createTeamActions>["invitationProblem"];
};
export type TargetResult =
  | { target: NotificationTarget; error?: undefined }
  | { target?: undefined; error: string };

/** Display navigation never grants a role or executes a business action. */
export function resolveNotificationTarget(
  session: TargetSession,
  target: NotificationTarget,
  now = Date.now(),
): TargetResult {
  const team = session.teams.find((t) => t.id === target.teamId);
  if (!team || team.dissolved)
    return { error: "关联队伍已不存在或已解散，无法打开。" };
  const member = team.members.find((m) => m.id === DEMO_PARTICIPANT.id);
  if (target.section === "teams" && !member)
    return { error: "你已不是该队伍的有效成员，无法进入管理详情。" };
  if (target.section === "applications" && !target.recordId)
    return { error: "申请记录参数缺失。" };
  if (target.recordId) {
    const record = session.records.find((r) => r.id === target.recordId);
    if (!record) return { error: "关联申请记录已不存在。" };
    if (record.teamId !== team.id)
      return { error: "申请记录与队伍归属不匹配。" };
    if (
      target.section === "applications" &&
      record.applicantId !== DEMO_PARTICIPANT.id
    )
      return { error: "申请记录不属于当前演示用户。" };
    if (target.section === "teams" && !member?.captain)
      return { error: "你已不再是该队伍的队长，无法查看收到的申请。" };
    if (record.state === "REVOKED" || record.state === "INVALID")
      return {
        error:
          record.state === "REVOKED"
            ? "关联邀请已撤销。"
            : "关联邀请或申请已失效。",
      };
    if (target.invitationId) {
      const invitation = session.invitations.find(
        (i) => i.id === target.invitationId && i.applicationId === record.id,
      );
      if (!invitation) return { error: "关联邀请已不存在。" };
      if (["REVOKED", "INVALID"].includes(invitation.state))
        return { error: "关联邀请已撤销或失效。" };
    }
    if (record.state === "INVITED") {
      const problem = session.invitationProblem(record, now);
      if (problem) return { error: `关联邀请当前不可用：${problem}。` };
    }
  }
  return { target };
}

/** Parse again in the destination, including the session revision carried by notifications. */
export function profileNotificationTarget(
  session: TargetSession,
  section: ProfileSection,
  query: RouteQuery,
  now = Date.now(),
): TargetResult {
  if (section === "profile") return { error: "通知定位分区无效。" };
  if (query.revision !== undefined) {
    const revision = parseSingleParam(query.revision);
    if (revision.issue || revision.value !== String(session.sessionRevision))
      return { error: "会话已重置，原通知定位已失效。" };
  }
  const record =
    query.recordId === undefined ? undefined : parseBusinessId(query.recordId);
  const team =
    query.teamId === undefined ? undefined : parseBusinessId(query.teamId);
  const invitation =
    query.invitationId === undefined
      ? undefined
      : parseBusinessId(query.invitationId);
  if (record?.issue || team?.issue || invitation?.issue)
    return { error: "资源定位参数无效或冲突。" };
  const recordId = record?.value;
  const teamId =
    team?.value ?? session.records.find((r) => r.id === recordId)?.teamId;
  if (!teamId) return { error: "关联队伍或申请已不存在，或定位参数缺失。" };
  return resolveNotificationTarget(
    session,
    { section, teamId, recordId, invitationId: invitation?.value },
    now,
  );
}

/** Index based anchor is safe for platform selectors; identity validation still uses business IDs. */
export function notificationAnchor(
  session: TeamState,
  target: NotificationTarget,
) {
  return target.recordId
    ? `${target.section === "teams" ? "incoming" : "application"}-target-${session.records.findIndex((r) => r.id === target.recordId)}`
    : `team-target-${session.teams.findIndex((t) => t.id === target.teamId)}`;
}
