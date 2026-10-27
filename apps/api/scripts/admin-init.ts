import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { Pool } from "pg";
import { createAdminAccount } from "../src/admin/admin.service.js";

async function prompt(question: string, secret = false): Promise<string> {
  process.stdout.write(question);
  const output = secret
    ? new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      })
    : process.stdout;
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController();
  rl.once("SIGINT", () => abort.abort());
  try {
    return await rl.question("", { signal: abort.signal });
  } finally {
    rl.close();
    if (secret) process.stdout.write("\n");
  }
}

let pool: Pool | undefined;
try {
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.env.DATABASE_URL
  )
    throw new Error("需要本地交互终端与私有 DATABASE_URL；不接受命令参数");
  const username = await prompt("管理员用户名：");
  const displayName = await prompt("显示名：");
  const password = await prompt("密码（12–256字符，输入不回显）：", true);
  if (password !== (await prompt("再次输入密码：", true)))
    throw new Error("密码不一致");
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await createAdminAccount(client, username, displayName, password);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("管理员已创建；请通过管理端登录");
} catch {
  console.error(
    "初始化失败；请检查输入、账号是否重复、私有配置及数据库迁移（不输出凭据）",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
