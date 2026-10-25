import { spawn } from "node:child_process";
import { openSync, writeSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function upload({
  source,
  target,
  ssh,
  logDirectory,
  kind,
  attempt,
  wallSeconds,
  ioSeconds = 120,
  killGraceMs = 10_000,
  command = ["rsync"],
  onEvent = (event) => console.log(event),
}) {
  if (!/^(probe|payload)$/.test(kind) || ![1, 2].includes(Number(attempt)))
    throw new Error("Invalid transfer operation");
  if (!(wallSeconds > 0) || !(ioSeconds > 0))
    throw new Error("Invalid transfer deadline");
  const total = statSync(source).size;
  const started = Date.now();
  const elapsed = () => Math.floor((Date.now() - started) / 1000);
  const emit = (fields) =>
    onEvent(
      `phase=upload transport=rsync kind=${kind} attempt=${attempt} ${fields}`,
    );
  const logs = ["stdout", "stderr"].map((stream) =>
    openSync(
      join(logDirectory, `rsync-${kind}-${attempt}.${stream}`),
      "w",
      0o600,
    ),
  );
  let literalBytes;
  let matchedBytes;
  let stopCode;
  let killTimer;
  let spawnError;
  let privateError = "";
  let pending = "";
  const line = (value) => {
    const progress = value.match(
      /^\s*([\d,]+)\s+(\d+)%\s+([\d.]+)([kMGT]?B\/s)\s+/,
    );
    if (progress)
      emit(
        `status=progress bytes=${Number(progress[1].replaceAll(",", ""))} total_bytes=${total} percent=${Number(progress[2])} rate=${Number(progress[3])} rate_unit=${progress[4]} elapsed_seconds=${elapsed()}`,
      );
    const literal = value.match(/^Literal data:\s*([\d,]+)(?: bytes)?\s*$/);
    const matched = value.match(/^Matched data:\s*([\d,]+)(?: bytes)?\s*$/);
    if (literal) literalBytes = Number(literal[1].replaceAll(",", ""));
    if (matched) matchedBytes = Number(matched[1].replaceAll(",", ""));
  };
  emit(`status=started total_bytes=${total} wall_seconds=${wallSeconds}`);
  const child = spawn(
    command[0],
    [
      ...command.slice(1),
      "--times",
      "--partial-dir=.rsync-partial",
      "--info=progress2",
      "--outbuf=L",
      "--stats",
      `--timeout=${ioSeconds}`,
      "-e",
      // rsync parses its remote-shell string: double embedded quotes to preserve paths.
      `'${ssh.replaceAll("'", "''")}'`,
      "--",
      source,
      target,
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  const signalGroup = (signal) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = (code) => {
    if (stopCode) return;
    stopCode = code;
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), killGraceMs);
  };
  const onTerm = () => stop(143);
  const onInterrupt = () => stop(130);
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInterrupt);
  const timer = setTimeout(() => stop(124), wallSeconds * 1000);
  child.stdout.on("data", (chunk) => {
    writeSync(logs[0], chunk);
    const lines = (pending + chunk.toString()).split(/[\r\n]/);
    pending = lines.pop().slice(-8192);
    for (const value of lines) line(value);
  });
  child.stderr.on("data", (chunk) => {
    writeSync(logs[1], chunk);
    privateError = (privateError + chunk.toString()).slice(-16384);
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  let code;
  try {
    code = await new Promise((resolve) =>
      child.once("close", (value) => resolve(value)),
    );
    if (stopCode) signalGroup("SIGKILL");
    line(pending);
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInterrupt);
    for (const descriptor of logs) closeSync(descriptor);
  }
  code =
    stopCode ||
    (spawnError?.code === "ENOENT" ? 127 : spawnError ? 1 : (code ?? 1));
  let category = code === 0 ? "none" : "transfer";
  if ([30, 35, 124, 137].includes(code)) category = "timeout";
  else if ([130, 143].includes(code)) category = "cancelled";
  else if (code === 127) category = "dependency-missing";
  else if (
    /host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      privateError,
    )
  )
    category = "host-key";
  else if (/permission denied|authentication failed/i.test(privateError))
    category = "authentication";
  else if ([10, 12, 255].includes(code)) category = "connection";
  const statisticsAvailable =
    literalBytes !== undefined && matchedBytes !== undefined;
  emit(
    `status=${code === 0 ? "finished" : "failed"} exit_code=${code} category=${category} total_bytes=${total} elapsed_seconds=${elapsed()} stats_available=${statisticsAvailable} literal_bytes=${literalBytes ?? 0} matched_bytes=${matchedBytes ?? 0}`,
  );
  return { code, category, literalBytes, matchedBytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, target, ssh, logDirectory, kind, attempt, wallSeconds] =
    process.argv.slice(2);
  try {
    process.exitCode = (
      await upload({
        source,
        target,
        ssh,
        logDirectory,
        kind,
        attempt: Number(attempt),
        wallSeconds: Number(wallSeconds),
      })
    ).code;
  } catch {
    console.error(
      "phase=upload transport=rsync status=failed category=local-control",
    );
    process.exitCode = 1;
  }
}
