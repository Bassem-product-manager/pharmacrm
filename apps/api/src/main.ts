import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: WA webhook verifies X-Hub-Signature-256 over the raw bytes
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Web app (3000) + admin console (3002) → API (3001). credentials:true for
  // the tenant refresh cookie; the admin console is bearer-only but still
  // needs its origin allowed for cross-origin fetches.
  const origins = [
    ...(process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
    ...(process.env.ADMIN_ORIGIN ?? "http://localhost:3002").split(","),
  ].map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`PharmaCRM API listening on :${port}`);
}

void bootstrap();
