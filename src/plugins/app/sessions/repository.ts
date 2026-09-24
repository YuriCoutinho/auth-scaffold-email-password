export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  deviceLabel: string | null;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
}

export interface DeleteUserSessionsInput {
  userId: string;
  // Absent means "delete literally every session", which is what the caller
  // asks for when it accepts losing the device it is calling from.
  exceptSessionId?: string;
}

export interface DeleteUserSessionInput {
  id: string;
  userId: string;
}

export interface ListUserSessionsInput {
  userId: string;
  createdAfter: Date;
}

export interface ActiveSessionRecord {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
}

export interface SessionRepository {
  createSession(input: CreateSessionInput): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  deleteUserSessions(
    input: DeleteUserSessionsInput,
  ): Promise<{ deletedCount: number }>;
  deleteUserSession(
    input: DeleteUserSessionInput,
  ): Promise<{ deleted: boolean }>;
  listUserSessions(
    input: ListUserSessionsInput,
  ): Promise<ActiveSessionRecord[]>;
}
