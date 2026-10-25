import type { paths, components } from "./generated/schema.js";
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
export type CampusStatus = components["schemas"]["CampusStatusDto"];
export type Availability = components["schemas"]["AvailabilityDto"];
export type ProfileResponse = components["schemas"]["ProfileResponseDto"];
export type UpdateProfileRequest =
  components["schemas"]["UpdateProfileRequestDto"];
