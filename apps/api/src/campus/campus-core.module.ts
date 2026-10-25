import { Module } from "@nestjs/common";
import { SchoolAuthClient } from "@hehuoda/sicau-connectors/auth";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { CampusService } from "./campus.service.js";
@Module({
  imports: [AuthPersistenceModule],
  providers: [
    CampusService,
    { provide: SchoolAuthClient, useFactory: () => new SchoolAuthClient() },
  ],
  exports: [CampusService],
})
export class CampusCoreModule {}
