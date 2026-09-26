import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../src/auth/password";

const db = new PrismaClient();

async function seed() {
  const accounts = [
    { email: "user@shopbff.local", password: "UserDemo123!", role: Role.USER },
    {
      email: "admin@shopbff.local",
      password: "AdminDemo123!",
      role: Role.ADMIN,
    },
  ];
  for (const account of accounts) {
    await db.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        role: account.role,
        passwordHash: await hashPassword(account.password),
      },
    });
  }
  const products = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Mechanical keyboard",
      description: "Compact USB keyboard with tactile switches.",
      priceCents: 12999,
      stock: 25,
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Wireless mouse",
      description: "Ergonomic mouse with USB receiver.",
      priceCents: 4999,
      stock: 40,
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      name: "USB-C hub",
      description: "Six-port hub for a tidy desk.",
      priceCents: 6999,
      stock: 15,
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      name: "Desk mat",
      description: "Large felt desk mat.",
      priceCents: 2499,
      stock: 0,
    },
  ];
  for (const product of products) {
    const { stock, ...fields } = product;
    await db.product.upsert({
      where: { id: product.id },
      update: {},
      create: { ...fields, inventory: { create: { stock } } },
    });
  }
  console.log(
    "Demo seed ready: 2 accounts and 4 products; existing data preserved.",
  );
}

void seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
