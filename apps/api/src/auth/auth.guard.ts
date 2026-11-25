import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthClock } from "./auth-clock.js";
import { AuthRepository, type AccessContext } from "./auth.repository.js";

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AccessContext;
}

export async function authenticateBearerAccess(
  repository: AuthRepository,
  clock: AuthClock,
  header: string | undefined,
): Promise<AccessContext> {
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken) throw new UnauthorizedException();
  const access = await repository.findActiveAccess(accessToken, clock.now());
  if (!access) throw new UnauthorizedException();
  return access;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly repository: AuthRepository,
    private readonly clock: AuthClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await authenticateBearerAccess(
      this.repository,
      this.clock,
      request.headers.authorization,
    );
    return true;
  }
}
