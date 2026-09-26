import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { AuthRequest } from "../auth/auth.guard";
import { CartModule } from "../cart/cart.module";
import { CheckoutService } from "./checkout.service";
import { ConfirmationService } from "./confirmation.service";
import { OrderView } from "../common/api-models";

@Controller()
@ApiTags("checkout")
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}
  @Post("checkout")
  @HttpCode(200)
  @ApiSecurity({ bearer: [], "cart-session": [] })
  @ApiOkResponse({ type: OrderView })
  @ApiOperation({
    summary: "Check out once per cart; retries return the same order",
  })
  checkout(
    @Headers("x-cart-session") session: string | undefined,
    @Req() request: AuthRequest,
  ) {
    return this.checkoutService.checkout(session, request.user.id);
  }
  @Get("orders/:id")
  @ApiBearerAuth()
  @ApiOkResponse({ type: OrderView })
  get(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthRequest) {
    return this.checkoutService.get(id, request.user.id);
  }
}

@Module({
  imports: [CartModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, ConfirmationService],
})
export class CheckoutModule {}
