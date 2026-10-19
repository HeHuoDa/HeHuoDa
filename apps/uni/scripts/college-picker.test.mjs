import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTick } from "vue";
import { colleges as domainColleges } from "@hehuoda/client-domain/colleges";
import { colleges } from "../src/data/colleges.ts";
import { mount, textOf } from "./component-host.mjs";

const file = "../src/components/CollegePicker.vue";
function nodes(root, predicate) {
  return [
    ...(predicate(root) ? [root] : []),
    ...root.children.flatMap((child) => nodes(child, predicate)),
  ];
}
const entries = (app) =>
  nodes(app.container, (node) => Boolean(node.props["data-college-id"]));
const reset = (app) =>
  app.find((node) => String(node.props.class).includes("college-reset"));
const entry = (app, id) =>
  entries(app).find((node) => node.props["data-college-id"] === id);

test("展示资源目录与共享业务目录顺序、名称完全一致", () => {
  assert.deepEqual(
    colleges.map(({ id, name }) => ({ id, name })),
    domainColleges,
  );
});

for (const platform of ["H5", "MP-WEIXIN"]) {
  for (const compact of [false, true]) {
    test(`${platform} ${compact ? "紧凑" : "常规"}：受控三态、全选切换、父级恢复、逐个选满`, async () => {
      let value = "all";
      let selects = 0,
        clears = 0,
        resets = 0;
      const props = () => ({
        compact,
        modelValue: value,
        "onUpdate:modelValue": (next) => {
          value = next;
        },
        // 对外 select 参数与模型隔离。
        onSelect: (ids) => {
          selects++;
          ids.push("law");
        },
        onClear: () => clears++,
        onReset: () => resets++,
      });
      const app = await mount(file, props(), platform);
      async function click(node) {
        node.props.onClick();
        app.render(props());
        await nextTick();
      }
      assert.equal(entries(app).length, 27);
      assert.equal(reset(app).props["aria-pressed"], true);
      assert.match(textOf(app.container), /当前选择：全部学院/);
      await click(entry(app, "law"));
      assert.deepEqual(value, ["law"]);
      assert.equal(reset(app).props["aria-pressed"], false);
      assert.match(textOf(entry(app, "law")), /✓/);
      await click(entry(app, "agriculture"));
      assert.deepEqual(value, ["agriculture", "law"]);
      assert.match(textOf(app.container), /已选择 2 个学院/);
      await click(entry(app, "law"));
      await click(entry(app, "agriculture"));
      assert.deepEqual(value, []);
      assert.match(textOf(app.container), /未选择学院/);
      await click(reset(app));
      assert.equal(value, "all");
      await click(reset(app));
      assert.deepEqual(value, []);
      for (const college of [...colleges].reverse())
        await click(entry(app, college.id));
      assert.deepEqual(
        value,
        colleges.map((college) => college.id),
      );
      assert.equal(reset(app).props["aria-pressed"], false);
      assert.equal(
        entries(app).filter((node) => node.props["aria-pressed"]).length,
        27,
      );
      assert.match(textOf(app.container), /已选择 27 个学院/);
      value = ["architecture-planning"];
      app.render(props());
      await nextTick();
      assert.match(textOf(app.container), /当前选择：建筑与城乡规划学院/);
      assert.equal(selects, 30);
      assert.equal(clears, 2);
      assert.equal(resets, 1);
      app.unmount();
    });
  }

  test(`${platform}：未知 ID 清理反馈、重复和乱序规范化，不触发用户选择事件`, async () => {
    const updates = [],
      invalids = [];
    let selects = 0;
    const app = await mount(
      file,
      {
        modelValue: ["law", "missing", "agriculture", "law"],
        "onUpdate:modelValue": (value) => updates.push(value),
        onInvalid: (ids) => invalids.push(ids),
        onSelect: () => selects++,
      },
      platform,
    );
    assert.deepEqual(updates, [["agriculture", "law"]]);
    assert.deepEqual(invalids, [["missing"]]);
    assert.match(textOf(app.container), /已移除 1 个失效学院/);
    assert.equal(selects, 0);
    app.unmount();
  });

  test(`${platform}：加载、失败、目录不一致均禁用选择，失败可重试且不改模型`, async () => {
    const updates = [];
    let retries = 0;
    const props = {
      modelValue: ["law"],
      "onUpdate:modelValue": (value) => updates.push(value),
      onRetry: () => retries++,
    };
    const app = await mount(file, { ...props, status: "loading" }, platform);
    assert.match(textOf(app.container), /正在加载学院目录/);
    assert.equal(entries(app).length, 0);
    reset(app).props.onClick();
    assert.deepEqual(updates, []);
    for (const extra of [
      { status: "error", errorMessage: "网络不可用" },
      { catalog: [] },
      { catalog: [...domainColleges].reverse() },
      {
        catalog: domainColleges.map((college, index) =>
          index ? college : { ...college, name: "错误名称" },
        ),
      },
    ]) {
      app.render({ ...props, ...extra });
      await nextTick();
      assert.equal(entries(app).length, 0);
      const alert = app.find((node) => node.props.role === "alert");
      assert.ok(alert);
      const button = nodes(alert, (node) =>
        platform === "H5"
          ? node.props.role === "button"
          : node.type === "button",
      )[0];
      button.props.onClick();
      assert.deepEqual(updates, []);
    }
    assert.equal(retries, 4);
    app.render(props);
    await nextTick();
    assert.equal(entries(app).length, 27);
    assert.equal(entry(app, "law").props["aria-pressed"], true);
    app.unmount();
  });

  test(`${platform}：院徽缺失与坏图首字回退仍能选择，滚动区不包裹标题或操作`, async () => {
    const updates = [];
    const app = await mount(
      file,
      { modelValue: [], "onUpdate:modelValue": (value) => updates.push(value) },
      platform,
    );
    assert.match(textOf(entry(app, "agricultural-engineering")), /农/);
    assert.match(textOf(entry(app, "civil-engineering")), /土/);
    const agriculture = entry(app, "agriculture");
    const image = nodes(agriculture, (node) => node.type === "image")[0];
    image.props.onError();
    await nextTick();
    assert.equal(nodes(agriculture, (node) => node.type === "image").length, 0);
    assert.match(textOf(agriculture), /农/);
    agriculture.props.onClick();
    assert.deepEqual(updates, [["agriculture"]]);
    const scroll = app.find((node) => node.type === "scroll-view");
    assert.equal(scroll.props["scroll-y"], true);
    assert.equal(
      nodes(scroll, (node) =>
        String(node.props.class).includes("college-reset"),
      ).length,
      0,
    );
    assert.equal(
      nodes(scroll, (node) =>
        String(node.props.class).includes("college-status"),
      ).length,
      0,
    );
    app.unmount();
  });
}

test("H5：学院按钮可用 Enter/Space 操作，无重复的实例 ID", async () => {
  const updates = [];
  const app = await mount(
    file,
    {
      modelValue: "all",
      "onUpdate:modelValue": (value) => updates.push(value),
    },
    "H5",
  );
  const law = entry(app, "law");
  assert.equal(law.props.tabindex, 0);
  law.props.onKeydown({ key: "Enter", preventDefault() {} });
  law.props.onKeydown({ key: " ", preventDefault() {} });
  assert.deepEqual(updates, [["law"], ["law"]]);
  assert.equal(
    nodes(app.container, (node) => Boolean(node.props.id)).length,
    0,
  );
  app.unmount();
});

for (const platform of ["H5", "MP-WEIXIN"]) {
  test(`${platform}：白色院徽失败后恢复浅底和首字，普通展示仍保留指定尺寸`, async () => {
    const app = await mount(
      "../src/components/CollegeEmblem.vue",
      { collegeId: "horticulture", picker: true },
      platform,
    );
    const frame = () =>
      app.find((node) => String(node.props.class).includes("college-emblem"));
    assert.match(frame().props.class, /college-emblem--white/);
    const resource = app.find((node) =>
      String(node.props.class).includes("resource-image"),
    );
    assert.equal(resource.props.style.width, "100%");
    app.find((node) => node.type === "image").props.onError();
    await nextTick();
    assert.doesNotMatch(frame().props.class, /college-emblem--white/);
    assert.equal(textOf(frame()), "园");
    app.render({ collegeId: "law", size: 48 });
    await nextTick();
    assert.equal(frame().props.style.width, "48px");
    assert.equal(frame().props.style.height, "48px");
    assert.ok(app.find((node) => node.type === "image"));
    app.unmount();
  });

  test(`${platform}：加载期间保留失效选择，目录就绪后才清理`, async () => {
    const updates = [];
    const props = {
      modelValue: ["missing"],
      "onUpdate:modelValue": (value) => updates.push(value),
    };
    const app = await mount(file, { ...props, status: "loading" }, platform);
    assert.deepEqual(updates, []);
    app.render({ ...props, status: "ready" });
    await nextTick();
    assert.deepEqual(updates, [[]]);
    assert.match(textOf(app.container), /已移除 1 个失效学院/);
    app.unmount();
  });

  test(`${platform}：完整 fixture 的两个实例受控同步，滚动外操作与失败重试可达`, async () => {
    const app = await mount(
      "./fixtures/CollegePickerFixture.vue",
      {},
      platform,
    );
    assert.equal(entries(app).length, 54);
    entry(app, "law").props.onClick();
    await nextTick();
    assert.equal(
      entries(app).filter((node) => node.props["aria-pressed"]).length,
      2,
    );
    const buttons = () =>
      nodes(app.container, (node) =>
        platform === "H5"
          ? node.props.role === "button"
          : node.type === "button",
      );
    buttons()
      .find((node) => textOf(node) === "外层操作 0")
      .props.onClick();
    await nextTick();
    assert.match(textOf(app.container), /外层操作 1/);
    buttons()
      .find((node) => textOf(node) === "失败")
      .props.onClick();
    await nextTick();
    assert.equal(entries(app).length, 0);
    buttons()
      .find((node) => textOf(node).trim() === "重新加载")
      .props.onClick();
    await nextTick();
    assert.equal(entries(app).length, 54);
    assert.equal(
      entries(app).filter((node) => node.props["aria-pressed"]).length,
      2,
    );
    app.unmount();
  });
}
