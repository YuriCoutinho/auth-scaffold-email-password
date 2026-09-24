import type { RevokedReason } from "../../../lib/session.js";

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
}

// The email and the password hash ride along because every caller that reads
// a reset row needs at least one of them, and joining here keeps the flow at
// one query instead of two.
export interface PasswordResetRecord {
  id: number;
  userId: number;
  email: string;
  passwordHash: string;
  codeHash: string;
  resetSessionToken: string;
  codeAttempts: number;
  lastSentAt: Date;
  // Unlike the signup flow, 0 never means "first send": the same endpoint is
  // both the first request and the resend, so a failed delivery restores the
  // previous count instead of zeroing it.
  codeSendCount: number;
  expiresAt: Date;
}

export interface UpsertPasswordResetInput {
  userId: number;
  codeHash: string;
  resetSessionToken: string;
  expiresAt: Date;
  now: Date;
}

export interface PasswordResetSendState {
  // Rotated on every request, so the write addresses the row by the token it
  // is replacing and hands out a new one.
  resetSessionToken: string;
  codeHash: string;
  expiresAt: Date;
  codeAttempts: number;
  lastSentAt: Date;
  codeSendCount: number;
}

export interface ResetUserPasswordInput {
  userId: number;
  passwordHash: string;
  resetSessionToken: string;
  sessionTokenHash: string;
  deviceLabel: string | null;
  sessionExpiresAt: Date;
  revokedAt: Date;
  revokedReason: RevokedReason;
}

export interface AuthRepository {
  findAuthUserByEmail(email: string): Promise<AuthUserRecord | undefined>;
  findPendingSignupByEmail(
    email: string,
  ): Promise<PendingSignupRecord | undefined>;
  upsertPendingSignup(input: UpsertPendingSignupInput): Promise<{ id: number }>;
  markPendingSignupUndelivered(email: string): Promise<void>;
  findPendingSignupBySessionToken(
    token: string,
  ): Promise<PendingSignupRecord | undefined>;
  updatePendingSignupResendState(
    token: string,
    state: PendingSignupResendState,
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
  findPasswordResetByUserId(
    userId: number,
  ): Promise<PasswordResetRecord | undefined>;
  upsertPasswordReset(input: UpsertPasswordResetInput): Promise<{ id: number }>;
  findPasswordResetBySessionToken(
    token: string,
  ): Promise<PasswordResetRecord | undefined>;
  updatePasswordResetSendState(
    token: string,
    state: PasswordResetSendState,
  ): Promise<void>;
  incrementPasswordResetAttempts(token: string): Promise<void>;
  resetUserPassword(input: ResetUserPasswordInput): Promise<void>;
}
