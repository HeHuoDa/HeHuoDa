import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { AuthRateLimiter } from "../auth/auth-rate-limiter.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminOperationsService } from "./admin-operations.service.js";
@Module({
  imports: [AuthPersistenceModule],
  controllers: [AdminController],
  providers: [
    AdminOperationsService,
    AdminService,
    AuthRateLimiter,
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
  exports: [AdminService, AdminOperationsService],
})
export class AdminModule {}
