import assert from "node:assert/strict";
import { test } from "node:test";
import { colleges } from "../src/colleges.ts";
import {
  parseFilters,
  canonicalQuery,
  formatTime,
  formatEvaluatedAt,
  materialDeadlineLabel,
} from "../src/competition-discovery.ts";
import {
  initialProfileState,
  createProfileActions,
  validateProfile,
  profileSkills,
} from "../src/profile.ts";
import {
  deadlineInstant,
  draftFromTeam,
  validateDraft,
  recruitmentStatus,
  parseTeamFilters,
  canonicalTeamQuery,
  teamTime,
  DEMO_PARTICIPANT,
} from "../src/team.ts";
import {
  initialTeamState,
  createTeamActions,
  pendingApplications,
} from "../src/team-session.ts";

const now = Date.parse("2026-10-19T00:00:00+08:00");
function session() {
  const profile = initialProfileState();
  const profileActions = createProfileActions(profile);
  const state = initialTeamState(now);
  const actions = createTeamActions(state, {
    get contactShared() {
      return profile.contactShared;
    },
    reset: profileActions.reset,
  });
  return { state, actions, profile, profileActions };
}

test("纯入口可在没有浏览器、Router 和平台全局的 Node 环境执行", () => {
  for (const name of ["window", "document", "uni", "localStorage"])
    assert.equal(typeof globalThis[name], "undefined");
  assert.equal(colleges.length, 27);
  assert.equal(session().state.teams.length, 8);
});

test("学院 all、显式空值和自选数组分别往返，非法值不扩大范围", () => {
  const id = colleges[0].id;
  for (const [query, expected] of [
    [{}, "all"],
    [{ hosts: "all" }, "all"],
    [{ hosts: "" }, []],
    [{ hosts: "not-a-college" }, []],
    [{ hosts: [id, id] }, [id]],
    [{ hosts: `all,${id}` }, [id]],
  ]) {
    assert.deepEqual(parseFilters(query).hosts, expected);
    assert.deepEqual(parseFilters(canonicalQuery(query)).hosts, expected);
  }
});

test("比赛与队伍参数保持原有首值、白名单、页码与未知参数保留语义", () => {
  assert.deepEqual(
    parseFilters({ q: ["  图鉴  ", "忽略"], page: "1.5", status: "__proto__" }),
    { hosts: "all", q: "图鉴", page: 1, status: "" },
  );
  assert.deepEqual(
    canonicalQuery({
      category: "old",
      eligible: "old",
      extra: "keep",
      page: "-1",
    }),
    { extra: "keep", hosts: "all" },
  );
  const query = {
    q: "  茶园  ",
    type: "other",
    role: "调研",
    mode: "online",
    status: "available",
    competition: " comp-1 ",
    page: "2",
    extra: "keep",
  };
  assert.deepEqual(parseTeamFilters(query), {
    q: "茶园",
    type: "other",
    role: "调研",
    mode: "online",
    status: "available",
    competition: "comp-1",
    page: 2,
  });
  assert.equal(canonicalTeamQuery(query).extra, "keep");
  assert.equal(
    parseTeamFilters({
      page: "9007199254740992",
      type: "bad",
      role: "bad",
      mode: "bad",
      status: "bad",
    }).page,
    1,
  );
});

test("北京时间跨 UTC 日期边界，日期精度与精确截止分开表达", () => {
  assert.equal(
    formatTime({ precision: "instant", value: "2026-10-18T16:00:00Z" }),
    "2026/10/19 00:00",
  );
  assert.equal(formatEvaluatedAt("2026-10-18T16:00:00Z"), "2026/10/19 00:00");
  assert.equal(
    teamTime("2026-10-18T16:00:00Z"),
    "2026/10/19 00:00（北京时间）",
  );
  assert.equal(formatTime(), "待公布");
  const date = { precision: "date", value: "2026-10-19" };
  assert.equal(
    materialDeadlineLabel(date, "2026-10-19T15:59:59Z"),
    "2026-10-19（具体时刻待公布）",
  );
  assert.match(
    materialDeadlineLabel(date, "2026-10-19T16:00:00Z"),
    /材料已截止/,
  );
  const instant = { precision: "instant", value: new Date(now).toISOString() };
  assert.doesNotMatch(
    materialDeadlineLabel(instant, new Date(now - 1).toISOString()),
    /材料已截止/,
  );
  assert.match(materialDeadlineLabel(instant, instant.value), /材料已截止/);
});

test("北京时间解析拒绝非法日历日期、时间和隐式时区输入", () => {
  for (const value of [
    "",
    "2026-02-29T12:00",
    "2026-04-31T12:00",
    "2026-10-19T24:00",
    "2026-10-19",
    "2026-10-19T00:00Z",
    "bad",
  ])
    assert.equal(Number.isNaN(deadlineInstant(value)), true, value);
  assert.equal(deadlineInstant("2026-10-19T00:00"), now);
  assert.equal(Number.isFinite(deadlineInstant("2028-02-29T12:00")), true);
});

test("招募校验保留人数含队长、角色与赛道约束，恰好截止不可提交", () => {
  const { state } = session();
  const draft = draftFromTeam(state.teams[0]);
  assert.deepEqual(validateDraft(draft, now), {});
  for (const capacity of ["1", "21", "2.5", "NaN"])
    assert.ok(validateDraft({ ...draft, capacity }, now).capacity);
  assert.ok(
    validateDraft({ ...draft, deadline: "2026-10-19T00:00" }, now).deadline,
  );
  assert.ok(validateDraft({ ...draft, roles: [] }, now).roles);
  assert.ok(validateDraft({ ...draft, trackId: "foreign-track" }, now).trackId);
  assert.equal(
    recruitmentStatus(state.teams[0], Date.parse(state.teams[0].deadline))
      .label,
    "已截止",
  );
});

test("资料七项校验、技能去重及保存规范化保持源行为", () => {
  const { profile, profileActions } = session();
  assert.deepEqual(validateProfile(profile.profile), {});
  const errors = validateProfile({
    nickname: " ",
    campus: "bad",
    collegeId: "bad",
    major: " ",
    grade: "24",
    skills: "甲".repeat(169),
    bio: "甲".repeat(201),
  });
  assert.deepEqual(
    Object.keys(errors).sort(),
    [
      "nickname",
      "campus",
      "collegeId",
      "major",
      "grade",
      "skills",
      "bio",
    ].sort(),
  );
  assert.deepEqual(profileSkills("编程，设计、编程\n调研"), [
    "编程",
    "设计",
    "调研",
  ]);
  profileActions.save({
    ...profile.profile,
    nickname: " 新昵称 ",
    skills: "编程，设计、编程",
  });
  assert.equal(profile.profile.nickname, "新昵称");
  assert.equal(profile.profile.skills, "编程、设计");
});

test("申请不入队且重复申请幂等，邀请不占名额", () => {
  const { state, actions } = session();
  const team = state.teams[0];
  const count = team.members.length;
  assert.equal(actions.apply(team.id, "调研", "  可查文献  ", now), true);
  assert.equal(actions.apply(team.id, "调研", "重复", now), false);
  assert.equal(state.teams[0].members.length, count);
  assert.equal(pendingApplications(state)[team.id].note, "可查文献");
  const captainTeam = state.teams[6];
  const before = captainTeam.members.length;
  assert.match(
    actions.processApplication("incoming-1", "invite", now),
    /不预占名额/,
  );
  assert.match(actions.processApplication("incoming-1", "invite", now), /失败/);
  assert.equal(captainTeam.members.length, before);
});

test("确认才入队且只入队一次，同时更新申请与邀请终态", () => {
  const { state, actions } = session();
  const team = state.teams[1];
  const before = team.members.length;
  assert.match(actions.respond("history-0", "accept", now), /入队已确认/);
  assert.equal(team.members.length, before + 1);
  assert.equal(
    state.records.find((a) => a.id === "history-0").state,
    "ACCEPTED",
  );
  assert.equal(
    state.invitations.find((a) => a.applicationId === "history-0").state,
    "ACCEPTED",
  );
  assert.match(actions.respond("history-0", "accept", now), /失败/);
  assert.equal(team.members.length, before + 1);
});

for (const condition of [
  "capacity",
  "deadline",
  "paused",
  "closed",
  "role",
  "revoked",
]) {
  test(`确认邀请重新检查 ${condition}，失败不增加成员`, () => {
    const { state, actions } = session();
    const team = state.teams[1];
    if (condition === "capacity") team.capacity = team.members.length;
    if (condition === "deadline") team.deadline = new Date(now).toISOString();
    if (["paused", "closed"].includes(condition)) team.state = condition;
    if (condition === "role") team.roles = [];
    if (condition === "revoked")
      state.invitations.find((i) => i.applicationId === "history-0").state =
        "REVOKED";
    const count = team.members.length;
    assert.match(actions.respond("history-0", "accept", now), /失败/);
    assert.equal(team.members.length, count);
  });
}

test("授权默认关闭，只有授权者与查看者均为有效队伍成员才可展示", () => {
  const { state, actions, profile } = session();
  const team = state.teams[7],
    me = DEMO_PARTICIPANT.id,
    captain = team.members[0].id;
  assert.equal(actions.canViewContact(team.id, me, captain), false);
  profile.contactShared = true;
  assert.equal(actions.canViewContact(team.id, me, captain), true);
  assert.equal(actions.canViewContact(team.id, me, "outsider"), false);
  state.contactAuthorizations[captain] = true;
  assert.equal(actions.canViewContact(team.id, captain), true);
  actions.manage(team.id, "leave");
  assert.equal(actions.canViewContact(team.id, captain), false);
});

test("reset 恢复示例和关闭所有授权，不共享可变初始对象", () => {
  const { state, actions, profile, profileActions } = session();
  const independent = session();
  profile.contactShared = true;
  profileActions.save({ ...profile.profile, nickname: "改过" });
  state.contactAuthorizations["captain-0"] = true;
  actions.apply("demo-1", "调研", "申请", now);
  actions.respond("history-0", "accept", now);
  actions.reset();
  assert.equal(state.teams.length, 8);
  assert.equal(state.teams[1].members.length, 2);
  assert.deepEqual(state.records, independent.state.records);
  assert.deepEqual(state.invitations, independent.state.invitations);
  assert.deepEqual(state.contactAuthorizations, {});
  assert.deepEqual(profile, initialProfileState());
  state.teams[0].title = "变更";
  assert.notEqual(independent.state.teams[0].title, "变更");
});
