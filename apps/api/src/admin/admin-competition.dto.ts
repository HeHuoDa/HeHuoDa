import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
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
} from "class-validator";
import {
  AdminFormalCompetitionDto,
  AdminImportCompetitionDto,
  AdminReviewTimeValueDto,
} from "./admin-review-response.dto.js";
import { competitionActions } from "./competition-admin.model.js";

export const competitionStatusValues = [
  "draft",
  "published",
  "hidden",
] as const;

export class AdminCompetitionListQueryDto {
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

  @ApiPropertyOptional({ enum: competitionStatusValues })
  @IsOptional()
  @IsIn(competitionStatusValues)
  status?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: "字面包含匹配名称、届次或主办方",
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}

export class AdminCompetitionBaselineQueryDto {
  @ApiProperty({
    description: "目标届次；草稿阶段可先查询未保存记录的基线",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  })
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  id!: string;
}

export class AdminCompetitionCommandDto {
  @ApiProperty({ format: "uuid", description: "写请求幂等键" })
  @IsUUID()
  operationId!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  reason!: string;

  @ApiProperty({
    enum: competitionActions,
    description:
      "save 保存或新建草稿内容；publish 发布并校验发布底线；hide 从公开端下架",
  })
  @IsIn(competitionActions)
  action!: "save" | "publish" | "hide";

  @ApiProperty({
    pattern: "^[a-f0-9]{64}$",
    description: "服务端返回的正式基线；与当前记录不一致时返回 409，须重新读取",
  })
  @Matches(/^[a-f0-9]{64}$/)
  baseline!: string;

  @ApiPropertyOptional({
    type: AdminImportCompetitionDto,
    description:
      "届次内容补丁，语义与导入一致：缺省字段保留，集合整体替换；publish/hide 忽略该字段",
  })
  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @ApiPropertyOptional({
    format: "uuid",
    description: "对应 preview 的 operationId；提供时校验预览未过期且未被消费",
  })
  @IsOptional()
  @IsUUID()
  previewId?: string;

  @ApiPropertyOptional({
    description: "修改已发布记录内容时必须显式确认",
  })
  @IsOptional()
  @IsBoolean()
  confirmPublished?: boolean;
}

export class AdminCompetitionPreviewDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  operationId!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  reason!: string;

  @ApiProperty({ enum: competitionActions })
  @IsIn(competitionActions)
  action!: "save" | "publish" | "hide";

  @ApiProperty({ pattern: "^[a-f0-9]{64}$" })
  @Matches(/^[a-f0-9]{64}$/)
  baseline!: string;

  @ApiPropertyOptional({ type: AdminImportCompetitionDto })
  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;
}

export class AdminCompetitionChangeDto {
  @ApiProperty({ description: "字段路径；关系集合按成员路径列出" })
  field!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    nullable: true,
  })
  previous!: unknown;
  @ApiProperty({ type: "object", additionalProperties: true, nullable: true })
  current!: unknown;
  @ApiPropertyOptional({
    type: [String],
    description: "本次解除的关系成员，例如 stages.x.hosts:law",
  })
  removed?: string[];
}

export class AdminCompetitionPublishBlockDto {
  @ApiProperty({
    enum: [
      "STAGE_MISSING",
      "STAGE_INCOMPLETE",
      "TRACK_MISSING",
      "SOURCE_MISSING",
      "SOURCE_UNLINKED",
      "SOURCE_INVALID",
      "CHECKED_AT_MISSING",
      "CHECKED_AT_INVALID",
    ],
  })
  code!: string;
  @ApiProperty() message!: string;
}

export class AdminCompetitionPreviewResultDto {
  @ApiProperty({ format: "uuid" }) previewId!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ enum: competitionActions }) action!: string;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) baseline!: string;
  @ApiProperty({
    enum: competitionStatusValues,
    description: "预览后记录的发布状态（未提交）",
  })
  publication!: string;
  @ApiProperty({ type: [AdminCompetitionChangeDto] })
  changes!: AdminCompetitionChangeDto[];
  @ApiProperty({
    type: [AdminCompetitionPublishBlockDto],
    description: "发布底线缺口；非空时 publish 会被拒绝",
  })
  blocks!: AdminCompetitionPublishBlockDto[];
}

export class AdminCompetitionCommandResultDto {
  @ApiProperty() targetId!: string;
  @ApiProperty({ enum: competitionActions }) action!: string;
  @ApiProperty({ enum: competitionStatusValues }) publication!: string;
  @ApiProperty({
    pattern: "^[a-f0-9]{64}$",
    description: "写入后的新基线；重试返回首次结果中的基线",
  })
  baseline!: string;
  @ApiProperty({ type: [AdminCompetitionChangeDto] })
  changes!: AdminCompetitionChangeDto[];
  @ApiProperty({
    format: "uuid",
    description: "admin_operations 审计记录 ID",
  })
  auditOperationId!: string;
}

export class AdminCompetitionBaselineDto {
  @ApiProperty() targetId!: string;
  @ApiProperty({
    description: "目标届次是否已存在；false 表示这是一次新建",
  })
  exists!: boolean;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) baseline!: string;
  @ApiProperty({
    enum: competitionStatusValues,
    nullable: true,
    description: "已存在时返回当前发布状态",
  })
  publication!: string | null;
}

export class AdminCompetitionDto extends AdminFormalCompetitionDto {
  @ApiProperty({
    pattern: "^[a-f0-9]{64}$",
    description: "当前正式基线；写命令须原样回传",
  })
  baseline!: string;
}

export class AdminCompetitionListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() edition!: string;
  @ApiProperty() category!: string;
  @ApiProperty() organizer!: string;
  @ApiProperty({ enum: ["official", "historical", "demo"] }) origin!: string;
  @ApiProperty({ enum: competitionStatusValues }) publication!: string;
  @ApiProperty() stageCount!: number;
  @ApiProperty() trackCount!: number;
  @ApiProperty() noticeCount!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) baseline!: string;
}

export class AdminCompetitionListDto {
  @ApiProperty({ type: [AdminCompetitionListItemDto] })
  items!: AdminCompetitionListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 50 }) pageSize!: number;
}

export { AdminReviewTimeValueDto };
