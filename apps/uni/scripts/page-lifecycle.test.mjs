import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageLifecycle } from "../src/lifecycle/page-controller.ts";

test("onLoad 已发出的请求在页面首次显示前卸载时也会被清理", () => {
  let pending = true;
  const page = createPageLifecycle({
    show() {},
    hide() {
      pending = false;
    },
  });
  page.dispose();
  assert.equal(pending, false);
});

test("首次显示前进入后台也清理 onLoad 请求，重复隐藏不重复清理", () => {
  let cancellations = 0;
  const page = createPageLifecycle({
    show() {},
    hide() {
      cancellations++;
    },
  });
  page.setForeground(false);
  page.hide();
  assert.equal(cancellations, 1);
});

test("应用与页面都显示时才运行，重复切换十次及卸载均不累积资源", () => {
  let active = 0,
    starts = 0,
    stops = 0,
    clock = 0,
    now = -1;
  const page = createPageLifecycle({
    show() {
      active++;
      starts++;
      now = clock;
    },
    hide() {
      active--;
      stops++;
    },
  });
  page.show();
  page.show();
  assert.equal(active, 1);
  for (let i = 1; i <= 10; i++) {
    page.setForeground(false);
    page.setForeground(false);
    assert.equal(active, 0);
    clock = i * 1000;
    page.setForeground(true);
    page.show();
    assert.equal(active, 1);
    assert.equal(now, clock, "返回前台立即使用当前时钟");
  }
  page.hide();
  page.setForeground(false);
  page.setForeground(true);
  assert.equal(active, 0, "应用回前台不能唤醒隐藏页面");
  page.show();
  page.dispose();
  page.dispose();
  page.show();
  page.setForeground(true);
  assert.equal(active, 0);
  assert.equal(starts, stops);
});
