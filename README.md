# ShopBFF

ShopBFF is a NestJS API/BFF for a fictional store. It provides a catalog with inventory, an anonymous cart, JWT-protected checkout, and admin product CRUD. PostgreSQL stores application data; Redis provides catalog caching and the BullMQ queue. The store upstream is an offline mock.

## Stack and MVP scope

- Node.js 22, NestJS 11, strict TypeScript, Prisma, PostgreSQL 16
- Redis 7, BullMQ, JWT HS256, USER and ADMIN roles
- class-validator, Helmet, login throttling, Swagger/OpenAPI
- Jest, SuperTest, and Docker Compose

There is no real payment provider, frontend, email provider, or external upstream integration. Confirmation delivery is a stub: the worker records confirmationSentAt in the database.

## Quick start with Docker Compose

Docker with Compose v2 is required.

~~~bash
cp .env.example .env
docker compose up --build
~~~

The default host ports are PostgreSQL 15432, Redis 16379, and API 3000. Override them when needed:

~~~bash
POSTGRES_PORT=25432 REDIS_PORT=26379 PORT=3100 docker compose up --build
~~~

The API is available at http://localhost:3000. Compose runs migrations and an idempotent seed before starting the API. The seed creates demo accounts and four products with upsert, preserving existing records.

If port 3000 is already in use:

~~~bash
PORT=13000 docker compose up -d --build
~~~

Use API=http://localhost:13000 in the examples below.

~~~bash
docker compose down
~~~

Use docker compose down -v only when you also want to remove local PostgreSQL and Redis volumes.

## Local development

You need Node.js 22 and PostgreSQL and Redis matching .env. You can start the supporting services with Compose:

~~~bash
cp .env.example .env
docker compose up -d postgres redis
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run start:dev
~~~

Do not run the Compose api container and npm run start:dev on the same port at the same time.

Key variables are DATABASE_URL (default PostgreSQL on localhost:15432), REDIS_URL (default localhost:16379), JWT_SECRET (at least 32 characters), PORT (default 3000), and NODE_ENV. The secret in .env.example is for local demo use; use your own JWT_SECRET elsewhere.

## Demo accounts

- User: user@shopbff.local / UserDemo123!
- Administrator: admin@shopbff.local / AdminDemo123!

## API and documentation

- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/docs-json
- Health check: http://localhost:3000/health
- Catalog: GET /catalog/products, GET /catalog/products/:id
- Cart: POST /cart, GET /cart, PUT /cart/items/:productId, DELETE /cart/items/:productId
- Auth: POST /auth/login, GET /auth/me
- Checkout: POST /checkout, GET /orders/:id
- Admin: GET/POST /admin/products, GET/PATCH/DELETE /admin/products/:id

### Checkout example

This flow does not require jq; Node extracts the JWT from JSON, while the cart secret stays in a process variable.

~~~bash
API=http://localhost:3000
LOGIN_JSON=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"email":"user@shopbff.local","password":"UserDemo123!"}')
TOKEN=$(printf '%s' "$LOGIN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).accessToken))')
CART_JSON=$(curl -fsS -X POST "$API/cart")
CART_SESSION=$(printf '%s' "$CART_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).session))')
PRODUCT_ID=10000000-0000-4000-8000-000000000001
curl -fsS -X PUT "$API/cart/items/$PRODUCT_ID" -H 'content-type: application/json' -H "X-Cart-Session: $CART_SESSION" -d '{"quantity":2}'
ORDER_JSON=$(curl -fsS -X POST "$API/checkout" -H "Authorization: Bearer $TOKEN" -H "X-Cart-Session: $CART_SESSION")
printf '%s\n' "$ORDER_JSON"
~~~

Checkout is idempotent for a cart. Prices are read again at checkout and stored as order item snapshots.

### Admin examples

~~~bash
ADMIN_JSON=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"email":"admin@shopbff.local","password":"AdminDemo123!"}')
ADMIN_TOKEN=$(printf '%s' "$ADMIN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).accessToken))')
NEW_PRODUCT=$(curl -fsS -X POST "$API/admin/products" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"name":"USB lamp","description":"Desk lamp","priceCents":3499,"stock":12}')
PRODUCT_ID=$(printf '%s' "$NEW_PRODUCT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).id))')
curl -fsS -X PATCH "$API/admin/products/$PRODUCT_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"priceCents":2999,"stock":20,"active":true}'
curl -fsS -X DELETE "$API/admin/products/$PRODUCT_ID" -H "Authorization: Bearer $ADMIN_TOKEN"
~~~

DELETE is a soft delete (active=false), and admin operations require the ADMIN role.

## Domain rules and limits

- Amounts are integer USD cents; product prices range from 1 to 100000.
- Item quantity ranges from 1 to 99; a cart can contain at most 100 distinct products.
- The anonymous X-Cart-Session capability is valid for 7 days; only its hash is stored in the database.
- JWTs expire after one hour. The guard verifies the token and checks the current user and role in the database.
- The catalog cache has a 30 second TTL and versioned keys such as catalog:vN; product changes increment catalog:version. Redis failure is fail-open for the catalog, while the health endpoint returns 503.
- Adding an item does not reserve stock. Checkout locks the cart and products in one transaction, reads current prices, decrements stock, and atomically creates the order and outbox record.
- An asynchronous dispatcher publishes outbox records to BullMQ. The worker retries five times with exponential backoff and records confirmationSentAt; no email provider is called.

## Checkout architecture

~~~mermaid
sequenceDiagram
    participant C as Client
    participant A as NestJS API
    participant D as AuthGuard
    participant DB as PostgreSQL
    participant O as ConfirmationOutbox
    participant R as Redis/BullMQ
    participant W as Confirmation worker
    C->>A: POST /checkout + JWT + X-Cart-Session
    A->>D: Verify JWT, user, and role
    D-->>A: userId
    A->>DB: Transaction + lock cart and products
    DB->>DB: Read prices, check stock, decrement inventory
    DB->>O: Create order, items, and outbox record
    DB-->>A: COMMIT: order with current price snapshots
    A-->>C: 200 order
    O-->>R: Async dispatcher publishes job
    R-->>W: send-confirmation
    W->>DB: Set confirmationSentAt (email stub)
~~~

## Tests and verification

~~~bash
npm test
npm run typecheck
npm run build
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f compose.test.yaml down
~~~

The test Compose stack runs migrations, type checking, unit tests, and integration tests in one container. It uses an isolated shopbff_test database and does not publish PostgreSQL or Redis ports on the host.

## Project structure

- src/catalog — catalog aggregation, mock inventory, and cache
- src/cart — capability sessions and cart operations
- src/checkout — transaction, orders, and confirmation outbox
- src/admin — product CRUD, RBAC, and cache invalidation
- src/auth — JWT login, guard, and roles
- src/upstream — offline mock store
- prisma — schema, migrations, and idempotent seed
- compose.yaml / compose.test.yaml — demo and integration test environments
