import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createApiError } from "../common/api-error.js";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { assertEmptyBody } from "../common/empty-body.js";
import { createGlobalValidationPipe } from "../common/pipes/global-validation.pipe.js";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import {
  assertNativeClientBoundary,
  isH5ChannelRequest,
  readH5RefreshCookie,
  toH5Credential,
} from "./h5-security.js";
import {
  CredentialResponseDto,
  H5CredentialResponseDto,
  ProfileResponseDto,
  RefreshRequestDto,
  UpdateProfileRequestDto,
  WechatLoginRequestDto,
} from "./auth.dto.js";

const NO_STORE = "no-store";
const REFRESH_VALIDATION_PIPE = createGlobalValidationPipe();

@ApiTags("认证")
@ApiExtraModels(
  CredentialResponseDto,
  H5CredentialResponseDto,
  RefreshRequestDto,
)
@Controller("auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post("wechat/login")
  @HttpCode(200)
  @ApiOperation({ summary: "微信一键登录；首次登录自动创建平台账号" })
  @ApiOkResponse({ type: CredentialResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  async wechatLogin(
    @Body() body: WechatLoginRequestDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    return this.service.wechatLogin(body, {
      requestId: request.id,
      ip: request.ip ?? "unknown",
    });
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({
    summary: "轮换凭据；旧刷新凭据立即作废（支持原生 JSON 与 H5 Cookie 通道）",
  })
  @ApiHeader({
    name: "Origin",
    required: false,
    description:
      "H5 Cookie 通道校验允许的精确 Origin（缺失时回退检查 Referer 源）；原生 JSON 通道禁止携带",
  })
  @ApiHeader({
    name: "X-Refresh-CSRF",
    required: false,
    description: "H5 Cookie 通道必填，固定值为 1",
  })
  @ApiBody({
    required: false,
    description:
      "原生端传 JSON refreshToken；H5 端只接受空请求体并依赖 HttpOnly Cookie",
    schema: {
      oneOf: [
        { $ref: getSchemaPath(RefreshRequestDto) },
        { type: "object", additionalProperties: false, properties: {} },
      ],
    },
  })
  @ApiOkResponse({
    description:
      "原生端返回含 refreshToken 的完整凭据；H5 端仅返回短期访问凭据并通过 Set-Cookie 轮换刷新令牌",
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CredentialResponseDto) },
        { $ref: getSchemaPath(H5CredentialResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  async refresh(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CredentialResponseDto | H5CredentialResponseDto> {
    reply.header("Cache-Control", NO_STORE);
    const ctx = {
      requestId: request.id,
      ip: request.ip ?? "unknown",
    };
    if (isH5ChannelRequest(request.headers)) {
      this.prepareH5Request(request, body);
      const cookie = readH5RefreshCookie(request.headers.cookie);
      try {
        const result = await this.service.refresh(
          cookie.state === "present"
            ? { refreshToken: cookie.token }
            : {
                refreshToken: null,
                rejectedReason:
                  cookie.state === "invalid"
                    ? "invalid_cookie"
                    : "missing_cookie",
              },
          ctx,
          "h5",
        );
        reply.header(
          "Set-Cookie",
          this.service.buildH5Cookie(
            result.refreshToken,
            new Date(result.sessionExpiresAt),
          ),
        );
        return toH5Credential(result);
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 401) {
          reply.header("Set-Cookie", this.service.clearH5Cookie());
        }
        throw error;
      }
    }

    assertNativeClientBoundary(request.headers);
    const dto = (await REFRESH_VALIDATION_PIPE.transform(body, {
      type: "body",
      metatype: RefreshRequestDto,
    })) as RefreshRequestDto;
    return this.service.refresh(dto, ctx, "native");
  }

  @Post("logout")
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiCookieAuth("userRefresh")
  @ApiOperation({ summary: "撤销当前会话族（原生 Bearer 或 H5 Cookie 通道）" })
  @ApiHeader({
    name: "Origin",
    required: false,
    description:
      "H5 Cookie 通道校验允许的精确 Origin（缺失时回退检查 Referer 源）",
  })
  @ApiHeader({
    name: "X-Refresh-CSRF",
    required: false,
    description: "H5 Cookie 通道必填，固定值为 1",
  })
  @ApiBody({
    required: false,
    description: "H5 通道只接受空请求体",
    schema: { type: "object", additionalProperties: false, properties: {} },
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  async logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    if (isH5ChannelRequest(request.headers)) {
      this.prepareH5Request(request, body);
      const cookie = readH5RefreshCookie(request.headers.cookie);
      if (cookie.state !== "present") {
        reply.header("Set-Cookie", this.service.clearH5Cookie());
        return;
      }
      await this.service.logoutByRefresh(cookie.token, request.id, () => {
        reply.header("Set-Cookie", this.service.clearH5Cookie());
      });
      return;
    }

    const access = await this.service.authenticateAccess(
      request.headers.authorization,
    );
    await this.service.logout(access, request.id);
  }

  private prepareH5Request(request: FastifyRequest, body: unknown): void {
    this.service.assertH5Security(request.headers);
    if (request.headers.authorization !== undefined) {
      throw createApiError(400, "BAD_REQUEST", "不可同时使用多种认证凭据");
    }
    assertEmptyBody(body);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取当前账号、校园核验状态与能力开放情况" })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  me(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    return this.service.me(request.auth!);
  }

  @Patch("me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "修改本人昵称" })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  async updateProfile(
    @Body() body: UpdateProfileRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    return this.service.updateNickname(request.auth!, body, request.id);
  }

  // wx.request 的 method 不支持 PATCH（合法值仅 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT），
  // POST 别名供微信小程序端使用；与 PATCH 共用同一服务与校验。
  @Post("me")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "修改本人昵称（微信小程序端别名，wx.request 不支持 PATCH）",
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  async updateProfileForWechat(
    @Body() body: UpdateProfileRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    return this.service.updateNickname(request.auth!, body, request.id);
  }
}
