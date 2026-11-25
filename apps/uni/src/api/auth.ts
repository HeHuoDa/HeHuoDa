import { createAuthApi } from "./auth-client.ts";
import { authedHttp, http } from "./client.ts";

const platformFlags = { h5: false };
// #ifdef H5
platformFlags.h5 = true;
// #endif

export const authApi = createAuthApi(http, authedHttp, {
  h5: platformFlags.h5,
});
