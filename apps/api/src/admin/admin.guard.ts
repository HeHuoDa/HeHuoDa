import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AdminService, type AdminContext } from "./admin.service.js";

export interface AdminRequest extends FastifyRequest {
  admin?: AdminContext;
}
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly service: AdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const path = request.routeOptions.url ?? request.url.split("?")[0]!;
    if (path !== "/api/v1/admin" && !path.startsWith("/api/v1/admin/"))
      return true;
    const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (write || request.headers.origin)
      this.service.checkOrigin(request.headers.origin);
    if (
      write &&
      request.body &&
      typeof request.body === "object" &&
      ["actorId", "actorType", "reviewer"].some((key) =>
        Object.hasOwn(request.body as object, key),
      )
    )
      throw new BadRequestException();
    if (path === "/api/v1/admin/auth/login" && request.method === "POST")
      return true;
    const admin = await this.service.authenticate(
      request.headers.cookie,
      request.headers.authorization,
      request.id,
    );
    if (!admin) {
      if (path === "/api/v1/admin/auth/logout" && request.method === "POST")
        return true;
      throw new UnauthorizedException();
    }
    request.admin = admin;
    if (write) this.service.checkCsrf(admin, request.headers["x-csrf-token"]);
    return true;
  }
}
