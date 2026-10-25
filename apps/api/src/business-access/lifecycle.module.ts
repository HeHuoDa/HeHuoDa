import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { authDataModule } from "./auth-data-module.js";
import { CapabilityRegistry } from "./capabilities.js";
import { AccountLifecycle } from "./lifecycle.service.js";
import { CampusCoreModule } from "../campus/campus-core.module.js";
import { CampusService } from "../campus/campus.service.js";

@Module({
  imports: [CampusCoreModule],
  providers: [
    {
      provide: CapabilityRegistry,
      useFactory: (campus: CampusService) => {
        const registry = new CapabilityRegistry();
        registry.register(authDataModule());
        registry.register(campus.dataModule());
        return registry;
      },
      inject: [CampusService],
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
      ["auth", "campus"],
    );
  }
}
