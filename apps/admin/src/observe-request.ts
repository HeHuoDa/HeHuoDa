// 单次页面观察上限两分钟；失败交给人工刷新，绝不重发写操作。
export function observeRequest(query: () => Promise<string | undefined>) {
  const started = Date.now();
  let stopped = false,
    step = 0;
  let timer: ReturnType<typeof setTimeout>;
  function schedule() {
    const delay = [2000, 4000, 8000, 15000][Math.min(step++, 3)]!;
    if (stopped || Date.now() - started + delay > 120000) return;
    timer = setTimeout(async () => {
      try {
        const status = await query();
        if (status === "accepted" || status === "running") schedule();
      } catch {
        /* 页面保留错误及手动刷新入口 */
      }
    }, delay);
  }
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
