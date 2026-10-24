import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { authRateLimits } from "../database/schema.js";
import { RATE_LIMIT_WINDOW_SECONDS } from "./auth.constants.js";

export function windowStart(now: Date): Date {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

@Injectable()
export class AuthRateLimiter {
  constructor(private readonly database: DatabaseService) {}

  // 固定窗口计数：先递增再由调用方判断是否超预算，被拒绝的尝试同样计入。
  async consume(kind: string, subject: string, now: Date): Promise<number> {
    const result = await this.database.db
      .insert(authRateLimits)
      .values({ kind, subject, windowStartedAt: windowStart(now), count: 1 })
      .onConflictDoUpdate({
        target: [
          authRateLimits.kind,
          authRateLimits.subject,
          authRateLimits.windowStartedAt,
        ],
        set: { count: sql`${authRateLimits.count} + 1` },
      })
      .returning({ count: authRateLimits.count });
    return result[0].count;
  }
}
