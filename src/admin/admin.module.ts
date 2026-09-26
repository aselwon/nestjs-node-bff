import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma, Role } from "@prisma/client";
import { Roles } from "../auth/auth.guard";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis.service";
import { CreateProductDto, UpdateProductDto } from "./product.dto";

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly cache: RedisService,
  ) {}
  list() {
    return this.db.product.findMany({
      include: { inventory: true },
      orderBy: { createdAt: "asc" },
    });
  }
  async get(id: string) {
    const product = await this.db.product.findUnique({
      where: { id },
      include: { inventory: true },
    });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }
  async create(dto: CreateProductDto) {
    const { stock, ...fields } = dto;
    const product = await this.db.product.create({
      data: { ...fields, inventory: { create: { stock } } },
      include: { inventory: true },
    });
    await this.cache.invalidateCatalog();
    return product;
  }
  async update(id: string, dto: UpdateProductDto) {
    const { stock, ...fields } = dto;
    try {
      const product = await this.db.$transaction(async (tx) => {
        // Explicit product lock even when only inventory changes; matches checkout order.
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
        return tx.product.update({
          where: { id },
          data: {
            ...fields,
            ...(stock === undefined
              ? {}
              : {
                  inventory: {
                    upsert: { create: { stock }, update: { stock } },
                  },
                }),
          },
          include: { inventory: true },
        });
      });
      await this.cache.invalidateCatalog();
      return product;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      )
        throw new NotFoundException("Product not found");
      throw error;
    }
  }
  async remove(id: string) {
    await this.update(id, { active: false });
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller("admin/products")
class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get() list() {
    return this.admin.list();
  }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.get(id);
  }
  @Post() create(@Body() dto: CreateProductDto) {
    return this.admin.create(dto);
  }
  @Patch(":id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.admin.update(id, dto);
  }
  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.remove(id);
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
