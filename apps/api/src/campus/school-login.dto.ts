import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { CredentialResponseDto } from "../auth/auth.dto.js";

// 匿名登录没有平台会话，客户端必须同时提交事务 ID 与持有凭证。
// 仅凭事务 ID 无法读取、刷新或提交，持有凭证只以 SHA-256 摘要落库。
export class SchoolLoginHolderQueryDto {
  @ApiProperty({
    maxLength: 512,
    description: "创建事务时下发的持有凭证；仅服务端保存其摘要",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  holderToken!: string;
}

export class SchoolLoginSubmitDto extends SchoolLoginHolderQueryDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @Matches(/\S/u)
  @MaxLength(128)
  name!: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/u)
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

  @ApiProperty({
    minimum: 1,
    description: "用户已确认的统一身份认证说明版本",
  })
  @IsInt()
  @Min(1)
  consentVersion!: number;
}

export class SchoolLoginChallengeDto {
  @ApiProperty() version!: string;
  @ApiProperty() imageDataUrl!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}

export class SchoolLoginTransactionDto {
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
  @ApiProperty({ type: SchoolLoginChallengeDto, required: false })
  challenge?: SchoolLoginChallengeDto;
}

export class SchoolLoginChallengeResponseDto extends SchoolLoginTransactionDto {
  @ApiProperty({
    description:
      "持有凭证，只在创建与刷新验证码时下发；后续请求必须回传，服务端只保存摘要",
  })
  holderToken!: string;
}

export class SchoolLoginCredentialDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiPropertyOptional({
    type: CredentialResponseDto,
    description:
      "仅成功的首次登录下发一次；受限于 Bearer 通道，H5 Cookie 通道由 #218 承接",
  })
  credential?: CredentialResponseDto;
}
