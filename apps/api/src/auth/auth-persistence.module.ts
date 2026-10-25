import { Module } from "@nestjs/common";
import { AuthClock } from "./auth-clock.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthRepository } from "./auth.repository.js";
@Module({
  providers: [AuthClock, AuthGuard, AuthRepository],
  exports: [AuthClock, AuthGuard, AuthRepository],
})
export class AuthPersistenceModule {}
