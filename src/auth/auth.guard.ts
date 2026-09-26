import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../common/prisma.service";

export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
export type AuthRequest = Request & {
  user: { id: string; email: string; role: Role };
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>("public", handlers))
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? "");
    if (!match?.[1]) throw new UnauthorizedException("Bearer token required");
    let subject: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(match[1], {
        algorithms: ["HS256"],
        issuer: "shopbff",
        audience: "shopbff-api",
      });
      if (
        typeof payload.sub !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(payload.sub)
      )
        throw new Error("Invalid subject");
      subject = payload.sub;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    const user = await this.db.user.findUnique({
      where: { id: subject },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new UnauthorizedException("Account no longer exists");
    request.user = user;
    const roles = this.reflector.getAllAndOverride<Role[]>("roles", handlers);
    if (roles?.length && !roles.includes(user.role))
      throw new ForbiddenException("Insufficient role");
    return true;
  }
}
