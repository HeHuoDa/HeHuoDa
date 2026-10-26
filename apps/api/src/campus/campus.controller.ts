import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { CampusService } from "./campus.service.js";
import { createApiError } from "../common/api-error.js";
import {
  CampusPolicyDto,
  CampusProfileResponseDto,
  CampusStatusResponseDto,
  CampusSubmitDto,
  CampusTransactionDto,
} from "./campus.dto.js";

@ApiTags("统一身份认证")
@Controller("campus-verification")
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiTooManyRequestsResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
export class CampusController {
  constructor(private readonly campus: CampusService) {}
  @Get("policy")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusPolicyDto })
  policy() {
    return this.campus.policy();
  }
  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusStatusResponseDto })
  status(@Req() r: AuthenticatedRequest) {
    return this.campus.status(r.auth!);
  }
  @Get("profile")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusProfileResponseDto })
  profile(@Req() r: AuthenticatedRequest) {
    return this.campus.profile(r.auth!);
  }
  @Post("transactions")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusTransactionDto })
  create(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    this.assertEmptyBody(body);
    return this.campus.create(r.auth!, r.ip, r.id);
  }
  @Post("transactions/:id/captcha")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusTransactionDto })
  refresh(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.assertEmptyBody(body);
    return this.campus.refresh(r.auth!, id, r.ip, r.id);
  }
  @Post("transactions/:id/submit")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusTransactionDto })
  submit(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: CampusSubmitDto,
  ) {
    return this.campus.submit(r.auth!, id, b, r.ip, r.id);
  }
  @Get("transactions/:id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusTransactionDto })
  get(@Req() r: AuthenticatedRequest, @Param("id") id: string) {
    return this.campus.get(r.auth!, id);
  }
  @Delete("transactions/:id")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CampusTransactionDto })
  cancel(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.assertEmptyBody(body);
    return this.campus.cancel(r.auth!, id, r.id);
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
