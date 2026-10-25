import { createHttpAdapter } from "../src/config/http-adapter.js";
describe("HTTP 来源预算的可信单层代理", () => {
  it("默认直接模式忽略客户端伪造转发头", async () => {
    const server = createHttpAdapter().getInstance();
    server.get("/ip", async (request) => ({ ip: request.ip }));
    try {
      const response = await server.inject({
        method: "GET",
        url: "/ip",
        remoteAddress: "192.0.2.10",
        headers: { "x-forwarded-for": "198.51.100.1" },
      });
      expect(response.json().ip).toBe("192.0.2.10");
    } finally {
      await server.close();
    }
  });
  it("隔离部署信任唯一代理，区分真实来源并只取最近一跳，不信任伪造前缀", async () => {
    const server = createHttpAdapter("172.20.0.0/16").getInstance();
    server.get("/ip", async (request) => ({ ip: request.ip }));
    try {
      for (const source of ["198.51.100.1", "198.51.100.2"]) {
        const response = await server.inject({
          method: "GET",
          url: "/ip",
          remoteAddress: "172.20.0.2",
          headers: { "x-forwarded-for": "203.0.113.99, " + source },
        });
        expect(response.json().ip).toBe(source);
      }
      for (const peer of ["192.0.2.10", "::ffff:192.0.2.10"]) {
        const response = await server.inject({
          method: "GET",
          url: "/ip",
          remoteAddress: peer,
          headers: { "x-forwarded-for": "198.51.100.1" },
        });
        expect(response.json().ip).toBe(peer);
      }
    } finally {
      await server.close();
    }
  });
});
