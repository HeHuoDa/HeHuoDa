import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { authDataModule } from "./auth-data-module.js";
import { CapabilityRegistry } from "./capabilities.js";
import { AccountLifecycle } from "./lifecycle.service.js";

@Module({
  providers: [
    {
      provide: CapabilityRegistry,
      useFactory: () => {
        const registry = new CapabilityRegistry();
        registry.register(authDataModule());
        return registry;
      },
    },
    AccountLifecycle,
  ],
  exports: [CapabilityRegistry, AccountLifecycle],
})
export class LifecycleModule implements OnModuleInit {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly config: ConfigService,
  ) {}
  onModuleInit(): void {
    this.registry.seal(
      this.config.get<boolean>("SENSITIVE_BUSINESS_ENABLED", false),
      ["auth"],
    );
  }
}
