import type { FastifyBaseLogger } from "fastify";
import { generateOtpCode } from "../../lib/otp.js";
import {
  generateToken,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SEND_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from "../../lib/session.js";
import { hashOtpCode, hashVerificationToken } from "../../lib/token-hash.js";
import {
  expiresAt as expiryFrom,
  hasExpired,
  type TtlPolicy,
} from "../../lib/ttl.js";
import {
  EmailProviderError,
  type EmailSender,
} from "../../plugins/email/sender.js";
import { renderPasswordResetCodeEmail } from "./emails/password-reset-code.js";
import { renderSignupCodeEmail } from "./emails/signup-code.js";
import type {
  ConsumeVerificationCodeInput,
  OtpRepository,
  VerificationCodeKey,
  VerificationCodeRecord,
  VerificationCodeState,
  VerificationPurpose,
} from "./repository.js";

export type ResendOutcome =
  | "sent"
  | "invalid-session"
  | "cooldown"
  | "limit-reached"
  | "email-unavailable";

export type VerifyOutcome =
  | { outcome: "valid"; code: VerificationCodeRecord }
  | { outcome: "invalid" };

export interface IssuedCode {
  userId: string;
  token: string;
  // Null when a live code was only rotated: nothing new goes to the mailbox.
  delivery: {
    key: VerificationCodeKey;
    to: string;
    code: string;
    codeHash: string;
    previous: VerificationCodeState;
  } | null;
}

export interface OtpServiceDeps {
  repo: OtpRepository;
  emailSender: EmailSender;
  ttl: TtlPolicy;
  hmacSecret: string;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => Date;
}

const PURPOSES = {
  signup: {
    label: "signup code",
    ttl: (ttl: TtlPolicy) => ttl.signupCodeSeconds,
    render: renderSignupCodeEmail,
  },
  password_reset: {
    label: "password reset code",
    ttl: (ttl: TtlPolicy) => ttl.passwordResetCodeSeconds,
    render: renderPasswordResetCodeEmail,
  },
} as const;

// What a request does with the code already on file: a live code blocked by
// the send cap or the cooldown keeps working and only its token rotates, while
// any other case puts a new code in the mailbox.
type NextCode =
  | { kind: "rotate"; state: VerificationCodeState }
  | {
      kind: "issue";
      code: string;
      state: VerificationCodeState;
      previous: VerificationCodeState;
    };

export function createOtpService(deps: OtpServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const ttlFor = (purpose: VerificationPurpose) =>
    PURPOSES[purpose].ttl(deps.ttl);

  function sendGate(
    state: VerificationCodeState,
    currentTime: Date,
  ): "open" | "cooldown" | "limit-reached" {
    if (state.codeSendCount >= MAX_CODE_SEND_COUNT) {
      return "limit-reached";
    }
    // An undelivered code owes no cooldown.
    const withinCooldown =
      state.codeSendCount > 0 &&
      currentTime.getTime() - state.issuedAt.getTime() <
        RESEND_COOLDOWN_SECONDS * 1000;
    return withinCooldown ? "cooldown" : "open";
  }

  function nextCode(
    purpose: VerificationPurpose,
    existing: VerificationCodeRecord | undefined,
    currentTime: Date,
  ): NextCode {
    const live =
      existing && !hasExpired(existing.expiresAt, currentTime)
        ? existing
        : undefined;
    const current: VerificationCodeState | undefined = live && {
      codeHash: live.codeHash,
      codeAttempts: live.codeAttempts,
      codeSendCount: live.codeSendCount,
      issuedAt: live.issuedAt,
      expiresAt: live.expiresAt,
    };
    if (current && sendGate(current, currentTime) !== "open") {
      return { kind: "rotate", state: current };
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(deps.hmacSecret, code);
    const expiresAt = expiryFrom(currentTime, ttlFor(purpose));
    return {
      kind: "issue",
      code,
      state: {
        codeHash,
        codeAttempts: 0,
        codeSendCount: (current?.codeSendCount ?? 0) + 1,
        issuedAt: currentTime,
        expiresAt,
      },
      // Restoring a first send zeroes the count instead of deleting the row,
      // so the cookie already handed out keeps pointing at a code that the
      // next resend can replace without waiting.
      previous: current ?? {
        codeHash,
        codeAttempts: 0,
        codeSendCount: 0,
        issuedAt: currentTime,
        expiresAt,
      },
    };
  }

  // Resolves to whether the email went out and never rejects. Provider bodies
  // are not logged because they can echo the recipient address.
  async function deliver(
    key: VerificationCodeKey,
    to: string,
    code: string,
  ): Promise<boolean> {
    const purpose = PURPOSES[key.purpose];
    try {
      const { providerMessageId } = await deps.emailSender.send({
        to,
        ...purpose.render({ code, ttlMinutes: ttlFor(key.purpose) / 60 }),
      });
      deps.log?.info(
        { userId: key.userId, purpose: key.purpose, providerMessageId },
        `${purpose.label} email sent`,
      );
      return true;
    } catch (error) {
      deps.log?.error(
        error instanceof EmailProviderError
          ? { err: error, purpose: key.purpose, providerStatus: error.status }
          : { err: error, purpose: key.purpose },
        `${purpose.label} email delivery failed`,
      );
      return false;
    }
  }

  return {
    // Every call rotates the token, whether or not a code goes out: a value
    // that stayed the same across calls would answer, in two requests,
    // whether the address has an account. A code already in the mailbox keeps
    // working because its validity lives in the code, not in the token.
    // Never sends: the caller dispatches once its transaction commits.
    async issue(
      owner: { id: string; email: string },
      purpose: VerificationPurpose,
    ): Promise<IssuedCode> {
      const key = { userId: owner.id, purpose };
      const existing = await deps.repo.find(key);
      const next = nextCode(purpose, existing, now());
      const token = generateToken();
      const tokenHash = hashVerificationToken(token);
      if (next.kind === "rotate") {
        await deps.repo.rotateToken(key, tokenHash);
        return { userId: owner.id, token, delivery: null };
      }
      await deps.repo.save({ ...key, tokenHash, ...next.state });
      return {
        userId: owner.id,
        token,
        delivery: {
          key,
          to: owner.email,
          code: next.code,
          codeHash: next.state.codeHash,
          previous: next.previous,
        },
      };
    },

    // Detached on purpose: the responses that start a code are fixed, so
    // awaiting the provider buys nothing and makes a known address slower than
    // an unknown one, which is account enumeration by stopwatch. Failed delivery
    // must not consume quota, so the compensation runs after the response.
    // Called after the transaction commits, on the module bound to the
    // database, so the compensation never runs on a transaction already closed.
    dispatch(issued: IssuedCode): void {
      const delivery = issued.delivery;
      if (!delivery) {
        return;
      }
      const { key, to, code, codeHash, previous } = delivery;
      void deliver(key, to, code)
        .then((delivered) => {
          if (delivered) {
            return;
          }
          return deps.repo.restore(key, codeHash, previous);
        })
        .catch((restoreError) => {
          deps.log?.warn(
            { err: restoreError, purpose: key.purpose },
            "failed to restore verification code after delivery failure",
          );
        });
    },

    // Awaited, unlike the detached sends: the caller already holds a working
    // token, so the response can say whether the new code went out.
    async resend(
      purpose: VerificationPurpose,
      token: string,
    ): Promise<ResendOutcome> {
      const currentTime = now();
      const record = await deps.repo.findByTokenHash(
        purpose,
        hashVerificationToken(token),
      );
      if (!record || hasExpired(record.expiresAt, currentTime)) {
        return "invalid-session";
      }

      const gate = sendGate(record, currentTime);
      if (gate !== "open") {
        return gate;
      }

      const key = { userId: record.userId, purpose };
      const code = generateOtpCode();
      const state: VerificationCodeState = {
        codeHash: hashOtpCode(deps.hmacSecret, code),
        codeAttempts: 0,
        codeSendCount: record.codeSendCount + 1,
        issuedAt: currentTime,
        expiresAt: expiryFrom(currentTime, ttlFor(purpose)),
      };
      await deps.repo.save({
        ...key,
        tokenHash: record.tokenHash,
        ...state,
      });

      if (!(await deliver(key, record.email, code))) {
        // Failed delivery must not consume quota nor start a cooldown; the
        // previous code becomes valid again. Restore is best-effort.
        try {
          await deps.repo.restore(key, state.codeHash, {
            codeHash: record.codeHash,
            codeAttempts: record.codeAttempts,
            codeSendCount: record.codeSendCount,
            issuedAt: record.issuedAt,
            expiresAt: record.expiresAt,
          });
        } catch (restoreError) {
          deps.log?.warn(
            { err: restoreError, purpose },
            "failed to restore verification code after resend failure",
          );
        }
        return "email-unavailable";
      }
      return "sent";
    },

    // Checks the code without consuming it: consumption belongs to the
    // transaction of the flow that acts on it.
    async verify(
      purpose: VerificationPurpose,
      token: string | undefined,
      code: string,
    ): Promise<VerifyOutcome> {
      if (!token) {
        return { outcome: "invalid" };
      }
      const label = PURPOSES[purpose].label;
      const record = await deps.repo.findByTokenHash(
        purpose,
        hashVerificationToken(token),
      );
      // Every case answers the same 401; only the log tells them apart.
      if (!record) {
        deps.log?.info({ purpose }, `${label} token not recognized`);
        return { outcome: "invalid" };
      }
      if (hasExpired(record.expiresAt, now())) {
        deps.log?.info({ userId: record.userId, purpose }, `${label} expired`);
        return { outcome: "invalid" };
      }

      // Exhausted codes stay unusable even if the right code shows up later;
      // a new code or expiry are the only ways out.
      if (record.codeAttempts >= MAX_CODE_ATTEMPTS) {
        return { outcome: "invalid" };
      }

      if (hashOtpCode(deps.hmacSecret, code) !== record.codeHash) {
        await deps.repo.incrementAttempts({
          userId: record.userId,
          purpose,
        });
        const attempts = record.codeAttempts + 1;
        deps.log?.warn(
          { userId: record.userId, purpose, codeAttempts: attempts },
          attempts >= MAX_CODE_ATTEMPTS
            ? `${label} invalidated after too many failed attempts`
            : `${label} verification failed`,
        );
        return { outcome: "invalid" };
      }

      return { outcome: "valid", code: record };
    },

    async consume(
      purpose: VerificationPurpose,
      input: ConsumeVerificationCodeInput,
    ): Promise<boolean> {
      return deps.repo.consume(purpose, input);
    },

    async purgeExpired(at: Date): Promise<number> {
      return deps.repo.purgeExpired(at);
    },
  };
}

export type OtpService = ReturnType<typeof createOtpService>;
