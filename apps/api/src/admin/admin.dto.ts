import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsString,
  Length,
  Matches,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsISO8601,
  IsUUID,
} from "class-validator";

export class AdminLoginDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{1,64}$/)
  username!: string;
  @ApiProperty({ minLength: 1, maxLength: 256, writeOnly: true })
  @IsString()
  @Length(1, 256)
  password!: string;
}
export class AdminSessionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}
export class AdminCsrfDto {
  @ApiProperty({ description: "会话绑定凭证；写请求通过 X-CSRF-Token 提交" })
  csrfToken!: string;
}
export const ADMIN_ACTIONS = [
  "auth.login",
  "auth.logout",
  "account.create",
  "competition.update",
  "competition.publish",
  "ingestion.scan",
  "candidate.review",
  "candidate.import",
] as const;
export const ADMIN_OBJECTS = [
  "account",
  "session",
  "competition",
  "source",
  "candidate",
] as const;
export class OperationsQueryDto {
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
  @ApiPropertyOptional({ enum: ["admin", "maintenance", "anonymous"] })
  @IsOptional()
  @IsIn(["admin", "maintenance", "anonymous"])
  actorType?: string;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  actorId?: string;
  @ApiPropertyOptional({ enum: ADMIN_ACTIONS })
  @IsOptional()
  @IsIn(ADMIN_ACTIONS)
  action?: string;
  @ApiPropertyOptional({ enum: ADMIN_OBJECTS })
  @IsOptional()
  @IsIn(ADMIN_OBJECTS)
  objectType?: string;
  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;
  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
export class AdminOperationDto {
  @ApiProperty({ format: "uuid" }) operationId!: string;
  @ApiProperty({ enum: ["admin", "maintenance", "anonymous"] })
  actorType!: string;
  @ApiProperty({ type: String, nullable: true }) actorId!: string | null;
  @ApiProperty({ enum: ADMIN_ACTIONS }) action!: string;
  @ApiProperty({ enum: ADMIN_OBJECTS }) objectType!: string;
  @ApiProperty({ type: String, nullable: true }) objectId!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ["success", "failure"] }) result!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class AdminOperationsDto {
  @ApiProperty({ type: [AdminOperationDto] }) items!: AdminOperationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class DashboardModuleDto {
  @ApiProperty({ enum: ["pending", "drafts", "published", "sources"] })
  module!: string;
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: Number, nullable: true }) count!: number | null;
  @ApiProperty({ description: "统计对象与筛选范围" }) scope!: string;
  @ApiProperty({ format: "date-time" }) asOf!: string;
}
export class AdminDashboardDto {
  @ApiProperty({ type: [DashboardModuleDto] }) modules!: DashboardModuleDto[];
}
