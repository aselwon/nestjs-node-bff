import { ApiProperty, OmitType } from "@nestjs/swagger";

export class CatalogProductView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 12999 }) priceCents!: number;
  @ApiProperty({ enum: ["USD"] }) currency!: string;
  @ApiProperty({ example: 25 }) stock!: number;
}

class CartItemView {
  @ApiProperty({ format: "uuid" }) productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 1, maximum: 99 }) quantity!: number;
  @ApiProperty() unitPriceCents!: number;
  @ApiProperty() subtotalCents!: number;
  @ApiProperty() available!: boolean;
}

export class CartView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["OPEN", "CHECKED_OUT"] }) status!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: [CartItemView] }) items!: CartItemView[];
  @ApiProperty() totalCents!: number;
  @ApiProperty({ enum: ["USD"] }) currency!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) orderId!:
    string | null;
}

export class CreatedCartView extends OmitType(CartView, ["orderId"] as const) {
  @ApiProperty({
    description:
      "Secret capability, returned only on creation. Pass in X-Cart-Session.",
    pattern: "^[a-f0-9]{64}$",
  })
  session!: string;
}

class OrderItemView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) orderId!: string;
  @ApiProperty({ format: "uuid" }) productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unitPriceCents!: number;
  @ApiProperty() quantity!: number;
}

export class OrderView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) cartId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty() totalCents!: number;
  @ApiProperty({ enum: ["USD"] }) currency!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  confirmationSentAt!: string | null;
  @ApiProperty({ type: [OrderItemView] }) items!: OrderItemView[];
}
