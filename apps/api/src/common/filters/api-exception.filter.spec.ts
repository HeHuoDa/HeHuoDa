import {
  HttpException,
  UnauthorizedException,
  type ArgumentsHost,
} from "@nestjs/common";
import { jest } from "@jest/globals";
import { ApiExceptionFilter } from "./api-exception.filter.js";
import { createApiError } from "../api-error.js";

function createHost() {
  const reply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: "request-123" }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  return { host, reply };
}

describe("ApiExceptionFilter", () => {
  it("returns a generic message and request id without leaking unknown errors", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(
      new Error("secret database password at internalFunction"),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "服务器内部错误",
      requestId: "request-123",
    });
    expect(JSON.stringify(reply.send.mock.calls)).not.toContain(
      "secret database password",
    );
    expect(JSON.stringify(reply.send.mock.calls)).not.toContain(
      "at internalFunction",
    );
  });

  it("maps an HTTP exception to a stable code and preserves its status", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(new UnauthorizedException(), host);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNAUTHORIZED",
        requestId: "request-123",
      }),
    );
  });

  it("marks every error response as non-cacheable", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(new UnauthorizedException(), host);

    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("maps 503 to a stable service-unavailable code", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(new HttpException("downstream", 503), host);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({
      code: "SERVICE_UNAVAILABLE",
      message: "服务暂不可用",
      requestId: "request-123",
    });
  });

  it("passes through business code, message and public details", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(
      createApiError(400, "CONSENT_VERSION_MISMATCH", "协议版本不一致", {
        currentVersion: 1,
      }),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      code: "CONSENT_VERSION_MISMATCH",
      message: "协议版本不一致",
      requestId: "request-123",
      details: { currentVersion: 1 },
    });
  });

  it("drops non-object details instead of echoing them", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(
      new HttpException(
        { code: "X", message: "m", details: "secret-token" },
        400,
      ),
      host,
    );

    expect(reply.send).toHaveBeenCalledWith({
      code: "X",
      message: "m",
      requestId: "request-123",
    });
  });
});
