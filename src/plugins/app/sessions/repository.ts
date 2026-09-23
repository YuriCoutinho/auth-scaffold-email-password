import type { RevokedReason } from "../../../lib/session.js";

export interface CreateSessionInput {
  userId: number;
  tokenHash: string;
  deviceLabel: string | null;
  expiresAt: Date;
}

export interface SessionRecord {
  id: number;
  userId: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RevokeAllUserSessionsInput {
  userId: number;
  revokedAt: Date;
  revokedReason: RevokedReason;
  // Absent means "revoke literally every session", which is what the caller
  // asks for when it accepts losing the device it is calling from.
  exceptSessionId?: number;
}

export interface RevokeUserSessionInput {
  publicId: string;
  userId: number;
  revokedAt: Date;
  revokedReason: RevokedReason;
  now: Date;
}

export interface ListActiveUserSessionsInput {
  userId: number;
  now: Date;
}

// The internal id travels with the record so the service can match it against
// the id the session hook published, without the public id ever being the key
// anything is looked up by.
export interface ActiveSessionRecord {
  id: number;
  publicId: string;
  deviceLabel: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionRepository {
  createSession(input: CreateSessionInput): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  revokeSessionByTokenHash(
    tokenHash: string,
    revokedAt: Date,
    revokedReason: RevokedReason,
  ): Promise<void>;
  revokeAllUserSessions(
    input: RevokeAllUserSessionsInput,
  ): Promise<{ revokedCount: number }>;
  revokeUserSessionByPublicId(
    input: RevokeUserSessionInput,
  ): Promise<{ revoked: boolean }>;
  listActiveUserSessions(
    input: ListActiveUserSessionsInput,
  ): Promise<ActiveSessionRecord[]>;
}
