import type {
  College,
  CompetitionDetail,
  CompetitionList,
} from "@hehuoda/api-types";
import { http } from "./http";
import type { Filters } from "../data/competition-discovery";
export const competitionApi = {
  async colleges(signal?: AbortSignal) {
    return (await http.get<College[]>("/colleges", { signal })).data;
  },
  async list(filters: Filters, signal?: AbortSignal) {
    const params = {
      hosts: filters.hosts === "all" ? "all" : filters.hosts.join(","),
      q: filters.q || undefined,
      status: filters.status || undefined,
      page: filters.page,
      pageSize: 4,
    };
    return (
      await http.get<CompetitionList>("/competitions", { params, signal })
    ).data;
  },
  async detail(id: string, signal?: AbortSignal) {
    return (
      await http.get<CompetitionDetail>(
        "/competitions/" + encodeURIComponent(id),
        { signal },
      )
    ).data;
  },
};
export const originLabels = {
  official: "官方通知",
  historical: "官方历史信息",
  demo: "虚构交互样例",
};
