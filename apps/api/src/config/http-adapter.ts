import { FastifyAdapter } from "@nestjs/platform-fastify";
import { BlockList, isIP } from "node:net";
export function trustedProxy(cidrs: string) {
  const peers = new BlockList();
  for (const entry of cidrs
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [address, prefix, ...extra] = entry.split("/");
    const family = isIP(address ?? ""),
      bits = Number(prefix);
    if (
      extra.length ||
      !family ||
      prefix === undefined ||
      !/^\d+$/.test(prefix) ||
      !Number.isInteger(bits) ||
      bits < 1 ||
      bits > (family === 4 ? 32 : 128)
    )
      throw new Error("可信代理配置必须是明确的IP网段");
    peers.addSubnet(address!, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return (address: string, hop: number) =>
    hop === 0 && peers.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}
export function createHttpAdapter(cidrs = "") {
  return new FastifyAdapter({
    trustProxy: cidrs ? trustedProxy(cidrs) : false,
  });
}
