import type { RevokedReason } from "../../../lib/session.js";
import type { OutboxMessage } from "../email-outbox/repository.js";

export interface AuthUserRecord {
  id: number;
  publicId: string;
  passwordHash: string;
}

export interface PendingSignupRecord {
  id: number;
  email: string;
  passwordHash: string;
  codeHash: string;
  signupSessionToken: string;
  codeAttempts: number;
  lastSentAt: Date;
  // 0 means the current code was never delivered: the next resend owes no
  // cooldown and does not count against the send cap.
  codeSendCount: number;
  expiresAt: Date;
}

export interface UpsertPendingSignupInput {
  email: string;
  passwordHash: string;
  codeHash: string;
  signupSessionToken: string;
  expiresAt: Date;
  now: Date;
}

export interface PendingSignupResendState {
  codeHash: string;
  expiresAt: Date;
  codeAttempts: number;
  lastSentAt: Date;
  codeSendCount: number;
}

export interface PromotePendingSignupInput {
  email: string;
  passwordHash: string;
  signupSessionToken: string;
  sessionTokenHash: string;
  deviceLabel: string | null;
  sessionExpiresAt: Date;
}

export interface AuthUserIdentity {
  publicId: string;
  email: string;
}

// The identity read feeds GET /me, so the password hash gets its own read
// instead of widening a shape that a route with no business holding it uses.
export interface AuthUserCredentials {
  id: number;
  email: string;
  passwordHash: string;
}

export interface ChangeUserPasswordInput {
  userId: number;
  passwordHash: string;
  revokedAt: Date;
  revokedReason: RevokedReason;
  exceptSessionId: number;
  message: OutboxMessage;
}

export interface AuthRepository {
  findAuthUserByEmail(email: string): Promise<AuthUserRecord | undefined>;
  findPendingSignupByEmail(
    email: string,
  ): Promise<PendingSignupRecord | undefined>;
  // The email is queued in the same transaction as the write that causes it:
  // a rolled back signup leaves no message to deliver, and a queued message
  // always has the row it belongs to.
  upsertPendingSignupAndQueueEmail(
    input: UpsertPendingSignupInput & { message: OutboxMessage },
  ): Promise<{ id: number }>;
  // Conditional on the code hash so a give-up only frees the quota of the code
  // that failed: a later resend that did arrive must keep its cooldown and its
  // place against the cap.
  markPendingSignupUndeliveredIfCurrent(
    email: string,
    codeHash: string,
  ): Promise<void>;
  findPendingSignupBySessionToken(
    token: string,
  ): Promise<PendingSignupRecord | undefined>;
  updatePendingSignupResendStateAndQueueEmail(
    token: string,
    state: PendingSignupResendState,
    message: OutboxMessage,
  ): Promise<void>;
  incrementCodeAttempts(signupSessionToken: string): Promise<void>;
  promotePendingSignup(
    input: PromotePendingSignupInput,
  ): Promise<{ id: number; publicId: string }>;
  findAuthUserById(id: number): Promise<AuthUserIdentity | undefined>;
  findAuthUserCredentialsById(
    id: number,
  ): Promise<AuthUserCredentials | undefined>;
  changeUserPassword(input: ChangeUserPasswordInput): Promise<void>;
}
