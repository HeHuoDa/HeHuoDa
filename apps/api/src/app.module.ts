import { DatabaseModule } from "./database/database.module.js";
import { IngestionModule } from "./ingestion/ingestion.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BusinessAccessModule } from "./business-access/business-access.module.js";
import { CompetitionRepository } from "./competitions/competition.repository.js";
import { CompetitionController } from "./competitions/competition.controller.js";
import {
  CompetitionClock,
  CompetitionService,
} from "./competitions/competition.service.js";
import { ConfigModule } from "@nestjs/config";
import { Module } from "@nestjs/common";
import { validateEnvironment } from "./config/env.validation.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";

@Module({
  imports: [
    DatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    IngestionModule,
    AuthModule,
    BusinessAccessModule,
  ],
  controllers: [HealthController, CompetitionController],
  providers: [
    HealthService,
    CompetitionClock,
    CompetitionService,
    CompetitionRepository,
  ],
})
export class AppModule {}
