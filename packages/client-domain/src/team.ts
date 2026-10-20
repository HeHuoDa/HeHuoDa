import type { CompetitionDetail } from "@hehuoda/api-types";
import type { Query } from "./query.ts";
import { formatBeijingTime } from "./time.ts";
export const projectTypes = {
  competition: "比赛",
  course: "课程项目",
  innovation: "大创",
  other: "其他学习项目",
};
export const roleOptions = [
  "编程",
  "调研",
  "设计",
  "建模",
  "答辩",
  "其他",
] as const;
export const cooperationModes = {
  online: "线上",
  offline: "线下",
  hybrid: "混合",
};
export type Role = (typeof roleOptions)[number];
export const DEMO_PARTICIPANT = {
  id: "demo-student",
  nickname: "禾小苗（演示参与者）",
};
export const TEAM_PAGE_SIZE = 4;
export type Team = {
  id: string;
  title: string;
  type: keyof typeof projectTypes;
  goal: string;
  progress: string;
  roles: Role[];
  skills: string;
  mode: keyof typeof cooperationModes;
  location: string;
  capacity: number;
  deadline: string;
  publishedAt: string;
  state: "open" | "paused" | "closed";
  dissolved?: boolean;
  members: { id: string; nickname: string; role: string; captain: boolean }[];
  competition?: CompetitionDetail;
  trackId?: string;
};
export type TeamDraft = {
  title: string;
  type: string;
  goal: string;
  progress: string;
  roles: Role[];
  skills: string;
  mode: string;
  location: string;
  capacity: string;
  deadline: string;
  competition?: CompetitionDetail;
  trackId: string;
};
export function initialTeams(now = Date.now()): Team[] {
  const titles = [
    "校园植物观察图鉴",
    "课程项目：校园节能看板",
    "大创：茶园土壤研究",
    "乡村影像与故事",
    "校园活动协作工具",
    "低碳生活数据研究",
    "植物摄影小组",
    "学习资料整理计划",
  ];
  return titles.map((title, i) => ({
    id: "demo-" + (i + 1),
    title,
    type: (["other", "course", "innovation", "other"] as const)[i % 4]!,
    goal: [
      "一起记录校园植物，制作可检索的图鉴。希望伙伴愿意观察、整理资料并分享所长。",
      "从校园真实需求出发，完成一个可展示的学习项目，按周交流进度。",
    ][i % 2]!,
    progress: "已完成选题和初步资料整理，正在寻找伙伴细化分工。",
    roles: i % 2 ? ["编程", "建模"] : ["调研", "设计"],
    skills:
      i % 2
        ? "熟悉基础编程或表格分析，愿意一起学习。"
        : "愿意查阅文献、整理观察记录，设计经验加分。",
    mode: (["hybrid", "online", "offline"] as const)[i % 3]!,
    location: i % 3 === 1 ? "" : "雅安校区，具体地点共同商议",
    capacity: i === 4 ? 2 : 5,
    deadline: new Date(now + (i === 5 ? -1 : 14 + i) * 86400000).toISOString(),
    publishedAt: new Date(now - Math.floor(i / 2) * 3600000).toISOString(),
    state: i === 2 ? "paused" : i === 3 ? "closed" : "open",
    members: [
      {
        id: i === 6 ? DEMO_PARTICIPANT.id : "captain-" + i,
        nickname: i === 6 ? DEMO_PARTICIPANT.nickname : "演示队长 " + (i + 1),
        role: "项目统筹",
        captain: true,
      },
      {
        id: i === 7 ? DEMO_PARTICIPANT.id : "member-" + i,
        nickname: i === 7 ? DEMO_PARTICIPANT.nickname : "演示伙伴 " + (i + 1),
        role: "资料整理",
        captain: false,
      },
    ],
  }));
}
export function recruitmentStatus(team: Team, now: number) {
  if (team.dissolved) return { available: false, label: "已解散" };
  if (team.state === "closed") return { available: false, label: "已关闭" };
  if (team.state === "paused") return { available: false, label: "已暂停" };
  if (Date.parse(team.deadline) <= now)
    return { available: false, label: "已截止" };
  if (team.members.length >= team.capacity)
    return { available: false, label: "已满员" };
  return { available: true, label: "招募中" };
}
export function applicationStatus(team: Team, now: number, applied: boolean) {
  const member = team.members.find((m) => m.id === DEMO_PARTICIPANT.id);
  if (member)
    return {
      available: false,
      label: member.captain ? "你是演示队长" : "你已是演示成员",
    };
  if (applied) return { available: false, label: "演示申请待处理" };
  return recruitmentStatus(team, now);
}
export const teamTime = (value: string) =>
  formatBeijingTime(value) + "（北京时间）";
export function deadlineInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(value + ":00+08:00");
  if (!Number.isFinite(parsed)) return NaN;
  return new Date(parsed + 8 * 3600000).toISOString().slice(0, 16) === value
    ? parsed
    : NaN;
}
export function validateDraft(
  d: TeamDraft,
  now: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Object.hasOwn(projectTypes, d.type)) errors.type = "请选择项目类型。";
  if (d.title.trim().length < 2 || d.title.trim().length > 60)
    errors.title = "标题需为 2–60 字。";
  if (d.goal.trim().length < 10 || d.goal.trim().length > 2000)
    errors.goal = "目标介绍需为 10–2000 字。";
  if (d.progress.trim().length > 500)
    errors.progress = "当前进度不能超过 500 字。";
  if (!d.roles.length || d.roles.some((r) => !roleOptions.includes(r)))
    errors.roles = "请至少选择一个角色。";
  if (d.skills.trim().length > 500)
    errors.skills = "技能与职责不能超过 500 字。";
  if (!Object.hasOwn(cooperationModes, d.mode))
    errors.mode = "请选择合作方式。";
  if (d.mode !== "online" && !d.location.trim())
    errors.location = "请说明线下合作地点。";
  if (d.location.trim().length > 200)
    errors.location = "地点说明不能超过 200 字。";
  if (
    !/^\d+$/.test(d.capacity) ||
    Number(d.capacity) < 2 ||
    Number(d.capacity) > 20
  )
    errors.capacity = "队伍容量需为 2–20 的整数，包含队长。";
  if (
    !Number.isFinite(deadlineInstant(d.deadline)) ||
    deadlineInstant(d.deadline) <= now
  )
    errors.deadline = "截止时间必须晚于当前时刻（北京时间）。";
  if (d.type === "competition" && !d.competition?.id.trim())
    errors.competition = "比赛项目请选择有效的比赛届次。";
  if (d.trackId && !d.competition?.tracks.some((t) => t.id === d.trackId))
    errors.trackId = "赛道必须属于所选比赛届次。";
  return errors;
}
export const emptyDraft = (): TeamDraft => ({
  title: "",
  type: "",
  goal: "",
  progress: "",
  roles: [],
  skills: "",
  mode: "",
  location: "",
  capacity: "5",
  deadline: "",
  trackId: "",
});
export const applicationLabels = {
  PENDING: "待处理",
  INVITED: "已邀请",
  ACCEPTED: "已入队",
  REJECTED: "申请已拒绝",
  WITHDRAWN: "已撤回",
  DECLINED: "邀请已拒绝",
  REVOKED: "邀请已撤销",
  INVALID: "已失效",
};
export type ApplicationState = keyof typeof applicationLabels;
export type TeamApplication = {
  id: string;
  teamId: string;
  applicantId: string;
  nickname: string;
  role: Role;
  note: string;
  state: ApplicationState;
};
export type TeamInvitation = {
  id: string;
  applicationId: string;
  state: "ACTIVE" | "ACCEPTED" | "DECLINED" | "REVOKED" | "INVALID";
};
export function initialApplications(): TeamApplication[] {
  return [
    {
      id: "own-pending",
      teamId: "demo-3",
      applicantId: DEMO_PARTICIPANT.id,
      nickname: DEMO_PARTICIPANT.nickname,
      role: "调研",
      note: "等待演示队长处理",
      state: "PENDING",
    },
    {
      id: "own-accepted",
      teamId: "demo-8",
      applicantId: DEMO_PARTICIPANT.id,
      nickname: DEMO_PARTICIPANT.nickname,
      role: "编程",
      note: "已确认的入队示例",
      state: "ACCEPTED",
    },
    {
      id: "incoming-1",
      teamId: "demo-7",
      applicantId: "applicant-1",
      nickname: "演示申请者一",
      role: "调研",
      note: "愿意共同整理植物记录。",
      state: "PENDING",
    },
    {
      id: "incoming-2",
      teamId: "demo-7",
      applicantId: "applicant-2",
      nickname: "演示申请者二",
      role: "设计",
      note: "希望参与图鉴设计。",
      state: "INVITED",
    },
    ...(
      [
        "INVITED",
        "REJECTED",
        "WITHDRAWN",
        "DECLINED",
        "REVOKED",
        "INVALID",
      ] as const
    ).map((state, i) => ({
      id: "history-" + i,
      teamId: "demo-" + (i + 2),
      applicantId: DEMO_PARTICIPANT.id,
      nickname: DEMO_PARTICIPANT.nickname,
      role: (i % 2 ? "调研" : "编程") as Role,
      note: "状态预览示例",
      state,
    })),
  ];
}
export function initialInvitations(): TeamInvitation[] {
  return initialApplications()
    .filter((a) =>
      ["INVITED", "ACCEPTED", "DECLINED", "REVOKED", "INVALID"].includes(
        a.state,
      ),
    )
    .map((a) => ({
      id: "inv-" + a.id,
      applicationId: a.id,
      state:
        a.state === "INVITED" ? "ACTIVE" : (a.state as TeamInvitation["state"]),
    }));
}
export function draftFromTeam(team: Team): TeamDraft {
  return {
    ...team,
    roles: [...team.roles],
    capacity: String(team.capacity),
    deadline: new Date(Date.parse(team.deadline) + 8 * 3600000)
      .toISOString()
      .slice(0, 16),
    trackId: team.trackId ?? "",
  };
}
export type TeamFilters = {
  q: string;
  type: string;
  role: string;
  mode: string;
  status: string;
  competition: string;
  page: number;
};
const first = (v: Query[string]) => (Array.isArray(v) ? v[0] : v) ?? "";
export function parseTeamFilters(query: Query): TeamFilters {
  const page = Number(first(query.page));
  return {
    q: first(query.q).trim().slice(0, 100),
    type: Object.hasOwn(projectTypes, first(query.type))
      ? first(query.type)
      : "",
    role: roleOptions.includes(first(query.role) as Role)
      ? first(query.role)
      : "",
    mode: Object.hasOwn(cooperationModes, first(query.mode))
      ? first(query.mode)
      : "",
    status: ["available", "unavailable"].includes(first(query.status))
      ? first(query.status)
      : "",
    competition: first(query.competition).trim().slice(0, 120),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
export function writeTeamFilters(query: Query, filters: TeamFilters): Query {
  const result: Query = { ...query };
  for (const key of [
    "q",
    "type",
    "role",
    "mode",
    "status",
    "competition",
    "page",
  ] as const) {
    delete result[key];
    if (key === "page") {
      if (filters.page > 1) result.page = String(filters.page);
    } else if (filters[key]) result[key] = filters[key];
  }
  return result;
}
export const canonicalTeamQuery = (query: Query) =>
  writeTeamFilters(query, parseTeamFilters(query));
export function filterTeams(teams: Team[], filters: TeamFilters, now: number) {
  return teams
    .filter(
      (t) =>
        (!filters.q ||
          [t.title, t.goal, t.skills, ...t.roles].some((v) =>
            v.includes(filters.q),
          )) &&
        (!filters.type || t.type === filters.type) &&
        (!filters.role || t.roles.includes(filters.role as Role)) &&
        (!filters.mode || t.mode === filters.mode) &&
        (!filters.competition || t.competition?.id === filters.competition) &&
        (!filters.status ||
          recruitmentStatus(t, now).available ===
            (filters.status === "available")),
    )
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
