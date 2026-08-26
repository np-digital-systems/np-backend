import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

import { Env } from '../../config/env.schema';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly milliseconds: number;

  constructor(config: ConfigService<Env, true>) {
    this.milliseconds = config.get('REQUEST_TIMEOUT_MS', { infer: true });
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.milliseconds),
      catchError((error: unknown) =>
        throwError(() => (error instanceof TimeoutError ? new RequestTimeoutException() : error)),
      ),
    );
  }
}
