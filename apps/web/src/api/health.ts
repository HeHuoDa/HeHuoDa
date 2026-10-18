import type { HealthResponse } from "@hehuoda/api-types";
import { http } from "./http";
export const healthApi = {
  async getHealth(): Promise<HealthResponse> {
    const response = await http.get<HealthResponse>("/health");
    return response.data;
  },
};
