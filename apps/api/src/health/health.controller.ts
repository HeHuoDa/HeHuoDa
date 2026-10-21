import { Controller, Get, Req, Res } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ApiErrorDto } from "../common/dto/api-error.dto.js";
import { HealthResponseDto } from "./health-response.dto.js";
import { HealthService } from "./health.service.js";
import { ReadinessResponseDto } from "./readiness-response.dto.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("ready")
  @ApiOperation({ summary: "检查数据库及当前版本所需迁移结构是否就绪" })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async getReadiness(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadinessResponseDto> {
    const result = await this.healthService.getReadiness(request.id);
    reply.code(result.status === "ready" ? 200 : 503);
    reply.header("Cache-Control", "no-store");
    return result;
  }

  @Get()
  @ApiOperation({ summary: "获取应用健康状态" })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  getHealth(@Req() request: FastifyRequest): HealthResponseDto {
    return this.healthService.getHealth(request.id);
  }
}
