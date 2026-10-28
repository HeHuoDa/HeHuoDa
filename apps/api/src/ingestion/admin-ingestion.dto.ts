import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  AdminArticleDto,
  AdminParsedCandidateDto,
} from "../admin/admin-review-response.dto.js";
import {
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class IngestionCommandDto {
  @ApiProperty({ format: "uuid", description: "每个写操作独立的幂等标识" })
  @IsUUID()
  operationId!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  reason!: string;
}
export class ScanDto extends IngestionCommandDto {
  @ApiProperty() @IsString() @Length(1, 100) sourceId!: string;
  @ApiPropertyOptional({ example: "2026-01-01" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional({ example: "2026-10-27" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
  @ApiPropertyOptional({ description: "固定来源的同源 HTTPS 通知地址" })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  url?: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
  @ApiPropertyOptional({ description: "已登记的静态栏目 ID" })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  channelId?: string;
  @ApiPropertyOptional({ enum: ["fresh", "backfill", "revisit", "retry"] })
  @IsOptional()
  @IsIn(["fresh", "backfill", "revisit", "retry"])
  phase?: "fresh" | "backfill" | "revisit" | "retry";
  @ApiPropertyOptional({ description: "因配置变化显式重建的扫描任务 ID" })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  rebuildTaskId?: string;
}
export class SourceSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxPages?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  frequencyMinutes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requests?: number;
  @ApiPropertyOptional({ minimum: 2000, maximum: 60000 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(60000)
  intervalMs?: number;
  @ApiPropertyOptional({ minimum: 1000, maximum: 30000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(30000)
  timeoutMs?: number;
  @ApiPropertyOptional({ minimum: 1000, maximum: 900000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(900000)
  durationMs?: number;
  @ApiPropertyOptional({ minimum: 1024, maximum: 5242880 })
  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(5242880)
  bytes?: number;
}
export class ConfigureSourceDto extends IngestionCommandDto {
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) baseline!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: SourceSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SourceSettingsDto)
  settings?: SourceSettingsDto;
}
export class ConfigureChannelDto extends IngestionCommandDto {
  @ApiProperty({ description: "当前栏目状态与静态定义基线" })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  baseline!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
  @ApiPropertyOptional({ type: SourceSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SourceSettingsDto)
  settings?: SourceSettingsDto;
}
export class VerifyChannelDto extends IngestionCommandDto {
  @ApiProperty({ enum: ["verified", "rejected", "pending"] })
  @IsIn(["verified", "rejected", "pending"])
  status!: "verified" | "rejected" | "pending";
  @ApiProperty({ example: "2026-10-28", format: "date" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkedAt!: string;
  @ApiProperty({
    type: [String],
    minItems: 1,
    description: "已核验的公开通知样本 URL",
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 2048, { each: true })
  sampleUrls!: string[];
  @ApiProperty({ enum: ["success", "failed", "inconclusive"] })
  @IsIn(["success", "failed", "inconclusive"])
  paginationResult!: "success" | "failed" | "inconclusive";
}
export class IngestionPageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sourceId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  channelId?: string;
  @ApiPropertyOptional({
    enum: ["running", "succeeded", "partial", "failed", "interrupted"],
  })
  @IsOptional()
  @IsIn(["running", "succeeded", "partial", "failed", "interrupted"])
  status?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
export class IngestionRunOptionsDto {
  @ApiProperty() sourceId!: string;
  @ApiPropertyOptional({ example: "2026-01-01" }) from?: string;
  @ApiPropertyOptional({ example: "2026-10-27" }) to?: string;
  @ApiPropertyOptional() url?: string;
  @ApiPropertyOptional() preview?: boolean;
  @ApiPropertyOptional() resume?: string;
  @ApiPropertyOptional({ format: "uuid" }) requestId?: string;
  @ApiPropertyOptional({ enum: ["manual", "scheduled", "resume"] })
  trigger?: string;
  @ApiPropertyOptional({ enum: ["fresh", "resume"] }) scheduledPhase?: string;
  @ApiPropertyOptional() channelId?: string;
  @ApiPropertyOptional({ enum: ["fresh", "backfill", "revisit", "retry"] })
  phase?: string;
  @ApiPropertyOptional() taskId?: string;
  @ApiPropertyOptional() roundId?: string;
  @ApiPropertyOptional() rebuildTaskId?: string;
}
export class IngestionCountsDto {
  @ApiProperty() discovered!: number;
  @ApiProperty() new!: number;
  @ApiProperty() changed!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() ignored!: number;
  @ApiProperty() failed!: number;
}
export class IngestionPendingNoticeDto {
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) publishedAt!: string | null;
}
export class IngestionCursorDto {
  @ApiProperty({ type: [String] }) pages!: string[];
  @ApiProperty({ type: [String] }) seen!: string[];
  @ApiProperty({ type: [IngestionPendingNoticeDto] })
  pending!: IngestionPendingNoticeDto[];
}
export class IngestionRunErrorDto {
  @ApiProperty() url!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ description: "安全的解析诊断代码" }) code?: string;
  @ApiPropertyOptional({ enum: ["skipped", "budget", "diagnostic"] })
  kind?: string;
}
export class IngestionPreviewItemDto {
  @ApiProperty() url!: string;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
  @ApiProperty({ type: AdminParsedCandidateDto })
  candidate!: AdminParsedCandidateDto;
}
export class IngestionExecutionResultDto {
  @ApiPropertyOptional() channelId?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phase?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) taskId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) roundId?:
    string | null;
  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  range?: Record<string, string>;
  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  budgetUsage?: Record<string, number>;
  @ApiProperty({
    enum: [
      "succeeded",
      "partial",
      "failed",
      "interrupted",
      "locked",
      "disabled",
    ],
  })
  status!: string;
  @ApiProperty() source!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) runId?: string | null;
  @ApiPropertyOptional() adapterVersion?: string;
  @ApiPropertyOptional() access?: string;
  @ApiPropertyOptional({ type: IngestionCountsDto })
  counts?: IngestionCountsDto;
  @ApiPropertyOptional({ type: [IngestionRunErrorDto] })
  errors?: IngestionRunErrorDto[];
  @ApiPropertyOptional({ type: IngestionCursorDto })
  cursor?: IngestionCursorDto;
  @ApiPropertyOptional({ type: [IngestionPreviewItemDto] })
  previews?: IngestionPreviewItemDto[];
}
export class IngestionChannelDefinitionDto {
  @ApiPropertyOptional() datePattern?: string;
  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  pagination?: Record<string, unknown>;
  @ApiProperty() id!: string;
  @ApiProperty() listUrl!: string;
  @ApiProperty({ enum: ["vsb-selectors"] }) adapterId!: string;
  @ApiProperty() version!: string;
  @ApiProperty() noticePath!: string;
  @ApiProperty() listPath!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "string" },
    description: "仓库发布的只读选择器；写接口不接受此字段",
  })
  selectors!: Record<string, string>;
}
export class IngestionChannelStateDto {
  @ApiPropertyOptional({ type: [Object] }) verification?: unknown[];
  @ApiProperty({ type: String, nullable: true }) backoffUntil!: string | null;
  @ApiProperty() failureCount!: number;
  @ApiProperty() id!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: SourceSettingsDto }) settings!: SourceSettingsDto;
  @ApiProperty() baseline!: string;
  @ApiProperty({ enum: ["pending", "verified", "rejected"] })
  verificationStatus!: string;
  @ApiProperty({ type: String, nullable: true }) verifiedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) verifiedBy!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date" })
  activatedOn!: string | null;
  @ApiProperty() pendingCount!: number;
  @ApiProperty({ type: "object", additionalProperties: true })
  coverage!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  lastSuccessfulCheck!: string | null;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  budgetUsage!: Record<string, unknown> | null;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  latestRound!: Record<string, unknown> | null;
  @ApiProperty({ type: "object", additionalProperties: true })
  discoveryDelay!: {
    precision: "days";
    sampleCount: number;
    averageDays: number | null;
    maxDays: number | null;
  };
}
export class IngestionChannelMutationDto extends IngestionChannelDefinitionDto {
  @ApiPropertyOptional({ type: [Object] }) verification?: unknown[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: SourceSettingsDto }) settings!: SourceSettingsDto;
  @ApiProperty() baseline!: string;
  @ApiProperty({ enum: ["pending", "verified", "rejected"] })
  verificationStatus!: string;
  @ApiProperty({ type: String, nullable: true }) verifiedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) verifiedBy!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date" })
  activatedOn!: string | null;
}
export class IngestionSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() collegeId!: string;
  @ApiProperty() defaultChannelId!: string;
  @ApiProperty({
    type: [IngestionChannelDefinitionDto],
    description: "仓库登记的静态栏目定义；选择器、路径和主机不可由 HTTP 修改",
  })
  channels!: IngestionChannelDefinitionDto[];
  @ApiPropertyOptional({ type: [IngestionChannelStateDto] })
  channelStates?: IngestionChannelStateDto[];
  @ApiProperty() publisher!: string;
  @ApiProperty() version!: string;
  @ApiProperty() host!: string;
  @ApiProperty() listUrl!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: SourceSettingsDto }) settings!: SourceSettingsDto;
  @ApiProperty() baseline!: string;
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: () => IngestionRunDto, nullable: true })
  latestRun!: IngestionRunDto | null;
}
export class IngestionRunDto {
  @ApiProperty() id!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() channelId!: string;
  @ApiProperty({ type: String, nullable: true }) phase!: string | null;
  @ApiProperty({ type: String, nullable: true }) configHash!: string | null;
  @ApiProperty({ type: String, nullable: true }) taskId!: string | null;
  @ApiProperty({ type: String, nullable: true }) roundId!: string | null;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  budgetUsage!: Record<string, unknown> | null;
  @ApiProperty({
    enum: ["running", "succeeded", "partial", "failed", "interrupted"],
  })
  status!: string;
  @ApiProperty({ enum: ["manual", "scheduled", "resume"] }) trigger!: string;
  @ApiProperty({ format: "date-time" }) startedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  finishedAt!: string | null;
  @ApiProperty({ type: IngestionRunOptionsDto })
  options!: IngestionRunOptionsDto;
  @ApiProperty({ type: IngestionCountsDto }) counts!: IngestionCountsDto;
  @ApiProperty({ type: [IngestionRunErrorDto] })
  errors!: IngestionRunErrorDto[];
  @ApiProperty({ type: IngestionCursorDto }) cursor!: IngestionCursorDto;
  @ApiProperty({ type: [String] }) resumedBy!: string[];
}
export class IngestionRunsDto {
  @ApiProperty({ type: [IngestionRunDto] }) items!: IngestionRunDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class IngestionAcceptedDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ enum: ["accepted"] }) status!: string;
}
export class AttachmentCommandDto extends IngestionCommandDto {
  @ApiProperty({ minimum: 0, description: "当前通知 evidenceRevision" })
  @IsInt()
  @Min(0)
  baseline!: number;
}
export class AttachmentReparseCommandDto extends AttachmentCommandDto {
  @ApiProperty({ format: "uuid", description: "已有附件内容版本 ID" })
  @IsUUID()
  versionId!: string;
}
export class AttachmentRequestDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty({ format: "uuid" }) attachmentId!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) versionId!:
    string | null;
  @ApiProperty({ enum: ["recheck", "reparse"] }) operation!: string;
  @ApiProperty({ enum: ["accepted", "running", "completed", "failed"] })
  status!: string;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  result!: Record<string, unknown> | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  finishedAt!: string | null;
}
export class IngestionRequestDto {
  @ApiPropertyOptional({
    type: IngestionRunOptionsDto,
    description: "原始受理范围与预览参数；中断后显式重试沿用",
  })
  options?: IngestionRunOptionsDto;
  @ApiProperty() channelId!: string;
  @ApiProperty({ type: String, nullable: true }) phase!: string | null;
  @ApiProperty({ type: String, nullable: true }) taskId!: string | null;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  taskProgress!: Record<string, unknown> | null;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true })
  budgetUsage!: Record<string, unknown> | null;
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiPropertyOptional() sourceId?: string;
  @ApiPropertyOptional({ format: "uuid" }) attachmentId?: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: "uuid" })
  versionId?: string | null;
  @ApiPropertyOptional({ enum: ["recheck", "reparse"] }) operation?: string;
  @ApiProperty({
    enum: ["accepted", "running", "completed", "failed", "interrupted"],
  })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) runId!: string | null;
  @ApiProperty({
    type: IngestionExecutionResultDto,
    nullable: true,
    description: "执行结果；status 为采集运行结果，与本对象受理状态分别表达",
  })
  result!: IngestionExecutionResultDto | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  startedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  finishedAt!: string | null;
}
export class IngestionCandidateChannelDto {
  @ApiProperty() channelId!: string;
  @ApiProperty() channelUrl!: string;
  @ApiProperty({ enum: ["pending_full_validation"] }) status!: string;
  @ApiProperty({ default: false }) enabled!: false;
}
export class CollegeVerificationCandidateDto {
  @ApiProperty() collegeId!: string;
  @ApiProperty() collegeName!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() officialUrl!: string;
  @ApiProperty({ type: [IngestionCandidateChannelDto] })
  candidateChannels!: IngestionCandidateChannelDto[];
  @ApiProperty({ type: [String] }) sampleNoticeUrls!: string[];
  @ApiProperty({ format: "date" }) checkedAt!: string;
  @ApiProperty({ enum: ["pending"] }) status!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: "object", additionalProperties: true })
  observations!: Record<string, unknown>;
  @ApiPropertyOptional() note?: string;
}
