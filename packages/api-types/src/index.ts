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
