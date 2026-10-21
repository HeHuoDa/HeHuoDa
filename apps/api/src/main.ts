import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp } from "./configure-app.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  configureApp(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>("PORT", 3001);
  const host = app.get(ConfigService).get<string>("HOST", "127.0.0.1");
  await app.listen(port, host);
}

void bootstrap().catch(() => {
  console.error("API 启动失败，请检查运行配置与日志");
  process.exit(1);
});
