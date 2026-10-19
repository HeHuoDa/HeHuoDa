import { colleges } from "./colleges.ts";
export const campusOptions = ["雅安校区", "成都校区", "都江堰校区"] as const;
export interface DemoProfile {
  nickname: string;
  campus: string;
  collegeId: string;
  major: string;
  grade: string;
  skills: string;
  bio: string;
}
export function initialProfile(): DemoProfile {
  return {
    nickname: "禾小苗",
    campus: "雅安校区",
    collegeId: "information-engineering",
    major: "计算机科学与技术",
    grade: "2024",
    skills: "编程、设计",
    bio: "喜欢把想法做成看得见的东西。想找认真投入，也愿意一起学习的伙伴。",
  };
}
export function profileSkills(value: string) {
  return [
    ...new Set(
      value
        .split(/[,，、\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function validateProfile(value: DemoProfile) {
  const errors: Partial<Record<keyof DemoProfile, string>> = {};
  if (!value.nickname.trim() || value.nickname.trim().length > 20)
    errors.nickname = "请输入 1–20 字昵称，不能只填写空格。";
  if (!campusOptions.some((c) => c === value.campus))
    errors.campus = "请选择示例校区。";
  if (!colleges.some((c) => c.id === value.collegeId))
    errors.collegeId = "请选择目录中的学院。";
  if (!value.major.trim() || value.major.trim().length > 60)
    errors.major = "请输入 1–60 字专业。";
  if (!/^20\d{2}$/.test(value.grade))
    errors.grade = "请输入四位入学年级，例如 2024。";
  const skills = profileSkills(value.skills);
  if (
    skills.length > 8 ||
    skills.some((s) => s.length > 20) ||
    value.skills.length > 168
  )
    errors.skills = "最多 8 项技能，每项不超过 20 字。";
  if (value.bio.trim().length > 200) errors.bio = "简介不能超过 200 字。";
  return errors;
}

export interface ProfileState {
  profile: DemoProfile;
  contactShared: boolean;
}
export function initialProfileState(): ProfileState {
  return { profile: initialProfile(), contactShared: false };
}
export function createProfileActions(state: ProfileState) {
  function save(value: DemoProfile) {
    state.profile = { ...value };
    for (const key of Object.keys(state.profile) as (keyof DemoProfile)[]) {
      state.profile[key] = value[key].trim();
    }
    state.profile.skills = profileSkills(value.skills).join("、");
  }
  function reset() {
    Object.assign(state, initialProfileState());
  }
  return { save, reset };
}
