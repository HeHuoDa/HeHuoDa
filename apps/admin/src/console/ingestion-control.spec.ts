import { describe, it, expect } from "vitest";
import {
  defaultSettings,
  validateSettings,
  validateScan as checkScan,
  fixedSources,
} from "./ingestion-control";
const validateScan = (input: Parameters<typeof checkScan>[0]) =>
  checkScan(input, fixedSources);
describe("采集控制表单契约", () => {
  it("固定来源、日期及预算边界与服务端一致，单通知仅允许所选来源HTTPS同源", () => {
    expect(validateSettings(defaultSettings)).toBeNull();
    expect(validateSettings({ ...defaultSettings, requests: 201 })).toContain(
      "请求",
    );
    expect(
      validateSettings({ ...defaultSettings, intervalMs: 1999 }),
    ).toContain("间隔");
    const scan = {
      sourceId: "information-engineering",
      from: "2026-01-01",
      to: "2026-12-31",
      url: "",
      preview: true,
    };
    expect(validateScan(scan)).toBeNull();
    expect(validateScan({ ...scan, to: "2027-01-02" })).toContain("366");
    expect(
      validateScan({ ...scan, url: "https://smkx.sicau.edu.cn/info/1.htm" }),
    ).toContain("同源");
    expect(
      validateScan({ ...scan, url: "https://xxgc.sicau.edu.cn/info/1.htm" }),
    ).toBeNull();
  });
});
