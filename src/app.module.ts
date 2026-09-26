import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ApiTags } from "@nestjs/swagger";
import {
  SkipThrottle,
  ThrottlerGuard,
  ThrottlerModule,
} from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard, Public } from "./auth/auth.guard";
import { CartModule } from "./cart/cart.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CheckoutModule } from "./checkout/checkout.module";
import { DatabaseModule, PrismaService } from "./common/prisma.service";
import { CacheModule, RedisService } from "./common/redis.service";

@ApiTags("health")
@Public()
@SkipThrottle()
@Controller("health")
class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}
  @Get()
  async health() {
    try {
      await Promise.all([
        this.db.$queryRaw`SELECT 1`,
        this.redis.client.ping(),
      ]);
      return { status: "ok", database: "up", redis: "up" };
    } catch {
      throw new ServiceUnavailableException("Database or Redis unavailable");
    }
  }
}

@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    AuthModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    AdminModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
