import { CapabilityRegistry } from "./capabilities.js";
import type { DataModule } from "./ports.js";

const authModule = (): DataModule => ({
  id: "auth",
  kind: "production",
  capabilities: [],
  lifecycle: {
    check: async () => {},
    revoke: async () => {},
    cleanup: async () => {},
  },
});

describe("敏感业务能力门禁", () => {
  it("认证模式可用，但没有正式业务提供者时不能启用敏感业务", () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.assertReady(false)).not.toThrow();
    expect(() => registry.assertReady(true)).toThrow("campus");
  });
  it("拒绝重复模块、测试提供者和生命周期漏声明", () => {
    const registry = new CapabilityRegistry();
    registry.register(authModule());
    expect(() => registry.register(authModule())).toThrow("重复模块");
    expect(() =>
      registry.register({ ...authModule(), id: "test", kind: "test" }),
    ).toThrow("测试提供者");
    expect(() =>
      registry.register({
        ...authModule(),
        id: "broken",
        lifecycle: {} as DataModule["lifecycle"],
      }),
    ).toThrow("生命周期不完整");
  });
  it("声明资格能力却没有真实查询接口不能注册", () => {
    expect(() =>
      new CapabilityRegistry().register({
        ...authModule(),
        capabilities: ["campus"],
      }),
    ).toThrow("能力接口不完整");
  });
  it("封闭装配后不能动态补入模块绕过启用检查", () => {
    const registry = new CapabilityRegistry();
    registry.seal(false);
    expect(() => registry.register(authModule())).toThrow("已封闭");
  });
});
