import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CartController } from "../src/cart/cart.module";
import { CartService, sessionHash } from "../src/cart/cart.service";

describe("Cart HTTP contract", () => {
  let app: INestApplication;
  const cart = {
    create: jest.fn().mockResolvedValue({ session: "a".repeat(64) }),
    get: jest.fn().mockResolvedValue({ items: [], totalCents: 0 }),
    setItem: jest.fn().mockResolvedValue({ items: [{ quantity: 2 }] }),
    removeItem: jest.fn().mockResolvedValue({ items: [] }),
  };
  const productId = "10000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CartController],
      providers: [{ provide: CartService, useValue: cart }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("sets an absolute quantity and passes the session header", async () => {
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set("X-Cart-Session", "a".repeat(64))
      .send({ quantity: 2 })
      .expect(200);
    expect(cart.setItem).toHaveBeenCalledWith("a".repeat(64), productId, 2);
  });
  it.each([0, -1, 100, 1.5, "2", null])(
    "rejects invalid quantity %s before service execution",
    async (quantity) => {
      await request(app.getHttpServer())
        .put(`/cart/items/${productId}`)
        .send({ quantity })
        .expect(400);
      expect(cart.setItem).not.toHaveBeenCalled();
    },
  );
  it("rejects client-supplied prices", async () => {
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .send({ quantity: 1, priceCents: 1 })
      .expect(400);
    expect(cart.setItem).not.toHaveBeenCalled();
  });
  it("rejects malformed product IDs", async () => {
    await request(app.getHttpServer())
      .delete("/cart/items/not-an-id")
      .expect(400);
    expect(cart.removeItem).not.toHaveBeenCalled();
  });
  it("never stores the raw cart secret as its lookup key", () => {
    expect(sessionHash("a".repeat(64))).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionHash("a".repeat(64))).not.toBe("a".repeat(64));
    expect(() => sessionHash(undefined)).toThrow(
      "Valid X-Cart-Session required",
    );
    expect(() => sessionHash("predictable")).toThrow();
  });
});
