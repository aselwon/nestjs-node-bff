import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { jwtSecret } from "../common/config";
import { PrismaService } from "../common/prisma.service";
import { AuthRequest, Public } from "./auth.guard";
import { verifyPassword } from "./password";

export class LoginDto {
  @ApiProperty({ example: "user@shopbff.local" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "UserDemo123!", minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email } });
    // Run scrypt even for unknown users to avoid a cheap account timing oracle.
    const valid = await verifyPassword(
      dto.password,
      user?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!user || !valid)
      throw new UnauthorizedException("Invalid email or password");
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      tokenType: "Bearer",
      expiresIn: 3600,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}

@ApiTags("auth")
@Controller("auth")
class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get("me")
  @ApiBearerAuth()
  me(@Req() request: AuthRequest) {
    return request.user;
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: {
          expiresIn: "1h",
          algorithm: "HS256",
          issuer: "shopbff",
          audience: "shopbff-api",
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
