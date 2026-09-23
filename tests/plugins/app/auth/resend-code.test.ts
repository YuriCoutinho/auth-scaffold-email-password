import { describe, expect, it, vi } from "vitest";
import { SIGNUP_TTL_SECONDS } from "../../../../src/lib/session.js";
import { hashOtpCode } from "../../../../src/lib/token-hash.js";
import { SIGNUP_CODE_EMAIL_TYPE } from "../../../../src/plugins/app/auth/emails/signup-code.js";
import {
  createResendCodeService,
  MAX_CODE_SEND_COUNT,
} from "../../../../src/plugins/app/auth/resend-code.js";

const NOW = new Date("2026-09-21T12:00:00Z");
const TOKEN = "session-token";

function makePending(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "foo@gmail.com",
    codeHash: "old-hash",
    codeAttempts: 3,
    lastSentAt: new Date("2026-09-21T11:00:00Z"), // 1h ago: outside cooldown
    codeSendCount: 1,
    expiresAt: new Date("2026-09-21T12:10:00Z"), // not expired
    ...overrides,
  };
}

function makeDeps(pending: ReturnType<typeof makePending> | undefined) {
  return {
    repo: {
      findPendingSignupBySessionToken: vi.fn().mockResolvedValue(pending),
      updatePendingSignupResendStateAndQueueEmail: vi
        .fn()
        .mockResolvedValue(undefined),
    },
    now: () => NOW,
  };
}

describe("resendCode", () => {
  it("returns invalid-session when the token is missing", async () => {
    const deps = makeDeps(undefined);
    const service = createResendCodeService(deps);
    await expect(service.resendCode(undefined)).resolves.toEqual({
      outcome: "invalid-session",
    });
    expect(deps.repo.findPendingSignupBySessionToken).not.toHaveBeenCalled();
  });

  it("returns invalid-session when no pending signup matches", async () => {
    const deps = makeDeps(undefined);
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "invalid-session",
    });
  });

  it("returns invalid-session when the pending signup is expired", async () => {
    const deps = makeDeps(
      makePending({ expiresAt: new Date("2026-09-21T11:59:59Z") }),
    );
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "invalid-session",
    });
    expect(
      deps.repo.updatePendingSignupResendStateAndQueueEmail,
    ).not.toHaveBeenCalled();
  });

  it("returns limit-reached at the send cap without touching state or queue", async () => {
    const deps = makeDeps(makePending({ codeSendCount: MAX_CODE_SEND_COUNT }));
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "limit-reached",
    });
    expect(
      deps.repo.updatePendingSignupResendStateAndQueueEmail,
    ).not.toHaveBeenCalled();
  });

  it("returns cooldown within 60s of the last send", async () => {
    const deps = makeDeps(
      makePending({ lastSentAt: new Date("2026-09-21T11:59:30Z") }),
    );
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "cooldown",
    });
    expect(
      deps.repo.updatePendingSignupResendStateAndQueueEmail,
    ).not.toHaveBeenCalled();
  });

  it("skips the cooldown when code_send_count is 0 (no email delivered for the current code)", async () => {
    const deps = makeDeps(
      makePending({
        codeSendCount: 0,
        lastSentAt: new Date("2026-09-21T11:59:59Z"),
      }),
    );
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "sent",
      sessionToken: TOKEN,
    });
  });

  it("writes the new state and queues the email in one call, with reset attempts and renewed expiry", async () => {
    const deps = makeDeps(makePending());
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "sent",
      sessionToken: TOKEN,
    });

    expect(
      deps.repo.updatePendingSignupResendStateAndQueueEmail,
    ).toHaveBeenCalledOnce();
    const [token, state, message] =
      deps.repo.updatePendingSignupResendStateAndQueueEmail.mock.calls[0] ?? [];
    expect(token).toBe(TOKEN);
    expect(state.codeAttempts).toBe(0);
    expect(state.codeSendCount).toBe(2);
    expect(state.lastSentAt).toEqual(NOW);
    expect(state.expiresAt).toEqual(
      new Date(NOW.getTime() + SIGNUP_TTL_SECONDS * 1000),
    );

    expect(message.type).toBe(SIGNUP_CODE_EMAIL_TYPE);
    expect(message.recipient).toBe("foo@gmail.com");
    const code = message.subject.match(/\d{6}/)?.[0] ?? "";
    expect(state.codeHash).toBe(hashOtpCode(code));
    expect(message.correlationId).toBe(state.codeHash);
    // The message dies with the code it carries, so it is never delivered
    // after the pending signup that minted it has expired.
    expect(message.expiresAt).toEqual(state.expiresAt);
    expect(state.codeHash).not.toBe("old-hash");
    expect(message.html).toContain(code);
    expect(message.text).toContain(code);
  });
});
