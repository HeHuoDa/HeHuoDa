export interface PageResources {
  show(): void;
  hide(): void;
}

/** 页面保留与应用后台是两条独立生命周期；只在两者都可见时拥有资源。 */
export function createPageLifecycle(
  resources: PageResources,
  foreground = true,
) {
  let visible = false;
  let running = false;
  let disposed = false;
  // onLoad 可以先于首次 onShow 发出请求，首次隐藏也需要清理。
  let needsCleanup = true;
  function reconcile() {
    const next = visible && foreground && !disposed;
    if (next) {
      if (running) return;
      running = true;
      needsCleanup = true;
      resources.show();
    } else if (needsCleanup) {
      running = false;
      needsCleanup = false;
      resources.hide();
    }
  }
  return {
    show() {
      visible = true;
      reconcile();
    },
    hide() {
      visible = false;
      reconcile();
    },
    setForeground(value: boolean) {
      foreground = value;
      reconcile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reconcile();
    },
  };
}
