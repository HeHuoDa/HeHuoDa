import { createAuthApi } from "./auth-client.ts";
import { authedHttp, http } from "./client.ts";

export const authApi = createAuthApi(http, authedHttp);
