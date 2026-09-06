import { type AccountRole } from '../../generated/prisma/enums';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: AccountRole;
  sessionId: string;
}

export interface ActorContext {
  actor: AuthenticatedUser;
  ipAddress: string;
}
