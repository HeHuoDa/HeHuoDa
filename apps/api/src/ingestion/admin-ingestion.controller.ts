import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { AdminRequest } from "../admin/admin.guard.js";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { AdminIngestionService } from "./admin-ingestion.service.js";
import {
  ConfigureSourceDto,
  IngestionAcceptedDto,
  IngestionCommandDto,
  IngestionPageQueryDto,
  IngestionRequestDto,
  IngestionRunDto,
  IngestionRunsDto,
  IngestionSourceDto,
  ScanDto,
} from "./admin-ingestion.dto.js";

@ApiTags("管理采集")
@ApiCookieAuth("adminSession")
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@Controller("admin/ingestion")
export class AdminIngestionController {
  constructor(private readonly service: AdminIngestionService) {}
  @Get("sources")
  @ApiOkResponse({ type: IngestionSourceDto, isArray: true })
  sources() {
    return this.service.sourceList();
  }
  @Get("sources/:id")
  @ApiOkResponse({ type: IngestionSourceDto })
  source(@Param("id") id: string) {
    return this.service.sourceDetail(id);
  }
  @Patch("sources/:id")
  @ApiOkResponse({ type: IngestionSourceDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  configure(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: ConfigureSourceDto,
  ) {
    return this.service.configure(request.admin!, id, body);
  }
  @Get("runs")
  @ApiOkResponse({ type: IngestionRunsDto })
  runs(@Query() query: IngestionPageQueryDto) {
    return this.service.runs(query);
  }
  @Get("runs/:id")
  @ApiOkResponse({ type: IngestionRunDto })
  run(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.runDetail(id);
  }
  @Post("scans")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: IngestionAcceptedDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  scan(@Req() request: AdminRequest, @Body() body: ScanDto) {
    return this.service.scan(request.admin!, body);
  }
  @Get("requests/:id")
  @ApiOkResponse({ type: IngestionRequestDto })
  request(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.requestDetail(id);
  }
  @Post("requests/:id/retry")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: IngestionAcceptedDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  retry(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: IngestionCommandDto,
  ) {
    return this.service.retry(request.admin!, id, body);
  }
  @Post("runs/:id/resume")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: IngestionAcceptedDto })
  @ApiHeader({ name: "Origin", required: true })
  @ApiHeader({ name: "X-CSRF-Token", required: true })
  resume(
    @Req() request: AdminRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: IngestionCommandDto,
  ) {
    return this.service.resume(request.admin!, id, body);
  }
}
