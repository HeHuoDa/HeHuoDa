import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { createApiError } from "../common/api-error.js";
import {
  SchoolLoginChallengeResponseDto,
  SchoolLoginCredentialDto,
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
    this.assertEmptyBody(body);
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
    summary: "提交姓名、学号、密码与验证码；成功时一次性签发 Bearer 会话",
  })
  @ApiOkResponse({ type: SchoolLoginCredentialDto })
  submit(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: SchoolLoginSubmitDto,
  ) {
    const { holderToken, ...input } = body;
    return this.service.submit(
      id,
      holderToken,
      input,
      request.ip ?? "unknown",
      request.id,
    );
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

  private assertEmptyBody(body: unknown) {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    )
      throw createApiError(400, "BAD_REQUEST", "此操作不接受输入字段");
  }
}
