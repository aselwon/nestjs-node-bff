import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CartService } from "../cart/cart.service";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis.service";

@Injectable()
export class CheckoutService {
  constructor(
    private readonly carts: CartService,
    private readonly db: PrismaService,
    private readonly cache: RedisService,
  ) {}

  async checkout(session: string | undefined, userId: string) {
    const order = await this.carts.withLockedCart(session, async (tx, cart) => {
      const existing = await tx.order.findUnique({
        where: { cartId: cart.id },
        include: { items: true },
      });
      if (existing) {
        if (existing.userId !== userId)
          throw new ForbiddenException("Cart belongs to a different account");
        return existing;
      }
      if (cart.status !== "OPEN")
        throw new ConflictException("Cart already checked out");
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        orderBy: { productId: "asc" },
      });
      if (!items.length)
        throw new ConflictException("Cannot check out an empty cart");
      const snapshots: {
        productId: string;
        name: string;
        quantity: number;
        unitPriceCents: number;
      }[] = [];
      for (const item of items) {
        // Stable lock order also serializes price/deactivation changes from admin.
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!product?.active)
          throw new ConflictException(`Product unavailable: ${item.productId}`);
        const reserved = await tx.inventory.updateMany({
          where: { productId: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (reserved.count !== 1)
          throw new ConflictException(`Insufficient stock: ${item.productId}`);
        snapshots.push({
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          unitPriceCents: product.priceCents,
        });
      }
      const created = await tx.order.create({
        data: {
          cartId: cart.id,
          userId,
          totalCents: snapshots.reduce(
            (total, item) => total + item.quantity * item.unitPriceCents,
            0,
          ),
          items: { create: snapshots },
          confirmation: { create: {} },
        },
        include: { items: true },
      });
      await tx.cart.update({
        where: { id: cart.id },
        data: { status: "CHECKED_OUT" },
      });
      return created;
    });
    await this.cache.invalidateCatalog();
    return order;
  }

  async get(id: string, userId: string) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
}
