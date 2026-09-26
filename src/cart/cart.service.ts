import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Cart, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";

export function sessionHash(session: string | undefined): string {
  if (!session || !/^[a-f0-9]{64}$/.test(session))
    throw new UnauthorizedException("Valid X-Cart-Session required");
  return createHash("sha256").update(session).digest("hex");
}

@Injectable()
export class CartService {
  constructor(private readonly db: PrismaService) {}

  async create() {
    const session = randomBytes(32).toString("hex");
    const cart = await this.db.cart.create({
      data: {
        sessionHash: sessionHash(session),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    return {
      id: cart.id,
      session,
      expiresAt: cart.expiresAt,
      status: cart.status,
      items: [],
      totalCents: 0,
      currency: "USD",
    };
  }

  async withLockedCart<T>(
    session: string | undefined,
    action: (tx: Prisma.TransactionClient, cart: Cart) => Promise<T>,
  ): Promise<T> {
    const hash = sessionHash(session);
    return this.db.$transaction(
      async (tx) => {
        const carts = await tx.$queryRaw<
          Cart[]
        >`SELECT * FROM "Cart" WHERE "sessionHash" = ${hash} FOR UPDATE`;
        const cart = carts[0];
        if (!cart || cart.expiresAt.getTime() <= Date.now())
          throw new NotFoundException("Cart not found or expired");
        return action(tx, cart);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  async get(session: string | undefined) {
    const cart = await this.db.cart.findUnique({
      where: { sessionHash: sessionHash(session) },
      include: {
        items: {
          include: { product: { include: { inventory: true } } },
          orderBy: { productId: "asc" },
        },
        order: { select: { id: true } },
      },
    });
    if (!cart || cart.expiresAt.getTime() <= Date.now())
      throw new NotFoundException("Cart not found or expired");
    const items = cart.items.map((item) => ({
      productId: item.productId,
      name: item.product.name,
      quantity: item.quantity,
      unitPriceCents: item.product.priceCents,
      subtotalCents: item.quantity * item.product.priceCents,
      available:
        item.product.active &&
        (item.product.inventory?.stock ?? 0) >= item.quantity,
    }));
    return {
      id: cart.id,
      status: cart.status,
      expiresAt: cart.expiresAt,
      items,
      totalCents: items.reduce((sum, item) => sum + item.subtotalCents, 0),
      currency: "USD",
      orderId: cart.order?.id ?? null,
    };
  }

  async setItem(
    session: string | undefined,
    productId: string,
    quantity: number,
  ) {
    await this.withLockedCart(session, async (tx, cart) => {
      this.requireOpen(cart);
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: { inventory: true },
      });
      if (!product?.active) throw new NotFoundException("Product not found");
      if ((product.inventory?.stock ?? 0) < quantity)
        throw new ConflictException("Insufficient stock");
      const existing = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId } },
      });
      if (
        !existing &&
        (await tx.cartItem.count({ where: { cartId: cart.id } })) >= 100
      )
        throw new ConflictException("Cart item limit reached");
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId } },
        create: { cartId: cart.id, productId, quantity },
        update: { quantity },
      });
    });
    return this.get(session);
  }

  async removeItem(session: string | undefined, productId: string) {
    await this.withLockedCart(session, async (tx, cart) => {
      this.requireOpen(cart);
      await tx.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    });
    return this.get(session);
  }

  private requireOpen(cart: Cart) {
    if (cart.status !== "OPEN")
      throw new ConflictException(
        "Cart already checked out; create a new cart",
      );
  }
}
