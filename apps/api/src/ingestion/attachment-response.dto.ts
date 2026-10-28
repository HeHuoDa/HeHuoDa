import { ApiProperty } from "@nestjs/swagger";

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
  @ApiProperty() sha256!: string;
  @ApiProperty({ format: "date-time" }) fetchedAt!: string;
  @ApiProperty() mediaType!: string;
  @ApiProperty() extractorVersion!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
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
