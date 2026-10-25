import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { LifecycleModule } from "./lifecycle.module.js";
import { BusinessPolicy } from "./business-policy.service.js";

@Module({
  imports: [AuthModule, LifecycleModule],
  providers: [BusinessPolicy],
  exports: [BusinessPolicy, LifecycleModule],
})
export class BusinessAccessModule {}
