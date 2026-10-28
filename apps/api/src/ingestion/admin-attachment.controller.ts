import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { AdminRequest } from "../admin/admin.guard.js";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import {
  AttachmentCommandDto,
  AttachmentReparseCommandDto,
  IngestionAcceptedDto,
  IngestionPageQueryDto,
} from "./admin-ingestion.dto.js";
import { AdminAttachmentService } from "./admin-attachment.service.js";
import {
  NoticeAttachmentsDto,
  AttachmentVersionsDto,
  AttachmentTextDto,
} from "./attachment-response.dto.js";

@ApiTags("附件审核证据")
@ApiCookieAuth("adminSession")
@Controller("admin/ingestion")
export class AdminAttachmentController {
  constructor(private readonly service: AdminAttachmentService) {}

  @Get("notices/:id/attachments")
  @ApiOkResponse({ type: NoticeAttachmentsDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  attachments(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.listForNotice(id);
  }

  @Get("attachments/:id/versions")
  @ApiOkResponse({ type: AttachmentVersionsDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  versions(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: IngestionPageQueryDto,
  ) {
    return this.service.versions(id, query);
  }

  @Get("attachments/:id/versions/:versionId")
  @ApiOkResponse({ type: AttachmentTextDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  version(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("versionId", new ParseUUIDPipe()) versionId: string,
    @Query() query: IngestionPageQueryDto,
  ) {
    return this.service.versionText(id, versionId, query);
  }

  @Post("attachments/:id/recheck")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: IngestionAcceptedDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  recheck(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: AttachmentCommandDto,
  ) {
    return this.service.recheck(request.admin!, id, body);
  }

  @Post("attachments/:id/reparse")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: IngestionAcceptedDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  reparse(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: AttachmentReparseCommandDto,
  ) {
    return this.service.reparse(request.admin!, id, body.versionId, body);
  }
}
