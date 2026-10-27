import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AdminReviewFileDto } from "./admin-review-response.dto.js";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

export class AdminReviewPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class AdminCandidateListQueryDto extends AdminReviewPageQueryDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  sourceId?: string;

  @ApiPropertyOptional({
    enum: ["pending", "approved", "rejected", "imported"],
  })
  @IsOptional()
  @IsIn(["pending", "approved", "rejected", "imported"])
  status?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class AdminNoticeListQueryDto extends AdminReviewPageQueryDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  sourceId?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class AdminCandidateOperationsQueryDto extends AdminReviewPageQueryDto {}

export class AdminReviewQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  targetId?: string;
}

export class AdminReviewCommandDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  operationId!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  reason!: string;
}

export class AdminReviewMaterialCommandDto extends AdminReviewCommandDto {
  @ApiProperty({
    type: AdminReviewFileDto,
    description: "服务端导出的 format=1 审核材料；只读字段须与服务器一致",
  })
  @IsObject()
  review!: Record<string, unknown>;
}

export class AdminReviewStateCommandDto extends AdminReviewCommandDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  sourceVersion!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  candidateRevision!: number;

  @ApiProperty({ pattern: "^[a-f0-9]{64}$" })
  @Matches(/^[a-f0-9]{64}$/)
  baseline!: string;
}

export class AdminReviewImportCommandDto extends AdminReviewMaterialCommandDto {
  @ApiProperty({
    format: "uuid",
    description: "对应 import-preview 的 operationId",
  })
  @IsUUID()
  previewId!: string;

  @ApiPropertyOptional({ description: "修改已发布记录时显式确认同一预览" })
  @IsOptional()
  @IsBoolean()
  confirmPublished?: boolean;
}

export class AdminReviewPublishCommandDto extends AdminReviewStateCommandDto {
  @ApiProperty({
    format: "uuid",
    description: "对应 publish-preview 的 operationId",
  })
  @IsUUID()
  previewId!: string;

  @ApiProperty({ description: "确认执行当前发布预览" })
  @IsBoolean()
  confirm!: boolean;
}
