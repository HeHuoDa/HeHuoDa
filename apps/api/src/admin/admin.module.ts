import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { AuthRateLimiter } from "../auth/auth-rate-limiter.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminOperationsService } from "./admin-operations.service.js";
import { AdminIngestionOperation } from "../ingestion/admin-ingestion-operation.js";
import { AdminIngestionController } from "../ingestion/admin-ingestion.controller.js";
import { AdminIngestionService } from "../ingestion/admin-ingestion.service.js";
import { AdminReviewController } from "./admin-review.controller.js";
import { AdminReviewService } from "./admin-review.service.js";
import { AdminAttachmentController } from "../ingestion/admin-attachment.controller.js";
import { AdminAttachmentService } from "../ingestion/admin-attachment.service.js";
@Module({
  imports: [AuthPersistenceModule],
  controllers: [
    AdminController,
    AdminIngestionController,
    AdminReviewController,
    AdminAttachmentController,
  ],
  providers: [
    AdminOperationsService,
    AdminIngestionOperation,
    AdminIngestionService,
    AdminReviewService,
    AdminAttachmentService,
    AdminService,
    AuthRateLimiter,
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
  exports: [AdminService, AdminOperationsService],
})
export class AdminModule {}
