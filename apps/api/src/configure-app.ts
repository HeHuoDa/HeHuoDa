import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter.js";
import { createGlobalValidationPipe } from "./common/pipes/global-validation.pipe.js";

export function configureApp(app: INestApplication): OpenAPIObject {
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle("禾伙搭 API")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "/docs-json",
  });

  return document;
}
