import type { Capability, DataModule } from "./ports.js";

const required: readonly Capability[] = [
  "campus",
  "resources",
  "contact-revocation",
  "business-cleanup",
  "governance",
  "school-sessions",
];

export class CapabilityRegistry {
  private readonly modules = new Map<string, DataModule>();
  private sealed = false;

  constructor(private readonly allowTestProviders = false) {}

  register(module: DataModule): void {
    if (this.sealed) throw new Error("能力注册已封闭");
    if (!/^[a-z][a-z0-9-]*$/.test(module.id)) throw new Error("模块标识无效");
    if (this.modules.has(module.id)) throw new Error(`重复模块: ${module.id}`);
    if (
      module.kind !== "production" &&
      !(this.allowTestProviders && module.kind === "test")
    )
      throw new Error("不能注册测试提供者");
    if (
      ![
        module.lifecycle?.check,
        module.lifecycle?.revoke,
        module.lifecycle?.cleanup,
      ].every((fn) => typeof fn === "function")
    )
      throw new Error(`生命周期不完整: ${module.id}`);
    if (new Set(module.capabilities).size !== module.capabilities.length)
      throw new Error(`重复能力声明: ${module.id}`);
    for (const capability of module.capabilities) {
      if (!required.includes(capability) || this.provider(capability))
        throw new Error(`无效或重复能力: ${capability}`);
    }
    if (
      (module.capabilities.includes("campus") && !module.campus?.read) ||
      (module.capabilities.includes("resources") &&
        (!module.resources?.read || !module.resources?.hasActiveCaptainTeam)) ||
      (module.capabilities.includes("school-sessions") &&
        !module.schoolSessions?.destroy)
    )
      throw new Error(`能力接口不完整: ${module.id}`);
    if (
      (module.campus && !module.capabilities.includes("campus")) ||
      (module.resources && !module.capabilities.includes("resources")) ||
      (module.schoolSessions &&
        !module.capabilities.includes("school-sessions"))
    )
      throw new Error(`提供者未声明能力: ${module.id}`);
    this.modules.set(
      module.id,
      Object.freeze({
        ...module,
        capabilities: Object.freeze([...module.capabilities]),
      }),
    );
  }

  provider(capability: Capability): DataModule | undefined {
    return this.all().find((module) =>
      module.capabilities.includes(capability),
    );
  }

  all(): readonly DataModule[] {
    return [...this.modules.values()];
  }

  assertReady(enabled: boolean): void {
    if (!enabled) return;
    const missing = required.filter((capability) => !this.provider(capability));
    if (missing.length)
      throw new Error(`敏感业务缺少能力: ${missing.join(", ")}`);
  }

  seal(enabled: boolean): void {
    this.assertReady(enabled);
    this.sealed = true;
  }
}
