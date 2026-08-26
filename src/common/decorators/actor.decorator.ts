import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';

import { type ActorContext, type AuthenticatedUser } from '../types/authenticated-user';

export const Actor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: AuthenticatedUser }>();

    return { actor: request.user, ipAddress: request.ip };
  },
);
