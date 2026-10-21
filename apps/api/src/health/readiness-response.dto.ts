import { ApiProperty } from "@nestjs/swagger";

export class ReadinessResponseDto {
  @ApiProperty({ enum: ["ready", "unavailable"] })
  status!: "ready" | "unavailable";

  @ApiProperty({ description: "当前请求关联 ID" })
  requestId!: string;
}
