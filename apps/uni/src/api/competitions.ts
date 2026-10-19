import { http } from "./client";
import { createCompetitionApi } from "./competition-client";

export const competitionApi = createCompetitionApi(http);
