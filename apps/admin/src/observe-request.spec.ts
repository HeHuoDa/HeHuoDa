import { expect, it, vi } from "vitest";
import { observeRequest } from "./observe-request";
it("轮询只查询已知请求，终态停止，取消后不再查询", async () => {
  vi.useFakeTimers();
  const query = vi
    .fn()
    .mockResolvedValueOnce("running")
    .mockResolvedValueOnce("completed");
  const stop = observeRequest(query);
  await vi.advanceTimersByTimeAsync(2000);
  expect(query).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4000);
  expect(query).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120000);
  expect(query).toHaveBeenCalledTimes(2);
  stop();
  vi.useRealTimers();
});
