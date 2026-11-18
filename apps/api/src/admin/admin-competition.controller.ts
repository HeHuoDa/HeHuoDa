import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import type { AdminRequest } from "./admin.guard.js";
import {
  AdminCompetitionBaselineDto,
  AdminCompetitionCommandDto,
  AdminCompetitionCommandResultDto,
  AdminCompetitionDto,
  AdminCompetitionListDto,
  AdminCompetitionListQueryDto,
  AdminCompetitionPreviewDto,
  AdminCompetitionPreviewResultDto,
} from "./admin-competition.dto.js";
import { AdminCompetitionService } from "./admin-competition.service.js";

@ApiTags("管理员比赛")
@ApiCookieAuth("adminSession")
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiUnprocessableEntityResponse({ type: ApiErrorDto })
@Controller("admin/competitions")
export class AdminCompetitionController {
  constructor(private readonly service: AdminCompetitionService) {}

  @Get()
  @ApiOkResponse({
    type: AdminCompetitionListDto,
    description: "全部发布状态（draft/published/hidden）的分页列表",
  })
  list(@Query() query: AdminCompetitionListQueryDto) {
    return this.service.list(query);
  }

  @Get("baseline/:id")
  @ApiOkResponse({
    type: AdminCompetitionBaselineDto,
    description: "目标届次当前正式基线；不存在时返回空记录基线",
  })
  baseline(@Param("id") id: string) {
    return this.service.baseline(id);
  }

  @Get(":id")
  @ApiOkResponse({
    type: AdminCompetitionDto,
    description: "管理端详情，含不可见于公开端的 draft/hidden 记录",
  })
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post(":id/preview")
  @HttpCode(200)
  @ApiOkResponse({
    type: AdminCompetitionPreviewResultDto,
    description: "变更预览；不提交正式数据，返回预览回执与发布底线缺口",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  preview(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() command: AdminCompetitionPreviewDto,
  ) {
    return this.service.preview(request.admin!, id, command);
  }

  @Post(":id/commands")
  @HttpCode(200)
  @ApiOkResponse({
    type: AdminCompetitionCommandResultDto,
    description: "保存草稿、发布或隐藏；同一 operationId 重试返回首次结果",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  execute(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() command: AdminCompetitionCommandDto,
  ) {
    return this.service.execute(request.admin!, id, command);
  }
}
