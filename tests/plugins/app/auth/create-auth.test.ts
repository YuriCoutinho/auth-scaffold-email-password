import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../../../../src/plugins/app/auth/create-auth.js";
import { createInMemoryAuthRepository } from "../../../helpers/in-memory-auth-repository.js";

describe("createAuth", () => {
  it("exposes the four auth flows over one repository", async () => {
    const repository = createInMemoryAuthRepository();
    const auth = createAuth({
      repository,
      emailSender: {
        send: vi.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
      },
      checkPwnedPassword: vi.fn().mockResolvedValue(false),
    });

    const signup = await auth.signup(
      "user@example.com",
      "a perfectly fine passphrase",
    );
    expect(signup.outcome).toBe("accepted");
    expect(repository.pendingSignups.size).toBe(1);

    expect((await auth.resendCode(undefined)).outcome).toBe("invalid-session");
    expect((await auth.verifyCode(undefined, "000000", null)).outcome).toBe(
      "invalid",
    );
    expect((await auth.login("nobody@example.com", "x", null)).outcome).toBe(
      "invalid",
    );
  });
});
