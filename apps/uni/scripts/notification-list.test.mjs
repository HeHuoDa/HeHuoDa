import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTick } from "vue";
import { mount, textOf } from "./component-host.mjs";
import { initialNotifications } from "../src/stores/notification-session.ts";

for (const platform of ["H5", "MP-WEIXIN"]) {
  test(`${platform} 通知列表筛选、正文、显式已读与空态`, async () => {
    const events = [];
    const items = initialNotifications();
    items[0].body = "<script>alert('纯文本')</script>";
    const props = {
      items,
      unreadCount: 1,
      onRead: (id) => events.push(id),
      onReadAll: () => events.push("all"),
      onOpen: (item) => events.push(item.id),
    };
    const view = await mount(
      "../src/components/NotificationList.vue",
      props,
      platform,
    );
    function click(label) {
      const button = view.find(
        (n) =>
          (platform === "H5"
            ? n.props.role === "button"
            : n.type === "button") && textOf(n).trim() === label,
      );
      assert.ok(button, label);
      button.props.onClick();
    }
    try {
      click("阅读全文");
      await nextTick();
      assert.match(
        textOf(view.container),
        /<script>alert\('纯文本'\)<\/script>/,
      );
      assert.deepEqual(events, []);
      click("标为已读");
      assert.deepEqual(events, [items[0].id]);
      click("全部已读");
      assert.equal(events.at(-1), "all");
      click("组队进展");
      await nextTick();
      assert.match(textOf(view.container), /没有符合筛选条件的通知/);
      view.render({ ...props, items: [], unreadCount: 0 });
      await nextTick();
      assert.match(textOf(view.container), /还没有通知/);
    } finally {
      view.unmount();
    }
  });
}
