import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { authUsers, sessions } from "../../../src/db/schema.js";
import { hashOtpCode } from "../../../src/lib/token-hash.js";
import { createFakeDb, makeAppDeps } from "../../helpers/app-deps.js";

const TOKEN = "token-x";
const CODE = "123456";

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    signupSessionToken: TOKEN,
    email: "u@e.com",
    passwordHash: "argon2-hash",
    codeHash: hashOtpCode(CODE),
    codeAttempts: 0,
    lastSentAt: new Date(),
    codeSendCount: 1,
    expiresAt: new Date(Date.now() + 600_000),
    ...overrides,
  };
}

async function post(options: {
  pendingRow?: Record<string, unknown>;
  cookie?: boolean;
  code?: string;
}) {
  const fakeDb = createFakeDb({
    pendingRows: options.pendingRow ? [options.pendingRow as never] : [],
  });
  const app = buildApp(makeAppDeps({ db: fakeDb.db }));
  const response = await app.inject({
    method: "POST",
    url: "/auth/verify-code",
    payload: { code: options.code ?? CODE },
    headers: { "user-agent": "Mozilla/5.0" },
    ...(options.cookie === false ? {} : { cookies: { signup_session: TOKEN } }),
  });
  await app.close();
  return { response, fakeDb };
}

describe("POST /auth/verify-code", () => {
  it("responds 200, sets the session cookie and clears the signup cookie on the right code", async () => {
    const { response, fakeDb } = await post({ pendingRow: makePendingRow() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "Email confirmed. You are now signed in.",
    });

    const sessionCookie = response.cookies.find((c) => c.name === "session");
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 2_592_000,
    });
    expect(sessionCookie?.value).not.toBe("");

    const signupCookie = response.cookies.find(
      (c) => c.name === "signup_session",
    );
    expect(signupCookie).toMatchObject({ value: "", path: "/auth" });

    expect(fakeDb.inserts).toHaveLength(2);
    const userInsert = fakeDb.inserts.find((i) => i.table === authUsers);
    expect(userInsert?.values).toMatchObject({
      email: "u@e.com",
      passwordHash: "argon2-hash",
    });
    const sessionInsert = fakeDb.inserts.find((i) => i.table === sessions);
    expect(sessionInsert?.values).toMatchObject({
      deviceLabel: "Mozilla/5.0",
    });
    expect(sessionInsert?.values.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionInsert?.values.tokenHash).not.toBe(sessionCookie?.value);

    expect(fakeDb.deletes).toHaveLength(1);
  });

  it("responds 401 when the cookie is missing", async () => {
    const { response, fakeDb } = await post({
      pendingRow: makePendingRow(),
      cookie: false,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(fakeDb.inserts).toHaveLength(0);
    expect(fakeDb.deletes).toHaveLength(0);
  });

  it("responds 401 on a wrong code", async () => {
    const { response, fakeDb } = await post({
      pendingRow: makePendingRow(),
      code: "654321",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(fakeDb.updates).toHaveLength(1);
    expect(response.cookies.find((c) => c.name === "session")).toBeUndefined();
  });

  it("responds 401 when attempts are exhausted", async () => {
    const { response, fakeDb } = await post({
      pendingRow: makePendingRow({ codeAttempts: 5 }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid or expired code." });
    expect(fakeDb.updates).toHaveLength(0);
    expect(fakeDb.inserts).toHaveLength(0);
  });

  it("responds 400 on a malformed code", async () => {
    const { response } = await post({
      pendingRow: makePendingRow(),
      code: "12a456",
    });
    expect(response.statusCode).toBe(400);
  });
});
