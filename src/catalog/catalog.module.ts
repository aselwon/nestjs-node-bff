import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CatalogProductView } from "../common/api-models";
import { Public } from "../auth/auth.guard";
import { RedisService } from "../common/redis.service";
import {
  MockStoreGateway,
  MockStoreModule,
} from "../upstream/mock-store.module";

@Injectable()
export class CatalogService {
  constructor(
    private readonly upstream: MockStoreGateway,
    private readonly cache: RedisService,
  ) {}
  list() {
    return this.cache.catalog(async () => {
      const [products, inventory] = await Promise.all([
        this.upstream.products(),
        this.upstream.inventory(),
      ]);
      const stock = new Map(
        inventory.map((item) => [item.productId, item.stock]),
      );
      return products.map((product) => ({
        ...product,
        currency: "USD" as const,
        stock: stock.get(product.id) ?? 0,
      }));
    });
  }
  async get(id: string) {
    const product = (await this.list()).find((item) => item.id === id);
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }
}

@ApiTags("catalog")
@Public()
@Controller("catalog/products")
class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get()
  @ApiOkResponse({ type: [CatalogProductView] })
  list() {
    return this.catalog.list();
  }
  @Get(":id")
  @ApiOkResponse({ type: CatalogProductView })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.catalog.get(id);
  }
}

@Module({
  imports: [MockStoreModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
