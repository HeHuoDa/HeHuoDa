import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testDatabase } from "./competition-fixture.js";
import { migrate } from "../src/database/migrate.js";

describe("管理员增量迁移兼容性", () => {
  it("升级已有比赛和学生会话，重复执行安全，旧应用查询仍可用", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hh-admin-migration-"));
    let db: Awaited<ReturnType<typeof testDatabase>> | undefined;
    try {
      const migrations = resolve("migrations");
      for (const file of (await readdir(migrations)).filter(
        (file) => file.endsWith(".sql") && file < "0006",
      ))
        await copyFile(join(migrations, file), join(directory, file));
      db = await testDatabase(directory);
      await db.pool.query(
        "INSERT INTO users(id,nickname) VALUES ('old-student','原账号')",
      );
      await db.pool.query(
        "INSERT INTO auth_sessions(id,user_id,absolute_expires_at) VALUES ('old-session','old-student',now()+interval '1 day')",
      );
      await db.pool.query(
        "INSERT INTO competitions(id,data,publication) VALUES ('old-competition','{}','published')",
      );
      await migrate(db.pool);
      await migrate(db.pool);
      expect(
        (
          await db.pool.query(
            "SELECT nickname FROM users WHERE id='old-student'",
          )
        ).rows[0].nickname,
      ).toBe("原账号");
      expect(
        (
          await db.pool.query(
            "SELECT user_id,revoked_at FROM auth_sessions WHERE id='old-session'",
          )
        ).rows[0],
      ).toMatchObject({ user_id: "old-student", revoked_at: null });
      expect(
        (
          await db.pool.query(
            "SELECT publication FROM competitions WHERE id='old-competition'",
          )
        ).rows[0].publication,
      ).toBe("published");
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM admin_accounts",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM schema_migrations WHERE name='0006_admin.sql'",
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
