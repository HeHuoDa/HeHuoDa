import type { paths, components } from "./generated/schema.js";
export type { paths, components } from "./generated/schema.js";
export type ApiError = components["schemas"]["ApiErrorDto"];
export type HealthResponse =
  paths["/api/v1/health"]["get"]["responses"][200]["content"]["application/json"];
export type College = components["schemas"]["CollegeDto"];
export type CompetitionList = components["schemas"]["CompetitionListDto"];
export type CompetitionDetail = components["schemas"]["CompetitionDetailDto"];
export type Time = components["schemas"]["TimeDto"];
export type CompetitionStage = components["schemas"]["StageDto"];
export type CompetitionScope = components["schemas"]["ScopeDto"];
export type CompetitionEntry = components["schemas"]["EntryDto"];
export type WechatLoginRequest = components["schemas"]["WechatLoginRequestDto"];
export type RefreshRequest = components["schemas"]["RefreshRequestDto"];
export type UserAccount = components["schemas"]["UserDto"];
export type UserStatus = UserAccount["status"];
export type CredentialResponse = components["schemas"]["CredentialResponseDto"];
export type H5CredentialResponse =
  components["schemas"]["H5CredentialResponseDto"];
export type CampusStatus = components["schemas"]["CampusStatusDto"];
export type Availability = components["schemas"]["AvailabilityDto"];
export type ProfileResponse = components["schemas"]["ProfileResponseDto"];
export type UpdateProfileRequest =
  components["schemas"]["UpdateProfileRequestDto"];
export type CampusPolicy = components["schemas"]["CampusPolicyDto"];
export type CampusQualification =
  components["schemas"]["CampusStatusResponseDto"];
export type CampusProfile = components["schemas"]["CampusProfileResponseDto"];
export type CampusTransaction = components["schemas"]["CampusTransactionDto"];
export type CampusSubmit = components["schemas"]["CampusSubmitDto"];
// 学校唯一登录（#217）。#218/#221/#222 消费同一份生成契约，不得手写重复类型。
export type SchoolLoginHolderQuery =
  components["schemas"]["SchoolLoginHolderQueryDto"];
export type SchoolLoginSubmit = components["schemas"]["SchoolLoginSubmitDto"];
export type SchoolLoginChallenge =
  components["schemas"]["SchoolLoginChallengeResponseDto"];
export type SchoolLoginTransaction =
  components["schemas"]["SchoolLoginTransactionDto"];
export type SchoolLoginCredential =
  components["schemas"]["SchoolLoginCredentialDto"];
export type SchoolLoginH5Credential =
  components["schemas"]["SchoolLoginH5CredentialDto"];
export type SchoolLoginChallengePath =
  paths["/api/v1/auth/school/challenges"]["post"];
export type SchoolLoginRefreshPath =
  paths["/api/v1/auth/school/challenges/{id}/captcha"]["post"];
export type SchoolLoginSubmitPath =
  paths["/api/v1/auth/school/challenges/{id}/submit"]["post"];
export type SchoolLoginH5SubmitPath =
  paths["/api/v1/auth/school/challenges/{id}/submit/h5"]["post"];
export type SchoolLoginStatusPath =
  paths["/api/v1/auth/school/challenges/{id}/status"]["post"];
export type SchoolLoginCancelPath =
  paths["/api/v1/auth/school/challenges/{id}"]["delete"];
export type AuthRefreshPath = paths["/api/v1/auth/refresh"]["post"];
export type AuthLogoutPath = paths["/api/v1/auth/logout"]["post"];
