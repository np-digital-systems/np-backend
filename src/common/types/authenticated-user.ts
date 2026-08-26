import { type UserRole } from '../../generated/prisma/enums';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: UserRole;
  sessionId: string;
}

export interface ActorContext {
  actor: AuthenticatedUser;
  ipAddress: string;
}
