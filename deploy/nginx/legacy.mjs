const routes = {
  "/home": "/pages/index/index",
  "/teams": "/pages/teams/index",
  "/teams/new": "/pages/teams/new",
  "/profile": "/pages/profile/index",
  "/my/teams": "/pages/profile/index",
  "/my/applications": "/pages/profile/index",
  "/my/favorites": "/pages/my/favorites",
  "/notifications": "/pages/notifications/index",
  "/about": "/pages/about/index",
  "/login": "/pages/auth/login",
  "/register": "/pages/auth/register",
  "/health": "/pages/health/index",
};

function target(uri, args) {
  const path = uri.replace(/\/$/, "");
  let page = routes[path];
  let key;
  let value;
  if (path === "/my/teams" || path === "/my/applications") {
    key = "section";
    value = path.slice(4);
  } else if (!page) {
    const match = /^\/(home\/competitions|teams)\/([A-Za-z0-9-]+)$/.exec(path);
    if (!match) return null;
    page =
      match[1] === "teams" ? "/pages/teams/detail" : "/pages/home/competition";
    key = "id";
    value = match[2];
  }
  // Preserve unrelated entries, including their original encoding and duplicates.
  const entries = (args || "").split("&").filter((entry) => {
    if (!entry) return false;
    if (!key) return true;
    try {
      return (
        decodeURIComponent(entry.split("=", 1)[0].replace(/\+/g, " ")) !== key
      );
    } catch (error) {
      void error;
      return true;
    }
  });
  if (key) entries.unshift(`${key}=${encodeURIComponent(value)}`);
  return `/#${page}${entries.length ? `?${entries.join("&")}` : ""}`;
}

function redirect(request) {
  const location = target(request.uri, request.variables.args);
  request.return(location ? 302 : 404, location || "");
}

export default { redirect, target };
