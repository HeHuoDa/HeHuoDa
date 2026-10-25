import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  Min,
} from "class-validator";
import { USER_STATUS_VALUES } from "./auth.constants.js";
export { USER_STATUS_VALUES };

export class WechatLoginRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @ApiProperty({
    description: "uni.login 取得的微信临时授权码",
    maxLength: 512,
  })
  code!: string;

  @IsInt()
  @Min(1)
  @ApiProperty({
    description: "用户已确认的平台协议版本；当前为 1",
    minimum: 1,
    example: 1,
  })
  consentVersion!: number;
}

export class RefreshRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @ApiProperty({ description: "刷新凭据", maxLength: 512 })
  refreshToken!: string;
}

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "微信用户" }) nickname!: string;
  @ApiProperty({ enum: USER_STATUS_VALUES }) status!: string;
}

export class CredentialResponseDto {
  @ApiProperty({ enum: ["active"], description: "凭据生命周期类别" })
  kind!: "active";
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiProperty({ description: "访问凭据，15 分钟有效" }) accessToken!: string;
  @ApiProperty({ description: "刷新凭据，随会话绝对期限失效" })
  refreshToken!: string;
  @ApiProperty({ example: "2026-10-24T12:15:00.000Z" })
  accessExpiresAt!: string;
  @ApiProperty({
    example: "2026-11-23T12:00:00.000Z",
    description: "会话绝对期限，刷新不会延长",
  })
  sessionExpiresAt!: string;
}

export class CampusStatusDto {
  @ApiProperty({
    enum: ["unverified"],
    description: "校园核验状态；核验模块接入前恒为 unverified",
  })
  status!: "unverified";
  // nullable 字段必须显式声明 type，否则 openapi-typescript 生成 Record<string, never>。
  @ApiPropertyOptional({ type: String, nullable: true }) termId: string | null =
    null;
  @ApiPropertyOptional({ type: String, nullable: true })
  verifiedAt: string | null = null;
  @ApiPropertyOptional({ type: String, nullable: true })
  validUntil: string | null = null;
}

export class AvailabilityDto {
  @ApiProperty({
    example: false,
    description: "组队业务是否对该账号开放；false 表示尚未开放",
  })
  teaming!: boolean;
}

export class ProfileResponseDto {
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiProperty({ type: CampusStatusDto }) campus!: CampusStatusDto;
  @ApiProperty({ type: AvailabilityDto }) availability!: AvailabilityDto;
}

export class UpdateProfileRequestDto {
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Length(1, 20)
  @ApiProperty({
    description: "新昵称，trim 后 1–20 字",
    minLength: 1,
    maxLength: 20,
  })
  nickname!: string;
}
