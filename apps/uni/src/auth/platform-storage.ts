import type { AuthStorage } from "./auth-session.ts";

/**
 * 刷新凭据存储。
 *
 * 现行交付端（H5 与 Android）都不把刷新凭据写入平台明文存储：
 * H5 由同源 HttpOnly Cookie 托管，Android 的 Keystore 加密适配归 #220。
 * 因此这里始终返回空适配器：读取恒为 null，写入与清理均为空操作，
 * 既不读回遗留令牌，也不触达 `uni.*Storage*`。
 * 访问凭据、学校凭据与登录凭据都不在这里，也不进 URL 或演示 store。
 * 存储适配变化时只需替换本函数的返回值，调用方接口保持不变。
 */
export function platformAuthStorage(): AuthStorage {
  return {
    read: () => null,
    write: () => {},
    clear: () => {},
  };
}
