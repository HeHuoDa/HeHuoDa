import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  AdminCandidateListQueryDto,
  AdminClassificationCommandDto,
  AdminCandidateOperationsQueryDto,
  AdminNoticeListQueryDto,
  AdminReviewPageQueryDto,
  AdminReviewImportCommandDto,
  AdminReviewMaterialCommandDto,
  AdminReviewPublishCommandDto,
  AdminReviewQueryDto,
  AdminReviewStateCommandDto,
} from "./admin-review.dto.js";
import { AdminReviewService } from "./admin-review.service.js";
import {
  AdminCandidateDetailDto,
  AdminClassificationResultDto,
  AdminCandidateListDto,
  AdminCandidateOperationsDto,
  AdminImportResultDto,
  AdminNoticeDetailDto,
  AdminNoticeListDto,
  AdminNoticeVersionDetailDto,
  AdminNoticeVersionListDto,
  AdminReviewApprovedResultDto,
  AdminReviewFileDto,
  AdminReviewImportPreviewResultDto,
  AdminReviewPublishPreviewResultDto,
  AdminReviewSavedResultDto,
  AdminReviewStateResultDto,
} from "./admin-review-response.dto.js";

@ApiTags("管理员采集审核")
@ApiCookieAuth("adminSession")
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiUnprocessableEntityResponse({ type: ApiErrorDto })
@Controller("admin/ingestion")
export class AdminReviewController {
  constructor(private readonly service: AdminReviewService) {}

  @Get("candidates")
  @ApiOkResponse({
    type: AdminCandidateListDto,
    description: "候选分页；包含采集证据及正式映射",
  })
  listCandidates(@Query() query: AdminCandidateListQueryDto) {
    return this.service.listCandidates(query);
  }

  @Get("candidates/:id")
  @ApiOkResponse({ type: AdminCandidateDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  candidate(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.candidateDetail(id);
  }

  @Post("candidates/:id/classification")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminClassificationResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  classify(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminClassificationCommandDto,
  ) {
    return this.service.classify(request.admin!, id, command);
  }

  @Get("candidates/:id/review")
  @ApiOkResponse({
    type: AdminReviewFileDto,
    description: "审核材料；原文与证据以纯文本返回",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  review(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: AdminReviewQueryDto,
  ) {
    return this.service.review(id, query);
  }

  @Put("candidates/:id/review")
  @ApiOkResponse({ type: AdminReviewSavedResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  saveReview(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewMaterialCommandDto,
  ) {
    return this.service.saveReview(request.admin!, id, command);
  }

  @Post("candidates/:id/approve")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminReviewApprovedResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  approve(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewMaterialCommandDto,
  ) {
    return this.service.approve(request.admin!, id, command);
  }

  @Post("candidates/:id/reject")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminReviewStateResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  reject(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewStateCommandDto,
  ) {
    return this.service.reviewState(request.admin!, id, "reject", command);
  }

  @Post("candidates/:id/reopen")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminReviewStateResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  reopen(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewStateCommandDto,
  ) {
    return this.service.reviewState(request.admin!, id, "reopen", command);
  }

  @Post("candidates/:id/import-preview")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminReviewImportPreviewResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  importPreview(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewMaterialCommandDto,
  ) {
    return this.service.importPreview(request.admin!, id, command);
  }

  @Post("candidates/:id/import")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminImportResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  importReview(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewImportCommandDto,
  ) {
    return this.service.importReview(request.admin!, id, command);
  }

  @Post("candidates/:id/publish-preview")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminReviewPublishPreviewResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  publishPreview(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewStateCommandDto,
  ) {
    return this.service.publishPreview(request.admin!, id, command);
  }

  @Post("candidates/:id/publish")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminImportResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  publish(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() command: AdminReviewPublishCommandDto,
  ) {
    return this.service.publish(request.admin!, id, command);
  }

  @Get("candidates/:id/operations")
  @ApiOkResponse({
    type: AdminCandidateOperationsDto,
    description: "候选操作历史，包含 CLI 与管理员审核操作",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  operations(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: AdminCandidateOperationsQueryDto,
  ) {
    return this.service.candidateOperations(id, query);
  }

  @Get("notices")
  @ApiOkResponse({
    type: AdminNoticeListDto,
    description: "通知与当前不可变内容版本分页",
  })
  notices(@Query() query: AdminNoticeListQueryDto) {
    return this.service.listNotices(query);
  }

  @Get("notices/:id")
  @ApiOkResponse({ type: AdminNoticeDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  notice(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.noticeDetail(id);
  }

  @Get("notices/:id/versions")
  @ApiOkResponse({ type: AdminNoticeVersionListDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  versions(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: AdminReviewPageQueryDto,
  ) {
    return this.service.noticeVersions(id, query);
  }

  @Get("notices/:id/versions/:versionId")
  @ApiOkResponse({
    type: AdminNoticeVersionDetailDto,
    description: "正文快照、安全纯文本与相对上一版本的差异",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  version(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("versionId", new ParseUUIDPipe()) versionId: string,
  ) {
    return this.service.noticeVersion(id, versionId);
  }
}
