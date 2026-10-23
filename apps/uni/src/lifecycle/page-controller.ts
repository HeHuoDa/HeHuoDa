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
  function reconcile() {
    const next = visible && foreground && !disposed;
    if (next === running) return;
    running = next;
    if (running) resources.show();
    else resources.hide();
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
      disposed = true;
      reconcile();
    },
  };
}
