import { describe, expect, it } from "vitest";
import type { Executor } from "../../../src/db/client.js";
import { createLogout } from "../../../src/features/logout/use-case.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { DEFAULT_TTL } from "../../../src/lib/ttl.js";
import { createSessionsService } from "../../../src/modules/sessions/service.js";
import {
  createInMemoryStore,
  type InMemorySeed,
} from "../../helpers/in-memory-store.js";

const TOKEN = "a-session-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

// The store's sessions repository factory ignores the executor it is handed,
// so any value satisfying the type stands in for a real connection.
const db = {} as Executor;

function makeLogout(seed: InMemorySeed = {}) {
  const store = createInMemoryStore(seed);
  const sessions = createSessionsService({
    repo: store.repositories.sessions(db),
    ttl: DEFAULT_TTL,
  });
  return { store, logout: createLogout({ sessions }) };
}

describe("logout", () => {
  it("deletes the session behind the hash of the token, never the token", async () => {
    const { store, logout } = makeLogout({
      sessions: [
        { id: SESSION_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      ],
    });

    await logout(TOKEN);

    expect(store.sessions.has(SESSION_ID)).toBe(false);
  });

  it("does nothing without a cookie", async () => {
    const { store, logout } = makeLogout({
      sessions: [
        { id: SESSION_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      ],
    });

    await logout(undefined);

    expect(store.sessions.has(SESSION_ID)).toBe(true);
  });

  it("does nothing for an empty cookie", async () => {
    const { store, logout } = makeLogout({
      sessions: [
        { id: SESSION_ID, userId: USER_ID, tokenHash: hashSessionToken(TOKEN) },
      ],
    });

    await logout("");

    expect(store.sessions.has(SESSION_ID)).toBe(true);
  });

  it("resolves for a token with no matching session", async () => {
    const { logout } = makeLogout();

    await expect(logout("unknown-token")).resolves.toBeUndefined();
  });
});
