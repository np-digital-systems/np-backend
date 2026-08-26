import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';

import { type AuthenticatedUser } from '../types/authenticated-user';

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const user = request.user;

    return field && user ? user[field] : user;
  },
);
