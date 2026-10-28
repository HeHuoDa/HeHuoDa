import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class EvidenceReferenceDto {
  @ApiProperty({ enum: ["html", "pdf", "docx"] }) format!: string;
  @ApiProperty() url!: string;
  @ApiProperty() noticeVersion!: string;
  @ApiProperty({ type: String, nullable: true }) attachmentVersion!:
    string | null;
  @ApiPropertyOptional() page?: number;
  @ApiPropertyOptional() paragraph?: number;
  @ApiProperty() field!: string;
  @ApiProperty() excerpt!: string;
}

export class AttachmentSegmentDto {
  @ApiProperty({ enum: ["page", "paragraph"] }) kind!: string;
  @ApiProperty({ minimum: 1 }) index!: number;
  @ApiProperty() text!: string;
  @ApiProperty() truncated!: boolean;
}
export class AttachmentVersionDto {
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty({ type: String, nullable: true }) previousVersion!:
    string | null;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, nullable: true }) sha256!: string | null;
  @ApiProperty() noticeVersion!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty() mediaType!: string;
  @ApiProperty() extractorVersion!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
}
export class AttachmentExecutionResultDto {
  @ApiProperty() attachmentId!: string;
  @ApiPropertyOptional() versionId?: string;
  @ApiPropertyOptional() evidenceRevision?: number;
  @ApiPropertyOptional() historical?: boolean;
  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  usage?: Record<string, unknown>;
}
export class AttachmentVersionsDto {
  @ApiProperty({ type: [AttachmentVersionDto] }) items!: AttachmentVersionDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class AttachmentTextDto extends AttachmentVersionDto {
  @ApiProperty({ type: [AttachmentSegmentDto] })
  segments!: AttachmentSegmentDto[];
  @ApiProperty() totalSegments!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class AttachmentSummaryDto {
  @ApiProperty({ format: "uuid" }) attachmentId!: string;
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ type: String, nullable: true }) lastCheckedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) latestVersion!: string | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty() evidenceRevision!: number;
  @ApiProperty() evidenceState!: string;
}
export class NoticeAttachmentsDto {
  @ApiProperty({ format: "uuid" }) noticeId!: string;
  @ApiProperty() evidenceRevision!: number;
  @ApiProperty() evidenceState!: string;
  @ApiProperty({ type: [AttachmentSummaryDto] }) items!: AttachmentSummaryDto[];
}
