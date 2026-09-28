import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import * as passwordChangedEmail from "../../../src/modules/users/emails/password-changed.js";
import { createUsersService } from "../../../src/modules/users/service.js";
import { FakeEmailSender } from "../../../src/plugins/email/drivers/fake.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

vi.mock(
  "../../../src/modules/users/emails/password-changed.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/modules/users/emails/password-changed.js")
      >();
    return {
      ...actual,
      sendPasswordChanged: vi.fn(actual.sendPasswordChanged),
    };
  },
);

const NOW = new Date("2026-09-24T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "user@example.com";

// The store's users repository factory ignores the executor it is handed, so
// any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeService(
  seed: InMemorySeed = {},
  emailSender: FakeEmailSender = new FakeEmailSender(),
) {
  const store = createInMemoryStore(seed);
  const repo = store.repositories.users(db);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = createUsersService({ repo, emailSender, log });
  return { store, repo, service, emailSender, log };
}

describe("findByEmail", () => {
  it("delegates to the repository", async () => {
    const { service } = makeService({ users: [{ id: USER_ID, email: EMAIL }] });

    expect(await service.findByEmail(EMAIL)).toMatchObject({ id: USER_ID });
    expect(await service.findByEmail("nobody@example.com")).toBeUndefined();
  });
});

describe("findById", () => {
  it("delegates to the repository", async () => {
    const { service } = makeService({ users: [{ id: USER_ID, email: EMAIL }] });

    expect(await service.findById(USER_ID)).toMatchObject({ email: EMAIL });
    expect(await service.findById(OTHER_ID)).toBeUndefined();
  });
});

describe("upsertUnverified", () => {
  it("creates a new unconfirmed account", async () => {
    const { store, service } = makeService();

    await expect(
      service.upsertUnverified({
        id: USER_ID,
        email: EMAIL,
        passwordHash: "hash-1",
      }),
    ).resolves.toEqual({ userId: USER_ID });

    expect(store.users.get(USER_ID)).toMatchObject({
      email: EMAIL,
      passwordHash: "hash-1",
      emailVerifiedAt: null,
    });
  });

  it("replaces the password of an account still pending", async () => {
    const { store, service } = makeService({
      users: [
        {
          id: USER_ID,
          email: EMAIL,
          passwordHash: "old",
          emailVerifiedAt: null,
        },
      ],
    });

    await expect(
      service.upsertUnverified({
        id: OTHER_ID,
        email: EMAIL,
        passwordHash: "new",
      }),
    ).resolves.toEqual({ userId: USER_ID });

    expect(store.users.size).toBe(1);
    expect(store.users.get(USER_ID)).toMatchObject({ passwordHash: "new" });
  });

  it("refuses an account already confirmed", async () => {
    const { store, service } = makeService({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "old" }],
    });

    await expect(
      service.upsertUnverified({
        id: OTHER_ID,
        email: EMAIL,
        passwordHash: "new",
      }),
    ).resolves.toBe(null);

    expect(store.users.get(USER_ID)).toMatchObject({ passwordHash: "old" });
  });
});

describe("markVerified", () => {
  it("confirms an account still pending", async () => {
    const { store, service } = makeService({
      users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt: null }],
    });

    await expect(service.markVerified(USER_ID, NOW)).resolves.toBe(true);
    expect(store.users.get(USER_ID)).toMatchObject({ emailVerifiedAt: NOW });
  });

  it("returns false for an account already confirmed", async () => {
    const { service } = makeService({
      users: [{ id: USER_ID, email: EMAIL }],
    });

    await expect(service.markVerified(USER_ID, NOW)).resolves.toBe(false);
  });
});

describe("setPasswordHash", () => {
  it("replaces the stored hash", async () => {
    const { store, service } = makeService({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "old" }],
    });

    await service.setPasswordHash(USER_ID, "new");

    expect(store.users.get(USER_ID)).toMatchObject({ passwordHash: "new" });
  });
});

describe("purgeAbandonedUnverified", () => {
  it("delegates to the repository", async () => {
    const { store, service } = makeService({
      users: [{ id: USER_ID, email: EMAIL, emailVerifiedAt: null }],
    });

    expect(await service.purgeAbandonedUnverified()).toBe(1);
    expect(store.users.has(USER_ID)).toBe(false);
  });
});

describe("publicProfile", () => {
  it("returns only the id and email, never the password hash", async () => {
    const { service } = makeService({
      users: [{ id: USER_ID, email: EMAIL, passwordHash: "secret-hash" }],
    });

    await expect(service.publicProfile(USER_ID)).resolves.toEqual({
      id: USER_ID,
      email: EMAIL,
    });
  });

  it("returns undefined for a user that does not exist", async () => {
    const { service } = makeService();

    await expect(service.publicProfile(USER_ID)).resolves.toBeUndefined();
  });
});

describe("notifyPasswordChanged", () => {
  it("returns synchronously, without making the caller wait for delivery", async () => {
    const emailSender = new FakeEmailSender();
    const { service } = makeService({}, emailSender);

    const result = service.notifyPasswordChanged({
      to: EMAIL,
      userId: USER_ID,
    });

    expect(result).toBeUndefined();
    await vi.waitFor(() => expect(emailSender.sent).toHaveLength(1));
    expect(emailSender.sent[0]).toMatchObject({ to: EMAIL });
  });

  it("never rejects when the provider fails, and logs the failure", async () => {
    const emailSender = { send: vi.fn().mockRejectedValue(new Error("boom")) };
    const { service, log } = makeService({}, emailSender as never);

    expect(() =>
      service.notifyPasswordChanged({ to: EMAIL, userId: USER_ID }),
    ).not.toThrow();

    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
  });

  it("warns instead of throwing when sending itself rejects unexpectedly", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = createUsersService({
      repo: createInMemoryStore().repositories.users(db),
      emailSender: new FakeEmailSender(),
      log,
    });
    const sendError = new Error("unexpected failure");
    vi.mocked(passwordChangedEmail.sendPasswordChanged).mockRejectedValueOnce(
      sendError,
    );

    expect(() =>
      service.notifyPasswordChanged({ to: EMAIL, userId: USER_ID }),
    ).not.toThrow();

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { err: sendError },
        "failed to send the password changed email",
      ),
    );
  });
});
