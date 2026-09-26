import { Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

/** Offline fake-store boundary: product and inventory APIs are deliberately separate.
 * Replace this provider with HTTP clients when connecting a real upstream. */
@Injectable()
export class MockStoreGateway {
  constructor(private readonly db: PrismaService) {}
  products() {
    return this.db.product.findMany({
      where: { active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, description: true, priceCents: true },
    });
  }
  inventory() {
    return this.db.inventory.findMany({
      select: { productId: true, stock: true },
    });
  }
}

@Module({ providers: [MockStoreGateway], exports: [MockStoreGateway] })
export class MockStoreModule {}
