/** Fixed UTC+8 display, independent of device timezone and optional Intl data. */
export function formatBeijingTime(value: string) {
  const date = new Date(Date.parse(value) + 8 * 3600_000);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError("Invalid time value");
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
