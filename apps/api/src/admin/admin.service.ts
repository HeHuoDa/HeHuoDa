import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AuthRepository } from "../auth/auth.repository.js";
import { AuthRateLimiter } from "../auth/auth-rate-limiter.js";
import { createApiError } from "../common/api-error.js";
import {
  ADMIN_COOKIE,
  adminOrigins,
  csrfToken,
  digest,
  equalHash,
  newSecret,
  passwordHash,
  sessionToken,
} from "./admin-security.js";
import type { AdminLoginDto, AdminSessionDto } from "./admin.dto.js";

export interface AdminContext {
  id: string;
  sessionId: string;
  displayName: string;
  expiresAt: Date;
  csrfHash: Buffer;
  requestId: string;
}

@Injectable()
export class AdminService {
  constructor(
    readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly students: AuthRepository,
    private readonly limiter: AuthRateLimiter,
  ) {}

  origins(): string[] {
    return adminOrigins(
      this.config.get<string>("ADMIN_ALLOWED_ORIGINS", ""),
      this.config.get("NODE_ENV") === "production",
    );
  }
  checkOrigin(origin: string | undefined): void {
    if (!origin || !this.origins().includes(origin))
      throw new ForbiddenException();
  }
  cookie(token: string, expiresAt?: Date): string {
    return `${ADMIN_COOKIE}=${token}; Path=/api/v1/admin; HttpOnly; SameSite=Lax; ${expiresAt ? `Expires=${expiresAt.toUTCString()}` : "Max-Age=0"}${this.config.get("NODE_ENV") === "production" ? "; Secure" : ""}`;
  }
  publicSession(context: AdminContext): AdminSessionDto {
    return {
      id: context.id,
      displayName: context.displayName,
      expiresAt: context.expiresAt.toISOString(),
    };
  }
  async authenticate(
    cookie: string | undefined,
    authorization: string | undefined,
    requestId: string,
  ): Promise<AdminContext | undefined> {
    const token = sessionToken(cookie);
    if (token) {
      const result = await this.database.pool.query<{
        id: string;
        sessionId: string;
        displayName: string;
        expiresAt: Date;
        csrfHash: Buffer;
      }>(
        `SELECT a.id, s.id AS "sessionId", a.display_name AS "displayName", s.expires_at AS "expiresAt", s.csrf_hash AS "csrfHash"
          FROM admin_sessions s JOIN admin_accounts a ON a.id=s.account_id
          WHERE s.token_hash=$1 AND a.active AND s.revoked_at IS NULL AND s.expires_at>now()`,
        [digest(token)],
      );
      if (result.rows[0]) return { ...result.rows[0], requestId };
    }
    if (
      authorization?.startsWith("Bearer ") &&
      (await this.students.findActiveAccess(authorization.slice(7), new Date()))
    )
      throw new ForbiddenException();
    return undefined;
  }
  async login(
    body: AdminLoginDto,
    ip: string,
    requestId: string,
    oldCookie?: string,
  ) {
    const now = new Date();
    const budgets: [string, string, number][] = [
      ["source", ip, this.config.get<number>("ADMIN_RATE_LOGIN_SOURCE", 30)],
      [
        "account",
        body.username,
        this.config.get<number>("ADMIN_RATE_LOGIN_ACCOUNT", 5),
      ],
      [
        "global",
        "all",
        this.config.get<number>("ADMIN_RATE_LOGIN_GLOBAL", 100),
      ],
    ];
    const counts = await Promise.all(
      budgets.map(([kind, subject]) =>
        this.limiter.consume(
          "admin-login-" + kind,
          digest(subject).toString("hex"),
          now,
        ),
      ),
    );
    if (counts.some((count, i) => count > budgets[i]![2]))
      throw createApiError(429, "TOO_MANY_REQUESTS", "请求过于频繁");
    const found = await this.database.pool.query<{
      id: string;
      password_salt: Buffer;
      password_hash: Buffer;
    }>(
      "SELECT id,password_salt,password_hash FROM admin_accounts WHERE username=$1",
      [body.username],
    );
    const account = found.rows[0];
    // Unknown accounts do the same expensive hash; failure wording never reveals existence.
    const hash = await passwordHash(
      body.password,
      account?.password_salt ?? Buffer.alloc(16),
    );
    if (!account || !equalHash(hash, account.password_hash)) {
      await this.database.pool.query(
        `INSERT INTO admin_operations(actor_type,action,object_type,reason,result,request_id) VALUES ('anonymous','auth.login','account','凭据无效','failure',$1)`,
        [requestId],
      );
      throw new UnauthorizedException();
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        display_name: string;
        active: boolean;
        password_hash: Buffer;
      }>(
        "SELECT display_name,active,password_hash FROM admin_accounts WHERE id=$1 FOR UPDATE",
        [account.id],
      );
      const row = current.rows[0];
      if (!row?.active || !equalHash(row.password_hash, hash)) {
        await client.query(
          `INSERT INTO admin_operations(actor_type,action,object_type,reason,result,request_id) VALUES ('anonymous','auth.login','account','凭据无效','failure',$1)`,
          [requestId],
        );
        await client.query("COMMIT");
        throw new UnauthorizedException();
      }
      const token = newSecret();
      const csrf = csrfToken(token);
      const expiresAt = new Date(
        Date.now() +
          this.config.get<number>("ADMIN_SESSION_HOURS", 12) * 3600000,
      );
      const oldToken = sessionToken(oldCookie);
      if (oldToken)
        await client.query(
          "UPDATE admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
          [digest(oldToken)],
        );
      await client.query(
        "INSERT INTO admin_sessions(account_id,token_hash,csrf_hash,expires_at) VALUES ($1,$2,$3,$4)",
        [account.id, digest(token), digest(csrf), expiresAt],
      );
      await client.query(
        `INSERT INTO admin_operations(actor_type,actor_id,action,object_type,object_id,reason,result,request_id) VALUES ('admin',$1::uuid,'auth.login','account',$1::uuid::text,'管理员登录','success',$2)`,
        [account.id, requestId],
      );
      await client.query("COMMIT");
      return {
        token,
        session: {
          id: account.id,
          displayName: row.display_name,
          expiresAt: expiresAt.toISOString(),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  checkCsrf(context: AdminContext, token: string | string[] | undefined): void {
    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !equalHash(digest(token), context.csrfHash)
    )
      throw new ForbiddenException();
  }
  async logout(context: AdminContext) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockContext(client, context);
      await client.query(
        "UPDATE admin_sessions SET revoked_at=now() WHERE id=$1",
        [context.sessionId],
      );
      await client.query(
        `INSERT INTO admin_operations(actor_type,actor_id,action,object_type,object_id,reason,result,request_id) VALUES ('admin',$1,'auth.logout','session',$2,'管理员退出','success',$3)`,
        [context.id, context.sessionId, context.requestId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async lockContext(client: PoolClient, context: AdminContext): Promise<void> {
    // Account then session lock order is shared by login and writes.
    const account = await client.query(
      "SELECT id FROM admin_accounts WHERE id=$1 AND active FOR UPDATE",
      [context.id],
    );
    const session = await client.query(
      "SELECT id FROM admin_sessions WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
      [context.sessionId, context.id],
    );
    if (!account.rowCount || !session.rowCount)
      throw new UnauthorizedException();
  }
}

export async function createAdminAccount(
  client: PoolClient,
  username: string,
  displayName: string,
  password: string,
): Promise<string> {
  if (
    !/^[a-zA-Z0-9._-]{1,64}$/.test(username) ||
    !displayName.trim() ||
    displayName.length > 80 ||
    password.length < 12 ||
    password.length > 256
  )
    throw new Error("管理员资料格式无效，密码需要12–256字符");
  const salt = randomBytes(16);
  const hash = await passwordHash(password, salt);
  const result = await client.query<{ id: string }>(
    "INSERT INTO admin_accounts(username,display_name,password_salt,password_hash) VALUES ($1,$2,$3,$4) RETURNING id",
    [username, displayName.trim(), salt, hash],
  );
  const id = result.rows[0]!.id;
  await client.query(
    `INSERT INTO admin_operations(actor_type,action,object_type,object_id,reason,result,request_id) VALUES ('maintenance','account.create','account',$1,'受控初始化','success','admin-init')`,
    [id],
  );
  return id;
}
