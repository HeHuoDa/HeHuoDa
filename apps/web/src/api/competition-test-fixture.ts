import type {
  CompetitionDetail,
  CompetitionList,
  Time,
} from "@hehuoda/api-types";
import { colleges } from "../data/colleges";
import { competitions, DEMO_NOW } from "../data/competitions";
import { filterEntries, stageStatus } from "../data/competition-demo";
import type { Filters } from "../data/competition-discovery";
export const fixtureColleges = colleges.map((c, order) => ({
  id: c.id,
  name: c.name,
  order,
}));
const time = (value?: string): Time =>
  value
    ? { precision: "instant", value }
    : { precision: "unknown", value: null };
export function fixtureDetail(id: string): CompetitionDetail {
  const c = competitions.find((c) => c.id === id);
  if (!c) throw { isAxiosError: true, response: { status: 404 } };
  return {
    ...c,
    evaluatedAt: DEMO_NOW,
    stages: c.stages.map((s, order) => ({
      ...s,
      startsAt: time(s.startsAt),
      deadline: time(s.deadline),
      materialsAt: time(s.materialsAt),
      eventAt: time(s.eventAt),
      timeNote: s.timeNote ?? "",
      conflict: s.conflict ?? false,
      order,
      status: stageStatus(s),
    })),
  };
}
export function fixtureList(filters: Filters): CompetitionList {
  const entries = filterEntries(filters);
  const totalPages = Math.max(1, Math.ceil(entries.length / 4));
  const page = Math.min(totalPages, filters.page);
  return {
    items: entries
      .slice((page - 1) * 4, page * 4)
      .map(({ competition, stage }) => ({
        competition,
        stage: fixtureDetail(competition.id).stages.find(
          (s) => s.id === stage.id,
        )!,
      })),
    page,
    pageSize: 4,
    totalPages,
    totalStages: entries.length,
    totalCompetitions: new Set(entries.map((e) => e.competition.id)).size,
    hasMore: page < totalPages,
    evaluatedAt: DEMO_NOW,
  };
}
