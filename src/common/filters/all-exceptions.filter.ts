import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

import { Prisma } from '../../generated/prisma/client';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
  path: string;
  timestamp: string;
}

const PRISMA_CODES: Record<string, { status: number; error: string; message: string }> = {
  P2000: { status: 400, error: 'ValueTooLong', message: 'A value is too long for its column' },
  P2002: {
    status: 409,
    error: 'DuplicateRecord',
    message: 'A record with these values already exists',
  },
  P2003: { status: 400, error: 'MissingReference', message: 'A referenced record does not exist' },
  P2011: { status: 400, error: 'NullConstraint', message: 'A required value was missing' },
  P2025: { status: 404, error: 'NotFound', message: 'Record not found' },
};

const PG_RULE_CODES = new Set([
  '23001', // restrict_violation - append-only and immutability guards
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '23P01', // exclusion_violation
]);

interface DriverCause {
  code?: string;
  message?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const body = this.toErrorBody(exception, request);

    if (body.statusCode >= 500) {
      this.logger.error(
        { requestId: body.requestId, path: body.path, err: exception },
        'Unhandled exception',
      );
    }

    void reply.status(body.statusCode).send(body);
  }

  private toErrorBody(exception: unknown, request: FastifyRequest): ErrorBody {
    const base = {
      requestId: String(request.id),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      return { ...base, statusCode: exception.getStatus(), error: exception.name, message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_CODES[exception.code];

      if (mapped) {
        const target = (exception.meta?.target as string[] | string | undefined)?.toString();

        return {
          ...base,
          statusCode: mapped.status,
          error: mapped.error,
          message: target ? `${mapped.message}: ${target}` : mapped.message,
        };
      }

      const rule = this.asDatabaseRule(exception);
      if (rule) return { ...base, ...rule };
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      const rule = this.asDatabaseRule(exception);
      if (rule) return { ...base, ...rule };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'InvalidQuery',
        message: 'The request does not match the expected query shape',
      };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    };
  }

  private asDatabaseRule(
    exception: Error & { meta?: Record<string, unknown> },
  ): Pick<ErrorBody, 'statusCode' | 'error' | 'message'> | null {
    const cause = this.driverCause(exception);

    if (!cause?.code || !PG_RULE_CODES.has(cause.code)) return null;

    this.logger.warn({ pgCode: cause.code, rule: cause.message }, 'Database rule rejected a write');

    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'BusinessRuleViolation',
      message: cause.message ?? 'The database rejected this change',
    };
  }

  private driverCause(exception: Error & { meta?: Record<string, unknown> }): DriverCause | null {
    const adapterError = exception.meta?.driverAdapterError as { cause?: DriverCause } | undefined;

    if (adapterError?.cause?.code) return adapterError.cause;

    const direct = (exception as { cause?: DriverCause }).cause;

    return direct?.code ? direct : null;
  }
}
