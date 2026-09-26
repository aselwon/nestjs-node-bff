import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./setup";

async function bootstrap() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer in 1..65535");
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
}

void bootstrap().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Application startup failed",
  );
  process.exitCode = 1;
});
