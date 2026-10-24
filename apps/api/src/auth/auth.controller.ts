import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import {
  CredentialResponseDto,
  ProfileResponseDto,
  RefreshRequestDto,
  UpdateProfileRequestDto,
  WechatLoginRequestDto,
} from "./auth.dto.js";

const NO_STORE = "no-store";

@ApiTags("认证")
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
  @ApiOperation({ summary: "轮换凭据；旧刷新凭据立即作废" })
  @ApiOkResponse({ type: CredentialResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  async refresh(
    @Body() body: RefreshRequestDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    return this.service.refresh(body, {
      requestId: request.id,
      ip: request.ip ?? "unknown",
    });
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: "撤销当前会话族" })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", NO_STORE);
    await this.service.logout(request.auth!, request.id);
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
}
