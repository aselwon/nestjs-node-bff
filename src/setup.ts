import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json } from "express";
import helmet from "helmet";
import { ApiErrorFilter } from "./common/api-error.filter";

export function configureApp(app: INestApplication) {
  app.use(helmet());
  app.use(json({ limit: "32kb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  const config = new DocumentBuilder()
    .setTitle("ShopBFF")
    .setDescription(
      "Offline fake-store BFF. USD cents; cart session is a secret capability. Checkout requires both JWT and cart session. No real payments or email.",
    )
    .setVersion("1.0.0")
    .addBearerAuth()
    .addApiKey(
      { type: "apiKey", in: "header", name: "X-Cart-Session" },
      "cart-session",
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
    swaggerOptions: { persistAuthorization: false },
  });
  return document;
}
