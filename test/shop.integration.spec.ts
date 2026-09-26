import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/auth/password";
import { ConfirmationService } from "../src/checkout/confirmation.service";
import { PrismaService } from "../src/common/prisma.service";
import { RedisService } from "../src/common/redis.service";
import { configureApp } from "../src/setup";

type CartResponse = { id: string; session: string };
type OrderResponse = {
  id: string;
  totalCents: number;
  items: { name: string; unitPriceCents: number }[];
};

describe("ShopBFF — real PostgreSQL + Redis HTTP integration", () => {
  let app: INestApplication;
  let db: PrismaService;
  let cache: RedisService;
  let userToken: string;
  let otherToken: string;
  let adminToken: string;
  let productId: string;

  beforeAll(async () => {
    // Never clear a development/demo database by accident.
    if (
      process.env.SHOPBFF_INTEGRATION !== "1" ||
      new URL(process.env.DATABASE_URL ?? "").pathname !== "/shopbff_test"
    ) {
      throw new Error(
        "Use compose.test.yaml: this suite requires the disposable shopbff_test database",
      );
    }
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    cache = app.get(RedisService);
    await cache.client.ping();
  });

  beforeEach(async () => {
    await db.$transaction([
      db.confirmationOutbox.deleteMany(),
      db.orderItem.deleteMany(),
      db.order.deleteMany(),
      db.cartItem.deleteMany(),
      db.cart.deleteMany(),
      db.inventory.deleteMany(),
      db.product.deleteMany(),
      db.user.deleteMany(),
    ]);
    const passwordHash = await hashPassword("UserDemo123!");
    const user = await db.user.create({
      data: { email: "user@test.local", passwordHash },
    });
    const other = await db.user.create({
      data: { email: "other@test.local", passwordHash },
    });
    const admin = await db.user.create({
      data: { email: "admin@test.local", passwordHash, role: "ADMIN" },
    });
    const jwt = app.get(JwtService);
    userToken = await jwt.signAsync({ sub: user.id });
    otherToken = await jwt.signAsync({ sub: other.id });
    adminToken = await jwt.signAsync({ sub: admin.id });
    const product = await db.product.create({
      data: {
        name: "Test keyboard",
        description: "Offline product",
        priceCents: 12999,
        inventory: { create: { stock: 5 } },
      },
    });
    productId = product.id;
    await cache.invalidateCatalog();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function cart(quantity?: number): Promise<CartResponse> {
    const response = await request(app.getHttpServer())
      .post("/cart")
      .expect(201);
    const result = response.body as CartResponse;
    if (quantity !== undefined)
      await request(app.getHttpServer())
        .put(`/cart/items/${productId}`)
        .set("X-Cart-Session", result.session)
        .send({ quantity })
        .expect(200);
    return result;
  }
  function checkout(session: string, token = userToken) {
    return request(app.getHttpServer())
      .post("/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Cart-Session", session);
  }

  it("serves health, Swagger and an aggregated, cached catalog", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
    const docs = await request(app.getHttpServer())
      .get("/docs-json")
      .expect(200);
    expect(docs.body.paths).toHaveProperty("/checkout");
    expect(docs.body.paths["/checkout"].post.security).toEqual([
      { bearer: [], "cart-session": [] },
    ]);
    const response = await request(app.getHttpServer())
      .get("/catalog/products")
      .expect(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: productId,
        stock: 5,
        priceCents: 12999,
        currency: "USD",
      }),
    ]);
    const version = await cache.client.get("catalog:version");
    expect(await cache.client.ttl(`catalog:v${version}`)).toBeGreaterThan(0);
  });

  it("authenticates, protects routes and applies admin RBAC", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "USER@test.local", password: "UserDemo123!" })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "user@test.local", password: "WrongPassword!" })
      .expect(401);
    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", "Bearer garbage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/admin/products")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    await db.user.update({
      where: { email: "admin@test.local" },
      data: { role: "USER" },
    });
    await request(app.getHttpServer())
      .get("/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
  });

  it("falls back to the upstream when reading the Redis cache fails", async () => {
    const read = jest
      .spyOn(cache.client, "get")
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    try {
      const response = await request(app.getHttpServer())
        .get("/catalog/products")
        .expect(200);
      expect(response.body).toEqual([
        expect.objectContaining({ id: productId, stock: 5 }),
      ]);
    } finally {
      read.mockRestore();
    }
  });

  it("reports malformed and oversized JSON as client errors", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{broken")
      .expect(400);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "x".repeat(33000) })
      .expect(413);
  });

  it("isolates sessions, replaces quantities and supports removal", async () => {
    const first = await cart(2);
    const second = await cart();
    expect(first.session).not.toEqual(second.session);
    await request(app.getHttpServer()).get("/cart").expect(401);
    await request(app.getHttpServer())
      .get("/cart")
      .set("X-Cart-Session", "a".repeat(64))
      .expect(404);
    const empty = await request(app.getHttpServer())
      .get("/cart")
      .set("X-Cart-Session", second.session)
      .expect(200);
    expect(empty.body.totalCents).toBe(0);
    const changed = await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set("X-Cart-Session", first.session)
      .send({ quantity: 3 })
      .expect(200);
    expect(changed.body.totalCents).toBe(38997);
    const removed = await request(app.getHttpServer())
      .delete(`/cart/items/${productId}`)
      .set("X-Cart-Session", first.session)
      .expect(200);
    expect(removed.body.items).toEqual([]);
  });

  it("rejects expired carts, invalid quantities and overstock", async () => {
    const current = await cart();
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set("X-Cart-Session", current.session)
      .send({ quantity: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set("X-Cart-Session", current.session)
      .send({ quantity: 6 })
      .expect(409);
    await db.cart.update({
      where: { id: current.id },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .get("/cart")
      .set("X-Cart-Session", current.session)
      .expect(404);
    await checkout(current.session).expect(404);
  });

  it("requires login and rejects empty checkout", async () => {
    const current = await cart();
    await request(app.getHttpServer())
      .post("/checkout")
      .set("X-Cart-Session", current.session)
      .expect(401);
    await checkout(current.session).expect(409);
    expect(await db.order.count()).toBe(0);
  });

  it("serializes same-cart retries and enqueues one confirmation", async () => {
    const current = await cart(2);
    const results = await Promise.all([
      checkout(current.session),
      checkout(current.session),
      checkout(current.session),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    const ids = results.map((result) => (result.body as OrderResponse).id);
    expect(new Set(ids).size).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect(await db.confirmationOutbox.count()).toBe(1);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { productId } })).stock,
    ).toBe(3);
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set("X-Cart-Session", current.session)
      .send({ quantity: 1 })
      .expect(409);
    await checkout(current.session, otherToken).expect(403);
    await request(app.getHttpServer())
      .get(`/orders/${ids[0]}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(404);
    await app.get(ConfirmationService).publishPending();
    const deadline = Date.now() + 5000;
    let sent = false;
    while (Date.now() < deadline) {
      const order = await db.order.findUniqueOrThrow({ where: { id: ids[0] } });
      if (order.confirmationSentAt) {
        sent = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(sent).toBe(true);
  });

  it("sells the final item to exactly one concurrent cart", async () => {
    await db.inventory.update({ where: { productId }, data: { stock: 1 } });
    const first = await cart(1);
    const second = await cart(1);
    const responses = await Promise.all([
      checkout(first.session),
      checkout(second.session, otherToken),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { productId } })).stock,
    ).toBe(0);
    expect(await db.order.count()).toBe(1);
  });

  it("rolls back all stock changes when a later cart line is unavailable", async () => {
    const first = await db.product.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "First",
        description: "",
        priceCents: 100,
        inventory: { create: { stock: 2 } },
      },
    });
    const current = await cart(1);
    await request(app.getHttpServer())
      .put(`/cart/items/${first.id}`)
      .set("X-Cart-Session", current.session)
      .send({ quantity: 1 })
      .expect(200);
    await db.inventory.update({ where: { productId }, data: { stock: 0 } });
    await checkout(current.session).expect(409);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { productId: first.id } }))
        .stock,
    ).toBe(2);
    expect(await db.order.count()).toBe(0);
    expect(await db.confirmationOutbox.count()).toBe(0);
    expect(
      (await db.cart.findUniqueOrThrow({ where: { id: current.id } })).status,
    ).toBe("OPEN");
  });

  it("admin CRUD invalidates cache, rejects nulls, and soft deletion blocks checkout", async () => {
    const authorization = `Bearer ${adminToken}`;
    await request(app.getHttpServer()).get("/catalog/products").expect(200);
    const created = await request(app.getHttpServer())
      .post("/admin/products")
      .set("Authorization", authorization)
      .send({ name: "New product", description: "", priceCents: 900, stock: 2 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await request(app.getHttpServer())
      .get(`/admin/products/${id}`)
      .set("Authorization", authorization)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/admin/products/${id}`)
      .set("Authorization", authorization)
      .send({ priceCents: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/products/${id}`)
      .set("Authorization", authorization)
      .send({ stock: -1 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/products/${id}`)
      .set("Authorization", authorization)
      .send({ priceCents: 1000 })
      .expect(200);
    const catalog = await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .expect(200);
    expect(catalog.body.priceCents).toBe(1000);
    const current = await cart();
    await request(app.getHttpServer())
      .put(`/cart/items/${id}`)
      .set("X-Cart-Session", current.session)
      .send({ quantity: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/admin/products/${id}`)
      .set("Authorization", authorization)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .expect(404);
    await checkout(current.session).expect(409);
  });

  it("preserves order price snapshots after an admin edit", async () => {
    const current = await cart(1);
    const completed = await checkout(current.session).expect(200);
    const order = completed.body as OrderResponse;
    await request(app.getHttpServer())
      .patch(`/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ priceCents: 1, name: "Changed" })
      .expect(200);
    const response = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(response.body.totalCents).toBe(12999);
    expect(response.body.items[0]).toMatchObject({
      name: "Test keyboard",
      unitPriceCents: 12999,
    });
  });
});
