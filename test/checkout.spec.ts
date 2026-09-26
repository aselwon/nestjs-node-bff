import { Cart, Prisma } from "@prisma/client";
import { CartService } from "../src/cart/cart.service";
import { CheckoutService } from "../src/checkout/checkout.service";
import { PrismaService } from "../src/common/prisma.service";
import { RedisService } from "../src/common/redis.service";

describe("Checkout transaction decisions", () => {
  const cart: Cart = {
    id: "cart-id",
    sessionHash: "hash",
    status: "OPEN",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  };
  const tx = {
    order: { findUnique: jest.fn(), create: jest.fn() },
    cartItem: { findMany: jest.fn() },
    product: { findUnique: jest.fn() },
    inventory: { updateMany: jest.fn() },
    cart: { update: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const carts = {
    withLockedCart: async <T>(
      _session: string,
      action: (client: Prisma.TransactionClient, locked: Cart) => Promise<T>,
    ) => action(tx as unknown as Prisma.TransactionClient, cart),
  };
  const cache = { invalidateCatalog: jest.fn().mockResolvedValue(undefined) };
  const service = new CheckoutService(
    carts as unknown as CartService,
    {} as PrismaService,
    cache as unknown as RedisService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.order.findUnique.mockResolvedValue(null);
    tx.cartItem.findMany.mockResolvedValue([]);
  });

  it("does not create an order or reserve stock for an empty cart", async () => {
    await expect(service.checkout("session", "user")).rejects.toThrow(
      "empty cart",
    );
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });
  it("replays an existing order without decrementing inventory", async () => {
    tx.order.findUnique.mockResolvedValue({ id: "order", userId: "user" });
    await expect(service.checkout("session", "user")).resolves.toEqual({
      id: "order",
      userId: "user",
    });
    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });
  it("does not reveal an existing order to another user", async () => {
    tx.order.findUnique.mockResolvedValue({
      id: "order",
      userId: "other-user",
    });
    await expect(service.checkout("session", "user")).rejects.toThrow(
      "different account",
    );
  });
  it("rejects a stock race instead of creating an order", async () => {
    tx.cartItem.findMany.mockResolvedValue([
      { productId: "product", quantity: 2 },
    ]);
    tx.product.findUnique.mockResolvedValue({
      id: "product",
      active: true,
      priceCents: 100,
      name: "Item",
    });
    tx.inventory.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.checkout("session", "user")).rejects.toThrow(
      "Insufficient stock",
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });
  it("snapshots authoritative prices and creates a durable confirmation with the order", async () => {
    tx.cartItem.findMany.mockResolvedValue([
      { productId: "product", quantity: 2 },
    ]);
    tx.product.findUnique.mockResolvedValue({
      id: "product",
      active: true,
      priceCents: 199,
      name: "Item",
    });
    tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    tx.order.create.mockResolvedValue({ id: "order", totalCents: 398 });
    await expect(service.checkout("session", "user")).resolves.toEqual({
      id: "order",
      totalCents: 398,
    });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalCents: 398,
          confirmation: { create: {} },
          items: {
            create: [
              {
                productId: "product",
                name: "Item",
                quantity: 2,
                unitPriceCents: 199,
              },
            ],
          },
        }),
      }),
    );
    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: "cart-id" },
      data: { status: "CHECKED_OUT" },
    });
    expect(cache.invalidateCatalog).toHaveBeenCalledTimes(1);
  });
});
