import { describe, expect, it, vi } from "vitest";
import { hashOtpCode } from "../../src/lib/token-hash.js";
import {
  createResendCodeService,
  MAX_CODE_SEND_COUNT,
} from "../../src/services/resend-code.js";
import { SIGNUP_TTL_SECONDS } from "../../src/services/signup.js";

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
      updatePendingSignupResendState: vi.fn().mockResolvedValue(undefined),
    },
    emailSender: {
      send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
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
    expect(deps.repo.updatePendingSignupResendState).not.toHaveBeenCalled();
  });

  it("returns limit-reached at the send cap without touching state or provider", async () => {
    const deps = makeDeps(makePending({ codeSendCount: MAX_CODE_SEND_COUNT }));
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "limit-reached",
    });
    expect(deps.repo.updatePendingSignupResendState).not.toHaveBeenCalled();
    expect(deps.emailSender.send).not.toHaveBeenCalled();
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
    expect(deps.repo.updatePendingSignupResendState).not.toHaveBeenCalled();
    expect(deps.emailSender.send).not.toHaveBeenCalled();
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
    });
  });

  it("writes the new state before sending, with reset attempts and renewed expiry", async () => {
    const deps = makeDeps(makePending());
    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "sent",
    });

    const [token, state] =
      deps.repo.updatePendingSignupResendState.mock.calls[0] ?? [];
    expect(token).toBe(TOKEN);
    expect(state.codeAttempts).toBe(0);
    expect(state.codeSendCount).toBe(2);
    expect(state.lastSentAt).toEqual(NOW);
    expect(state.expiresAt).toEqual(
      new Date(NOW.getTime() + SIGNUP_TTL_SECONDS * 1000),
    );

    const message = deps.emailSender.send.mock.calls[0]?.[0];
    expect(message.to).toBe("foo@gmail.com");
    const code = message.subject.match(/\d{6}/)?.[0] ?? "";
    expect(state.codeHash).toBe(hashOtpCode(code));
    expect(state.codeHash).not.toBe("old-hash");

    const updateOrder =
      deps.repo.updatePendingSignupResendState.mock.invocationCallOrder[0] ?? 0;
    const sendOrder = deps.emailSender.send.mock.invocationCallOrder[0] ?? 0;
    expect(updateOrder).toBeLessThan(sendOrder);
  });

  it("restores the previous state and returns email-unavailable when delivery fails", async () => {
    const pending = makePending();
    const deps = makeDeps(pending);
    deps.emailSender.send.mockRejectedValueOnce(new Error("provider down"));

    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "email-unavailable",
    });

    expect(deps.repo.updatePendingSignupResendState).toHaveBeenCalledTimes(2);
    const [, restored] =
      deps.repo.updatePendingSignupResendState.mock.calls[1] ?? [];
    expect(restored).toEqual({
      codeHash: pending.codeHash,
      expiresAt: pending.expiresAt,
      codeAttempts: pending.codeAttempts,
      lastSentAt: pending.lastSentAt,
      codeSendCount: pending.codeSendCount,
    });
  });

  it("still returns email-unavailable when the restore itself fails", async () => {
    const deps = makeDeps(makePending());
    deps.emailSender.send.mockRejectedValueOnce(new Error("provider down"));
    deps.repo.updatePendingSignupResendState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("db down"));

    await expect(
      createResendCodeService(deps).resendCode(TOKEN),
    ).resolves.toEqual({
      outcome: "email-unavailable",
    });
  });
});
