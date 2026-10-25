import type { AuthStorage } from "./auth-session.ts";

const REFRESH_KEY = "hehuoda.auth.refresh";

/** 平台名由运行时信息决定，不依赖构建期条件编译的分支顺序。 */
function platformName(): string {
  try {
    const info: unknown = uni.getSystemInfoSync();
    const name = (info as { uniPlatform?: unknown })?.uniPlatform;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

function weixinStorage(): AuthStorage {
  return {
    read() {
      try {
        const value: unknown = uni.getStorageSync(REFRESH_KEY);
        return typeof value === "string" && value.trim() ? value : null;
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        uni.setStorageSync(REFRESH_KEY, value);
      } catch {
        /* 写入失败只影响下次冷启动恢复，不影响本次会话。 */
      }
    },
    clear() {
      try {
        uni.removeStorageSync(REFRESH_KEY);
      } catch {
        /* 存储不可用时没有可清理的凭据。 */
      }
    },
  };
}

function emptyStorage(): AuthStorage {
  return {
    read: () => null,
    write: () => {},
    clear: () => {},
  };
}

/**
 * 刷新凭据存储。
 *
 * 只有微信小程序读写平台存储；H5 与其他端保持空实现，不保存任何凭据。
 * 访问凭据、微信 code 与学校凭据都不在这里，也不进 URL 或演示 store。
 * 存储失败不阻断本次登录（访问凭据仍在内存），但下次冷启动需要重新登录。
 */
export function platformAuthStorage(): AuthStorage {
  return platformName() === "mp-weixin" ? weixinStorage() : emptyStorage();
}
