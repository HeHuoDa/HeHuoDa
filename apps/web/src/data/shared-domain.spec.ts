import { describe, expect, it } from "vitest";
import { createPinia } from "pinia";
import { colleges } from "./colleges";
import { colleges as pureColleges } from "@hehuoda/client-domain/colleges";
import { useTeamDemoStore } from "./team-demo";
import { useProfileDemoStore } from "./profile-demo";
import {
  initialProfileState,
  createProfileActions,
} from "@hehuoda/client-domain/profile";
import {
  initialTeamState,
  createTeamActions,
  pendingApplications,
} from "@hehuoda/client-domain/team-session";

describe("旧 Web 入口与纯规则使用同一输入得到一致结果", () => {
  it("共享学院目录保持既有业务 ID、名称和顺序，资源由各端保留", () => {
    expect(colleges.map(({ id, name }) => ({ id, name }))).toEqual(
      pureColleges,
    );
  });
  it("真实 Web Pinia 适配与纯状态机在同一动作轨迹中保持一致", () => {
    const pinia = createPinia();
    const web = useTeamDemoStore(pinia);
    const webProfile = useProfileDemoStore(pinia);
    // Use the Web initialization timestamp so derived example deadlines also match.
    const now = Date.parse(web.teams[0]!.deadline) - 14 * 86400000;
    const state = initialTeamState(now);
    const profile = initialProfileState();
    const profileActions = createProfileActions(profile);
    const actions = createTeamActions(state, {
      get contactShared() {
        return profile.contactShared;
      },
      reset: profileActions.reset,
    });
    expect(web.apply("demo-1", "调研", " 愿意查文献 ", now)).toEqual(
      actions.apply("demo-1", "调研", " 愿意查文献 ", now),
    );
    expect(web.processApplication("incoming-1", "invite", now)).toEqual(
      actions.processApplication("incoming-1", "invite", now),
    );
    expect(web.respond("history-0", "accept", now)).toEqual(
      actions.respond("history-0", "accept", now),
    );
    expect(web.respond("history-0", "accept", now)).toEqual(
      actions.respond("history-0", "accept", now),
    );
    profile.contactShared = webProfile.contactShared = true;
    expect(web.canViewContact("demo-8", "demo-student", "captain-7")).toEqual(
      actions.canViewContact("demo-8", "demo-student", "captain-7"),
    );
    expect(web.teams).toEqual(state.teams);
    expect(web.records).toEqual(state.records);
    expect(web.invitations).toEqual(state.invitations);
    expect(web.applications).toEqual(pendingApplications(state));
    expect(webProfile.profile).toEqual(profile.profile);
    web.reset();
    actions.reset();
    // Reset initializes relative example dates at the invocation time.
    expect(web.records).toEqual(state.records);
    expect(web.invitations).toEqual(state.invitations);
    expect(web.contactAuthorizations).toEqual(state.contactAuthorizations);
    expect(webProfile.contactShared).toBe(profile.contactShared);
    expect(webProfile.profile).toEqual(profile.profile);
  });
});
