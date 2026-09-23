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

export interface AuthUserIdentity {
  publicId: string;
  email: string;
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
  createSession(input: CreateSessionInput): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  findAuthUserById(id: number): Promise<AuthUserIdentity | undefined>;
}
