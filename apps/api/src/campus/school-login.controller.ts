import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { assertEmptyBody } from "../common/empty-body.js";
import { toH5Credential } from "../auth/h5-security.js";
import {
  SchoolLoginChallengeResponseDto,
  SchoolLoginCredentialDto,
  SchoolLoginH5CredentialDto,
  SchoolLoginHolderQueryDto,
  SchoolLoginSubmitDto,
  SchoolLoginTransactionDto,
} from "./school-login.dto.js";
import { SchoolLoginService } from "./school-login.service.js";

// 匿名登录入口：不使用 AuthGuard。客户端只持有事务 ID 与不可猜测的持有凭证。
// 与 /campus-verification 的已登录核验路由并存，后者仍受 Bearer 保护。
@ApiTags("统一身份认证登录")
@Controller("auth/school")
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiTooManyRequestsResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
export class SchoolLoginController {
  constructor(private readonly service: SchoolLoginService) {}

  @Post("challenges")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "匿名申请统一身份认证事务与验证码，返回持有凭证",
  })
  @ApiCreatedResponse({ type: SchoolLoginChallengeResponseDto })
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    assertEmptyBody(body);
    return this.service.create(request.ip ?? "unknown", request.id);
  }

  @Post("challenges/:id/captcha")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "刷新验证码；不延长总期限、不重建持有凭证" })
  @ApiOkResponse({ type: SchoolLoginChallengeResponseDto })
  refresh(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: SchoolLoginHolderQueryDto,
  ) {
    return this.service.refreshChallenge(
      id,
      body.holderToken,
      request.ip ?? "unknown",
      request.id,
    );
  }

  @Post("challenges/:id/submit")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "提交姓名、学号、密码与验证码；成功时一次性签发原生 Bearer 会话",
  })
  @ApiOkResponse({ type: SchoolLoginCredentialDto })
  submit(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: SchoolLoginSubmitDto,
  ) {
    this.service.assertNativeBoundary(request.headers);
    const { holderToken, ...input } = body;
    return this.service.submit(
      id,
      holderToken,
      input,
      request.ip ?? "unknown",
      request.id,
      "native",
    );
  }

  @Post("challenges/:id/submit/h5")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "H5 提交姓名、学号、密码与验证码；成功时通过 HttpOnly Cookie 下发刷新凭据，JSON 仅返回短期访问凭据",
  })
  @ApiHeader({
    name: "Origin",
    required: false,
    description: "精确匹配允许的 H5 Origin（缺失时回退检查 Referer 源）",
  })
  @ApiHeader({
    name: "X-Refresh-CSRF",
    required: true,
    description: "固定 CSRF 防护头，值为 1",
  })
  @ApiOkResponse({ type: SchoolLoginH5CredentialDto })
  async submitH5(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
    @Body() body: SchoolLoginSubmitDto,
  ): Promise<SchoolLoginH5CredentialDto> {
    this.service.assertH5Security(request.headers);
    const { holderToken, ...input } = body;
    const result = await this.service.submit(
      id,
      holderToken,
      input,
      request.ip ?? "unknown",
      request.id,
      "h5",
    );
    if (!result.credential) {
      return {
        id: result.id,
        status: result.status,
        expiresAt: result.expiresAt,
        reason: result.reason,
      };
    }
    reply.header(
      "Set-Cookie",
      this.service.buildH5Cookie(
        result.credential.refreshToken,
        new Date(result.credential.sessionExpiresAt),
      ),
    );
    return {
      id: result.id,
      status: result.status,
      expiresAt: result.expiresAt,
      reason: result.reason,
      credential: toH5Credential(result.credential),
    };
  }

  @Post("challenges/:id/status")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "按持有凭证查询原事务的安全状态" })
  @ApiOkResponse({ type: SchoolLoginTransactionDto })
  status(@Param("id") id: string, @Body() body: SchoolLoginHolderQueryDto) {
    return this.service.get(id, body.holderToken);
  }

  @Delete("challenges/:id")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "取消原事务；已提交终态不改写" })
  @ApiOkResponse({ type: SchoolLoginTransactionDto })
  cancel(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: SchoolLoginHolderQueryDto,
  ) {
    return this.service.cancel(id, body.holderToken, request.id);
  }

  // DELETE 携 body 在部分代理/网关会被丢弃，提供等价 POST 别名；
  // 两者共用同一服务与契约，客户端可按运行环境选用。
  @Post("challenges/:id/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "取消原事务（POST 别名，避免代理丢弃 DELETE body）",
  })
  @ApiOkResponse({ type: SchoolLoginTransactionDto })
  cancelByPost(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: SchoolLoginHolderQueryDto,
  ) {
    return this.service.cancel(id, body.holderToken, request.id);
  }
}
