import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  HttpCode,
  Query,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiCookieAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiSecurity,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { AdminService } from "./admin.service.js";
import type { AdminRequest } from "./admin.guard.js";
import { AdminLoginDto, AdminSessionDto, AdminCsrfDto } from "./admin.dto.js";
import { csrfToken, sessionToken } from "./admin-security.js";
import { AdminOperationsService } from "./admin-operations.service.js";
import {
  AdminDashboardDto,
  AdminOperationDto,
  AdminOperationsDto,
  OperationsQueryDto,
} from "./admin.dto.js";

@ApiTags("管理员")
@ApiCookieAuth("adminSession")
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller("admin")
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly operations: AdminOperationsService,
  ) {}
  @Post("auth/login")
  @ApiSecurity({})
  @HttpCode(200)
  @ApiOkResponse({ type: AdminSessionDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  async login(
    @Body() body: AdminLoginDto,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.service.login(
      body,
      request.ip,
      request.id,
      request.headers.cookie,
    );
    reply.header("Cache-Control", "no-store");
    reply.header(
      "Set-Cookie",
      this.service.cookie(result.token, new Date(result.session.expiresAt)),
    );
    return result.session;
  }
  @Get("auth/session")
  @ApiOkResponse({ type: AdminSessionDto })
  session(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminSessionDto {
    reply.header("Cache-Control", "no-store");
    return this.service.publicSession(request.admin!);
  }
  @Get("auth/csrf")
  @ApiOkResponse({ type: AdminCsrfDto })
  csrf(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminCsrfDto {
    reply.header("Cache-Control", "no-store");
    return { csrfToken: csrfToken(sessionToken(request.headers.cookie)!) };
  }
  @Post("auth/logout")
  @ApiSecurity({})
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  async logout(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (request.admin) await this.service.logout(request.admin);
    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", this.service.cookie(""));
  }

  @Get("dashboard")
  @ApiOkResponse({ type: AdminDashboardDto })
  dashboard(): Promise<AdminDashboardDto> {
    return this.operations.dashboard();
  }

  @Get("operations")
  @ApiOkResponse({ type: AdminOperationsDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: OperationsQueryDto): Promise<AdminOperationsDto> {
    return this.operations.list(query);
  }

  @Get("operations/:id")
  @ApiOkResponse({ type: AdminOperationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  detail(
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AdminOperationDto> {
    return this.operations.detail(id);
  }
}
