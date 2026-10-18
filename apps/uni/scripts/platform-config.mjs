export function platformConfig(env) {
  const appid = (env.UNI_MP_WEIXIN_APPID || "").trim();
  if (appid && !/^wx[0-9a-f]{16}$/i.test(appid)) {
    throw new Error(
      "UNI_MP_WEIXIN_APPID 须为 wx 开头的 18 位 AppID，不接受 touristappid。",
    );
  }
  if (env.UNI_RELEASE && !["true", "false"].includes(env.UNI_RELEASE)) {
    throw new Error("UNI_RELEASE 只接受 true 或 false。");
  }
  if (env.UNI_RELEASE === "true" && !appid) {
    throw new Error("正式平台构建缺少 UNI_MP_WEIXIN_APPID；请先完成 #58。");
  }
  return { appid, release: env.UNI_RELEASE === "true" };
}
