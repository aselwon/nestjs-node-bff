import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from "@nestjs/common";
import Redis from "ioredis";
import { redisOptions } from "./config";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client = new Redis({
    ...redisOptions(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });

  constructor() {
    this.client.on("error", () =>
      this.logger.warn("Redis unavailable; catalog falls back to upstream"),
    );
  }

  async catalog<T>(load: () => Promise<T>): Promise<T> {
    let key: string | undefined;
    try {
      const version = (await this.client.get("catalog:version")) ?? "0";
      key = `catalog:v${version}`;
      const cached = await this.client.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      /* A cache outage must not hide the catalog. */
    }
    const result = await load();
    if (key) {
      try {
        await this.client.set(key, JSON.stringify(result), "EX", 30);
      } catch {
        /* fail open */
      }
    }
    return result;
  }

  async invalidateCatalog(): Promise<void> {
    try {
      await this.client.incr("catalog:version");
    } catch {
      this.logger.warn("Catalog invalidation deferred to its 30 second TTL");
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class CacheModule {}
