import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof Error && "type" in error) {
      const status =
        error.type === "entity.parse.failed"
          ? 400
          : error.type === "entity.too.large"
            ? 413
            : undefined;
      if (status) {
        response.status(status).json({
          statusCode: status,
          message:
            status === 400 ? "Malformed JSON body" : "Request body too large",
        });
        return;
      }
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      response
        .status(status)
        .json(
          typeof body === "string"
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }
    this.logger.error(
      error instanceof Error ? error.message : "Unknown application error",
    );
    response
      .status(500)
      .json({ statusCode: 500, message: "Internal server error" });
  }
}
