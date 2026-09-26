import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class CreateProductDto {
  @ApiProperty({ example: "Mechanical keyboard", maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/)
  name!: string;

  @ApiProperty({ example: "Compact USB keyboard", maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({
    example: 12999,
    minimum: 1,
    maximum: 100000,
    description: "USD cents (integer)",
  })
  @IsInt()
  @Min(1)
  @Max(100000)
  priceCents!: number;

  @ApiProperty({ example: 20, minimum: 0, maximum: 10000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  stock!: number;
}

export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ example: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
