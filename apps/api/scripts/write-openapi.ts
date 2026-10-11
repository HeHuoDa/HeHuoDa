import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";

async function writeOpenApi(): Promise<void> {
  process.env.INGESTION_ENABLED = "false";
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  try {
    const document = configureApp(app);
    const output = `${JSON.stringify(document, null, 2)}\n`;
    await writeFile(resolve(process.cwd(), "openapi.json"), output, "utf8");
  } finally {
    await app.close();
  }
}

void writeOpenApi();
