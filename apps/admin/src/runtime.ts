import { createAdminHttp } from "./http";
const sessionChannel =
  typeof window.BroadcastChannel === "function"
    ? new window.BroadcastChannel("hh-admin-session")
    : null;
export const adminHttp = createAdminHttp(() =>
  sessionChannel?.postMessage("invalidate"),
);
sessionChannel?.addEventListener("message", (event) => {
  if (event.data === "invalidate") adminHttp.invalidate();
});
