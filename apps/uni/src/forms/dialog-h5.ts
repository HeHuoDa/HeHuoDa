/** 仅从 H5 条件编译分支调用；所有浏览器焦点/键盘/viewport 能力集中在此。 */
export function attachH5Dialog(
  instance: unknown,
  cancel: () => void,
  viewport: (height: number, top: number) => void,
) {
  if (typeof document === "undefined") return () => {};
  const root = (instance as { $el?: HTMLElement })?.$el ?? instance;
  if (!(root instanceof HTMLElement)) return () => {};
  const previous = document.activeElement;
  const hidden: { element: HTMLElement; inert: boolean }[] = [];
  let branch: HTMLElement = root;
  while (branch.parentElement && branch.parentElement !== document.body) {
    for (const element of branch.parentElement.children) {
      if (element !== branch && element instanceof HTMLElement) {
        hidden.push({ element, inert: element.inert });
        element.inert = true;
      }
    }
    branch = branch.parentElement;
  }
  const controls = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]',
      ),
    ).filter(
      (element) =>
        element.getClientRects().length &&
        element.getAttribute("aria-disabled") !== "true",
    );
  const focus = () => (controls()[0] ?? root).focus();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === "Tab") {
      const items = controls();
      const first = items[0] ?? root;
      const last = items[items.length - 1] ?? root;
      if (
        !root.contains(document.activeElement) ||
        (event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root)) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  };
  const focusin = (event: FocusEvent) => {
    if (!root.contains(event.target as Node)) focus();
  };
  const wheel = (event: WheelEvent) => {
    const content = root.querySelector(".hhr-dialog-body");
    if (!content?.contains(event.target as Node)) event.preventDefault();
  };
  const resize = () =>
    viewport(
      window.visualViewport?.height ?? window.innerHeight,
      window.visualViewport?.offsetTop ?? 0,
    );
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("focusin", focusin, true);
  root.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("scroll", resize);
  resize();
  focus();
  return () => {
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("focusin", focusin, true);
    root.removeEventListener("wheel", wheel);
    window.removeEventListener("resize", resize);
    window.visualViewport?.removeEventListener("resize", resize);
    window.visualViewport?.removeEventListener("scroll", resize);
    for (const { element, inert } of hidden) element.inert = inert;
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus();
  };
}
