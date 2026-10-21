import type { HealthResponse } from "@hehuoda/api-types";
import type { createHttpClient } from "./http.ts";
import { http } from "./client.ts";

export function isHealthResponse(data: unknown): data is HealthResponse {
  if (data === null || typeof data !== "object") return false;
  const body = data as Partial<HealthResponse>;
  return (
    body.status === "ok" &&
    typeof body.requestId === "string" &&
    body.requestId.trim().length > 0 &&
    body.requestId.length <= 256 &&
    Array.from(body.requestId).every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    )
  );
}

export function createHealthApi(client: ReturnType<typeof createHttpClient>) {
  return { getHealth: () => client.get("/health", isHealthResponse) };
}

export const healthApi = createHealthApi(http);
