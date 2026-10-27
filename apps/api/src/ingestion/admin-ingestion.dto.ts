import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  AdminArticleDto,
  AdminParsedCandidateDto,
} from "../admin/admin-review-response.dto.js";
import {
  IsBoolean,
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
  @ApiProperty({ example: "2026-01-01" }) from!: string;
  @ApiProperty({ example: "2026-10-27" }) to!: string;
  @ApiPropertyOptional() url?: string;
  @ApiPropertyOptional() preview?: boolean;
  @ApiPropertyOptional() resume?: string;
  @ApiPropertyOptional({ format: "uuid" }) requestId?: string;
  @ApiPropertyOptional({ enum: ["manual", "scheduled", "resume"] })
  trigger?: string;
  @ApiPropertyOptional({ enum: ["fresh", "resume"] }) scheduledPhase?: string;
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
  @ApiPropertyOptional({ enum: ["skipped", "budget"] }) kind?: string;
}
export class IngestionPreviewItemDto {
  @ApiProperty() url!: string;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
  @ApiProperty({ type: AdminParsedCandidateDto })
  candidate!: AdminParsedCandidateDto;
}
export class IngestionExecutionResultDto {
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
export class IngestionSourceDto {
  @ApiProperty() id!: string;
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
export class IngestionRequestDto {
  @ApiProperty({ format: "uuid" }) requestId!: string;
  @ApiProperty() sourceId!: string;
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
