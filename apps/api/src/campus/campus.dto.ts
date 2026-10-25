import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";
export class CampusConsentDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) consentVersion!: number;
}
export class CampusSubmitDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  account!: string;
  @ApiProperty({ maxLength: 512, writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  password!: string;
  @ApiProperty({ maxLength: 32, writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  captcha!: string;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  challengeVersion!: string;
}
export class CampusPolicyDto {
  @ApiProperty() version!: number;
  @ApiProperty() content!: string;
}
export class CampusSummaryDto {
  @ApiProperty({ enum: ["unverified", "valid", "expired", "revoked"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) termId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  validUntil!: string | null;
  @ApiProperty({ type: String, nullable: true }) source!: string | null;
}
export class CampusTermDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "date-time" }) startAt!: string;
  @ApiProperty({ format: "date-time" }) endAt!: string;
}
export class CampusStatusResponseDto extends CampusSummaryDto {
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: CampusTermDto, nullable: true })
  currentTerm!: CampusTermDto | null;
  @ApiProperty() policyVersion!: number;
}
export class CampusProfileDto {
  @ApiProperty({ description: "学校账号编号；可能为学号或工号，保留原值" })
  accountNumber!: string;
  @ApiProperty({ description: "学校登记姓名，不表示已实名或在读" })
  name!: string;
  @ApiProperty() source!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}
export class CampusProfileResponseDto {
  @ApiProperty({ type: CampusProfileDto, nullable: true })
  profile!: CampusProfileDto | null;
}
export class CampusChallengeDto {
  @ApiProperty() version!: string;
  @ApiProperty() imageDataUrl!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}
export class CampusTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: [
      "waiting",
      "processing",
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ],
  })
  status!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: CampusSummaryDto, required: false })
  qualification?: CampusSummaryDto;
  @ApiProperty({ type: CampusChallengeDto, required: false })
  challenge?: CampusChallengeDto;
}
