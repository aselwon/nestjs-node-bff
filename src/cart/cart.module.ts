import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";
import { Public } from "../auth/auth.guard";
import { CartService } from "./cart.service";
import { CartView, CreatedCartView } from "../common/api-models";

export class SetCartItemDto {
  @ApiProperty({ example: 2, minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}

@Public()
@ApiTags("cart")
@Controller("cart")
export class CartController {
  constructor(private readonly cart: CartService) {}
  @Post()
  @ApiCreatedResponse({ type: CreatedCartView })
  @ApiOperation({
    summary: "Create a cart; retain the returned secret session token",
  })
  create() {
    return this.cart.create();
  }

  @Get()
  @ApiOkResponse({ type: CartView })
  @ApiSecurity("cart-session")
  get(@Headers("x-cart-session") session?: string) {
    return this.cart.get(session);
  }

  @Put("items/:productId")
  @ApiOkResponse({ type: CartView })
  @ApiSecurity("cart-session")
  setItem(
    @Headers("x-cart-session") session: string | undefined,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: SetCartItemDto,
  ) {
    return this.cart.setItem(session, productId, dto.quantity);
  }

  @Delete("items/:productId")
  @ApiOkResponse({ type: CartView })
  @ApiSecurity("cart-session")
  remove(
    @Headers("x-cart-session") session: string | undefined,
    @Param("productId", ParseUUIDPipe) productId: string,
  ) {
    return this.cart.removeItem(session, productId);
  }
}

@Module({
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
