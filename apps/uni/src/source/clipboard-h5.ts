/** 仅 H5；拒绝/不支持交由共享动作转为可手动使用的地址，不虚报成功。 */
export function writeH5Clipboard(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    return Promise.reject(new Error("clipboard unavailable"));
  return navigator.clipboard.writeText(url);
}
