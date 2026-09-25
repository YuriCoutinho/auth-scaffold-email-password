import type { VERIFICATION_PURPOSES } from "../../../db/schema.js";
import type { CreateSessionInput } from "../sessions/repository.js";

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

// A null emailVerifiedAt is an account whose signup was never confirmed.
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
}

export interface UpsertUnverifiedUserInput {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface VerificationCodeState {
  codeHash: string;
  codeAttempts: number;
  // 0 means the current code was never delivered: the next send owes no
  // cooldown and does not count against the send cap.
  codeSendCount: number;
  issuedAt: Date;
  // Moves with issuedAt on every send and stays put when only the token
  // rotates, so a code in the mailbox keeps the deadline it was sent with.
  expiresAt: Date;
}

export interface VerificationCodeKey {
  userId: string;
  purpose: VerificationPurpose;
}

export interface SaveVerificationCodeInput
  extends VerificationCodeKey,
    VerificationCodeState {
  tokenHash: string;
}

// The owner's email and password hash ride along because every caller that
// resolves a code by token needs one of them next.
export interface VerificationCodeRecord extends SaveVerificationCodeInput {
  email: string;
  passwordHash: string;
}

// The hashes the caller read travel with the write, so a code that was
// rotated or reissued in between matches no row instead of being consumed.
export interface ConsumeVerificationCodeInput {
  userId: string;
  tokenHash: string;
  codeHash: string;
}

export type NewSessionInput = Omit<CreateSessionInput, "userId">;

export interface VerifyEmailInput extends ConsumeVerificationCodeInput {
  verifiedAt: Date;
  session: NewSessionInput;
}

export interface ChangePasswordInput {
  userId: string;
  passwordHash: string;
  exceptSessionId: string;
}

export interface ResetPasswordInput extends ConsumeVerificationCodeInput {
  passwordHash: string;
  session: NewSessionInput;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;
  // Creates the account unconfirmed, or replaces the password of one still
  // unconfirmed, and saves its signup code in the same transaction so a
  // concurrent verification never pairs the new password with an old token.
  // Null when the address belongs to a confirmed account.
  startSignup(
    user: UpsertUnverifiedUserInput,
    code: Omit<SaveVerificationCodeInput, "userId" | "purpose">,
  ): Promise<{ userId: string } | null>;
  findVerificationCode(
    key: VerificationCodeKey,
  ): Promise<VerificationCodeRecord | undefined>;
  findVerificationCodeByTokenHash(
    purpose: VerificationPurpose,
    tokenHash: string,
  ): Promise<VerificationCodeRecord | undefined>;
  saveVerificationCode(input: SaveVerificationCodeInput): Promise<void>;
  rotateVerificationToken(
    key: VerificationCodeKey,
    tokenHash: string,
  ): Promise<void>;
  // Compensation for a delivery that failed. Applies only while the row still
  // holds the code that failed to go out, and never touches the token, so it
  // cannot undo a newer request nor kill a cookie already handed out.
  restoreVerificationCode(
    key: VerificationCodeKey,
    failedCodeHash: string,
    previous: VerificationCodeState,
  ): Promise<void>;
  incrementVerificationAttempts(key: VerificationCodeKey): Promise<void>;
  // False when the code was already consumed or rotated, or the account was
  // already confirmed, which is how a concurrent verification learns it lost.
  verifyEmail(input: VerifyEmailInput): Promise<boolean>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  // False when the code was already consumed or rotated.
  resetPassword(input: ResetPasswordInput): Promise<boolean>;
}
