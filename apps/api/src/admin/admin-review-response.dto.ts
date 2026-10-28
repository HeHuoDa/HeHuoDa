import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from "@nestjs/swagger";

export class AdminCandidateMappingDto {
  @ApiProperty() competitionId!: string;
}

export class AdminPublicSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() publisher!: string;
  @ApiProperty() host!: string;
  @ApiProperty({ format: "uri" }) listUrl!: string;
  @ApiProperty() version!: string;
}

export class AdminLatestVersionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
}

export class AdminNoticeCandidateDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["pending", "approved", "rejected", "imported"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) competitionId!: string | null;
}

export class AdminArticleAttachmentDto {
  @ApiProperty() title!: string;
  @ApiProperty({ format: "uri" }) url!: string;
}

export class AdminArticleDto {
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) publishedAt!: string | null;
  @ApiProperty() text!: string;
  @ApiProperty({ type: [String], description: "按原文顺序排列的纯文本段落" })
  paragraphs!: string[];
  @ApiProperty({ type: [AdminArticleAttachmentDto] })
  attachments!: AdminArticleAttachmentDto[];
}

export class AdminCandidateEvidenceDto {
  @ApiProperty() field!: string;
  @ApiProperty() excerpt!: string;
  @ApiProperty({ description: "原文段落索引；-1 表示来源元数据" })
  paragraph!: number;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiPropertyOptional() sourceVersion?: string;
}

export class AdminReviewTimeValueDto {
  @ApiProperty({ enum: ["instant", "date", "unknown"] }) precision!:
    "instant" | "date" | "unknown";
  @ApiProperty({ type: String, nullable: true }) value!: string | null;
}

export class AdminCandidateTrackDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ["individual", "team", "mixed"], nullable: true })
  mode!: "individual" | "team" | "mixed" | null;
  @ApiProperty({ type: String, nullable: true }) members!: string | null;
  @ApiProperty({ type: String, nullable: true }) rules!: string | null;
}

export class AdminCandidateScopeDto {
  @ApiProperty({ enum: ["all", "colleges", "complex", "unknown"] }) kind!:
    "all" | "colleges" | "complex" | "unknown";
  @ApiProperty({ type: [String] }) colleges!: string[];
  @ApiProperty() note!: string;
}

export class AdminCandidateFieldsDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) edition!: string | null;
  @ApiProperty({ enum: ["registration", "supplement", "award", "news"] })
  kind!: string;
  @ApiProperty({ type: String, nullable: true }) organizer!: string | null;
  @ApiProperty({ type: [String] }) hosts!: string[];
  @ApiProperty({ type: AdminCandidateScopeDto }) scope!: AdminCandidateScopeDto;
  @ApiProperty({ enum: ["individual", "team", "mixed"], nullable: true })
  mode!: "individual" | "team" | "mixed" | null;
  @ApiProperty({ type: [AdminCandidateTrackDto] })
  tracks!: AdminCandidateTrackDto[];
  @ApiProperty({ type: String, nullable: true }) members!: string | null;
  @ApiProperty({ type: [String] }) rules!: string[];
  @ApiProperty({ type: [String] }) stageNames!: string[];
  @ApiProperty({ type: AdminReviewTimeValueDto })
  startsAt!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  deadline!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  materialsAt!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  eventAt!: AdminReviewTimeValueDto;
}

export class AdminParsedCandidateDto {
  @ApiProperty({ type: AdminCandidateFieldsDto })
  fields!: AdminCandidateFieldsDto;
  @ApiProperty({ type: [AdminCandidateEvidenceDto] })
  evidence!: AdminCandidateEvidenceDto[];
  @ApiProperty({ type: [String] }) missing!: string[];
  @ApiProperty({ type: [String] }) conflicts!: string[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}

export class AdminReviewSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ format: "uri" }) finalUrl!: string;
  @ApiProperty() publisher!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty() adapterVersion!: string;
  @ApiProperty() health!: string;
}

export class AdminFormalScopeDto {
  @ApiProperty({ enum: ["all", "colleges", "complex", "unknown"] })
  kind!: string;
  @ApiProperty({ type: [String] }) colleges!: string[];
  @ApiProperty() note!: string;
}

export class AdminFormalStageDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() organizer!: string;
  @ApiProperty({ type: [String] }) hosts!: string[];
  @ApiProperty({ type: AdminFormalScopeDto }) scope!: AdminFormalScopeDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  startsAt!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  deadline!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  materialsAt!: AdminReviewTimeValueDto;
  @ApiProperty({ type: AdminReviewTimeValueDto })
  eventAt!: AdminReviewTimeValueDto;
  @ApiProperty() timeNote!: string;
  @ApiProperty() conflict!: boolean;
  @ApiProperty() registration!: string;
  @ApiProperty() order!: number;
  @ApiProperty({ type: [String] }) sourceIds!: string[];
}

export class AdminFormalTrackDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ["individual", "team", "mixed"] }) mode!: string;
  @ApiProperty() members!: string;
  @ApiProperty() rules!: string;
}

export class AdminFormalNoticeDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() publisher!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ type: String, nullable: true }) publishedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) checkedAt!: string | null;
  @ApiProperty({ enum: ["registration", "supplement", "award", "news"] })
  kind!: string;
}

export class AdminFormalCompetitionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() edition!: string;
  @ApiProperty() category!: string;
  @ApiProperty() organizer!: string;
  @ApiProperty({ enum: ["official", "historical", "demo"] }) origin!: string;
  @ApiProperty({ enum: ["draft", "published", "hidden"] }) publication!: string;
  @ApiProperty({ type: [AdminFormalStageDto] }) stages!: AdminFormalStageDto[];
  @ApiProperty({ type: [AdminFormalTrackDto] }) tracks!: AdminFormalTrackDto[];
  @ApiProperty({ type: [AdminFormalNoticeDto] })
  notices!: AdminFormalNoticeDto[];
}

export class AdminImportScopeDto {
  @ApiPropertyOptional({ enum: ["all", "colleges", "complex", "unknown"] })
  kind?: string;
  @ApiPropertyOptional({ type: [String] }) colleges?: string[];
  @ApiPropertyOptional() note?: string;
}

export class AdminImportStageDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() organizer?: string;
  @ApiPropertyOptional({ type: [String] }) hosts?: string[];
  @ApiPropertyOptional({ type: AdminImportScopeDto })
  scope?: AdminImportScopeDto;
  @ApiPropertyOptional({ type: AdminReviewTimeValueDto })
  startsAt?: AdminReviewTimeValueDto;
  @ApiPropertyOptional({ type: AdminReviewTimeValueDto })
  deadline?: AdminReviewTimeValueDto;
  @ApiPropertyOptional({ type: AdminReviewTimeValueDto })
  materialsAt?: AdminReviewTimeValueDto;
  @ApiPropertyOptional({ type: AdminReviewTimeValueDto })
  eventAt?: AdminReviewTimeValueDto;
  @ApiPropertyOptional() timeNote?: string;
  @ApiPropertyOptional() conflict?: boolean;
  @ApiPropertyOptional() registration?: string;
  @ApiPropertyOptional() order?: number;
  @ApiPropertyOptional({ type: [String] }) sourceIds?: string[];
}

export class AdminImportTrackDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ enum: ["individual", "team", "mixed"] }) mode?: string;
  @ApiPropertyOptional() members?: string;
  @ApiPropertyOptional() rules?: string;
}

export class AdminImportNoticeDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() publisher?: string;
  @ApiPropertyOptional({ format: "uri" }) url?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) publishedAt?:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) checkedAt?:
    string | null;
  @ApiPropertyOptional({
    enum: ["registration", "supplement", "award", "news"],
  })
  kind?: string;
}

export class AdminImportCompetitionDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() edition?: string;
  @ApiPropertyOptional() category?: string;
  @ApiPropertyOptional() organizer?: string;
  @ApiPropertyOptional({ enum: ["official", "historical", "demo"] })
  origin?: string;
  @ApiPropertyOptional({ enum: ["draft", "published", "hidden"] })
  publication?: string;
  @ApiPropertyOptional({ type: [AdminImportStageDto] })
  stages?: AdminImportStageDto[];
  @ApiPropertyOptional({ type: [AdminImportTrackDto] })
  tracks?: AdminImportTrackDto[];
  @ApiPropertyOptional({ type: [AdminImportNoticeDto] })
  notices?: AdminImportNoticeDto[];
}

export class AdminImportCollegeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() order!: number;
}

export class AdminImportBatchDto {
  @ApiPropertyOptional({ type: [AdminImportCollegeDto] })
  colleges?: AdminImportCollegeDto[];
  @ApiPropertyOptional({ type: [AdminImportCompetitionDto] })
  competitions?: AdminImportCompetitionDto[];
}

export class AdminMergeSuggestionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() edition!: string;
}

export class AdminReviewFileDto {
  @ApiProperty({
    pattern: "^[a-f0-9]{64}$",
    description: "正式映射快照；HTTP写入必须保留，历史CLI材料可缺省",
  })
  mappingBaseline!: string;
  @ApiProperty({ enum: [1, 2] }) format!: 1 | 2;
  @ApiPropertyOptional({ minimum: 1 }) evidenceRevision?: number;
  @ApiPropertyOptional({ type: [Object] }) evidence?: Record<string, unknown>[];
  @ApiProperty({ format: "uuid" }) operationId!: string;
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) sourceVersion!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty() targetId!: string;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) baseline!: string;
  @ApiProperty({ type: AdminReviewSourceDto }) source!: AdminReviewSourceDto;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
  @ApiProperty({ type: AdminArticleDto, nullable: true })
  previousArticle!: AdminArticleDto | null;
  @ApiProperty({ type: AdminParsedCandidateDto })
  candidate!: AdminParsedCandidateDto;
  @ApiProperty({ type: [AdminMergeSuggestionDto] })
  mergeSuggestions!: AdminMergeSuggestionDto[];
  @ApiProperty({ type: AdminFormalCompetitionDto, nullable: true })
  formalBefore!: AdminFormalCompetitionDto | null;
  @ApiProperty({ type: AdminImportBatchDto }) batch!: AdminImportBatchDto;
  @ApiProperty({ type: String, nullable: true, example: "2026-10-27" })
  checkedAt!: string | null;
  @ApiProperty() resolution!: string;
}

export class AdminCandidateListItemDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ format: "uri" }) finalUrl!: string;
  @ApiProperty({ format: "uuid" }) sourceVersion!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty({ enum: ["pending", "approved", "rejected", "imported"] })
  status!: string;
  @ApiProperty({ type: AdminParsedCandidateDto })
  data!: AdminParsedCandidateDto;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty({ type: String, nullable: true }) competitionId!: string | null;
}

export class AdminPageDto {
  @ApiProperty() total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 50 }) pageSize!: number;
}

export class AdminCandidateListDto extends AdminPageDto {
  @ApiProperty({ type: [AdminCandidateListItemDto] })
  items!: AdminCandidateListItemDto[];
}

export class AdminCandidateDetailDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ format: "uuid" }) sourceVersion!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty({ enum: ["pending", "approved", "rejected", "imported"] })
  status!: string;
  @ApiProperty({ type: AdminReviewSourceDto }) source!: AdminReviewSourceDto;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
  @ApiProperty({ type: AdminParsedCandidateDto })
  candidate!: AdminParsedCandidateDto;
  @ApiProperty({ type: AdminCandidateMappingDto, nullable: true })
  mapping!: AdminCandidateMappingDto | null;
  @ApiProperty({ type: AdminFormalCompetitionDto, nullable: true })
  formalBefore!: AdminFormalCompetitionDto | null;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) baseline!: string;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) formalBaseline!: string;
  @ApiProperty({ minimum: 0 }) evidenceRevision!: number;
  @ApiProperty({ enum: ["current", "stale", "blocked"] })
  evidenceState!: string;
  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: true },
  })
  attachmentSummary!: Record<string, unknown>[];
  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: true },
  })
  attachmentVersions!: Record<string, unknown>[];
  @ApiProperty() requiresReview!: boolean;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}

export class AdminNoticeListItemDto {
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ format: "uri" }) finalUrl!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  latestVersion!: string | null;
  @ApiProperty() health!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty({ type: Number, nullable: true }) revision!: number | null;
  @ApiProperty({ type: AdminArticleDto, nullable: true })
  article!: AdminArticleDto | null;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) candidateId!:
    string | null;
  @ApiProperty({
    enum: ["pending", "approved", "rejected", "imported"],
    nullable: true,
  })
  candidateStatus!: string | null;
}

export class AdminNoticeListDto extends AdminPageDto {
  @ApiProperty({ type: [AdminNoticeListItemDto] })
  items!: AdminNoticeListItemDto[];
}

export class AdminNoticeDetailDto {
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ format: "uri" }) finalUrl!: string;
  @ApiProperty() health!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty({
    type: AdminPublicSourceDto,
    description: "固定来源配置的公开元数据，不含私密配置",
  })
  source!: AdminPublicSourceDto;
  @ApiProperty({ type: AdminLatestVersionDto, nullable: true })
  latestVersion!: AdminLatestVersionDto | null;
  @ApiProperty({ type: AdminArticleDto, nullable: true })
  article!: AdminArticleDto | null;
  @ApiProperty({ type: AdminNoticeCandidateDto, nullable: true })
  candidate!: AdminNoticeCandidateDto | null;
  @ApiProperty({ minimum: 0 }) evidenceRevision!: number;
  @ApiProperty({ enum: ["current", "stale", "blocked"] })
  evidenceState!: string;
  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: true },
  })
  attachmentSummary!: Record<string, unknown>[];
  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: true },
  })
  attachmentVersions!: Record<string, unknown>[];
  @ApiProperty() requiresReview!: boolean;
}

export class AdminNoticeVersionListItemDto {
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  previousVersion!: string | null;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) bodyHash!: string;
  @ApiProperty() adapterVersion!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty({ type: AdminArticleDto }) article!: AdminArticleDto;
}

export class AdminNoticeVersionListDto extends AdminPageDto {
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty({ type: [AdminNoticeVersionListItemDto] })
  items!: AdminNoticeVersionListItemDto[];
}

export class AdminArticleDifferenceDto {
  @ApiProperty({
    enum: ["title", "publishedAt", "text", "paragraphs", "attachments"],
  })
  field!: string;
  @ApiProperty({
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" } },
      {
        type: "array",
        items: { $ref: getSchemaPath(AdminArticleAttachmentDto) },
      },
    ],
    nullable: true,
  })
  previous!: string | string[] | AdminArticleAttachmentDto[] | null;
  @ApiProperty({
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" } },
      {
        type: "array",
        items: { $ref: getSchemaPath(AdminArticleAttachmentDto) },
      },
    ],
    nullable: true,
  })
  current!: string | string[] | AdminArticleAttachmentDto[] | null;
}

export class AdminNoticeVersionDetailDto extends AdminNoticeVersionListItemDto {
  @ApiProperty({ type: AdminArticleDto, nullable: true })
  previousArticle!: AdminArticleDto | null;
  @ApiProperty({ type: [AdminArticleDifferenceDto] })
  differences!: AdminArticleDifferenceDto[];
}

export class AdminCandidateOperationDto {
  @ApiProperty() operationId!: string;
  @ApiProperty({ format: "uuid" }) sourceVersion!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty({
    enum: [
      "revise",
      "approve",
      "reject",
      "reopen",
      "preview",
      "import",
      "publish",
    ],
  })
  kind!: string;
  @ApiProperty() reviewer!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "revise 条目包含 targetId、reason、batch、checkedAt、resolution 的历史快照；其他条目为对应操作摘要",
  })
  result!: Record<string, unknown>;
}

export class AdminCandidateOperationsDto extends AdminPageDto {
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ type: [AdminCandidateOperationDto] })
  items!: AdminCandidateOperationDto[];
}

export class AdminReviewStateResultDto {
  @ApiProperty({ enum: ["pending", "rejected"] }) status!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty() reason!: string;
}

export class AdminReviewSavedResultDto {
  @ApiProperty({ enum: ["pending"] }) status!: string;
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ minimum: 1 }) candidateRevision!: number;
  @ApiProperty({ type: AdminReviewFileDto }) review!: AdminReviewFileDto;
}

export class AdminImportChangeDto {
  @ApiProperty({ enum: ["college", "competition"] }) entity!: string;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["insert", "update"] }) action!: string;
  @ApiPropertyOptional({ type: [String] }) removed?: string[];
}

export class AdminImportResultDto {
  @ApiProperty() preview!: boolean;
  @ApiProperty({ type: [AdminImportChangeDto] })
  changes!: AdminImportChangeDto[];
}

export class AdminReviewApprovedResultDto {
  @ApiProperty({ enum: ["approved"] }) status!: string;
  @ApiProperty({ format: "uuid" }) candidateId!: string;
  @ApiProperty({ type: AdminImportResultDto }) preview!: AdminImportResultDto;
}

export class AdminReviewImportPreviewResultDto extends AdminImportResultDto {
  @ApiProperty({ format: "uuid" }) previewId!: string;
}

export class AdminReviewPublishPreviewResultDto extends AdminImportResultDto {
  @ApiProperty({ format: "uuid" }) previewId!: string;
  @ApiProperty() targetId!: string;
}
