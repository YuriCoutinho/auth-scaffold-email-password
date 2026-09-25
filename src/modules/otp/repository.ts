import type { VERIFICATION_PURPOSES } from "../../db/schema.js";

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

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

export interface OtpRepository {
  find(key: VerificationCodeKey): Promise<VerificationCodeRecord | undefined>;
  findByTokenHash(
    purpose: VerificationPurpose,
    tokenHash: string,
  ): Promise<VerificationCodeRecord | undefined>;
  save(input: SaveVerificationCodeInput): Promise<void>;
  rotateToken(key: VerificationCodeKey, tokenHash: string): Promise<void>;
  // Compensation for a delivery that failed. Applies only while the row still
  // holds the code that failed to go out, and never touches the token, so it
  // cannot undo a newer request nor kill a cookie already handed out.
  restore(
    key: VerificationCodeKey,
    failedCodeHash: string,
    previous: VerificationCodeState,
  ): Promise<void>;
  incrementAttempts(key: VerificationCodeKey): Promise<void>;
  // False when the code was already consumed or rotated.
  consume(
    purpose: VerificationPurpose,
    input: ConsumeVerificationCodeInput,
  ): Promise<boolean>;
  purgeExpired(at: Date): Promise<number>;
}
