import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { hashPassword } from "../../../src/lib/password.js";
import { hashSessionToken } from "../../../src/lib/token-hash.js";
import { makeAppOptions } from "../../helpers/app-options.js";
import { createInMemoryAuthRepository } from "../../helpers/in-memory-auth-repository.js";

const EMAIL = "foo@gmail.com";
const PASSWORD = "correct-horse-battery-staple";
const PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function repoWithUser() {
  return createInMemoryAuthRepository({
    authUsers: [{ id: 7, email: EMAIL, publicId: PUBLIC_ID, passwordHash }],
  });
}

describe("POST /auth/login", () => {
  it("returns 200 with only public user data and sets the session cookie", async () => {
    const authRepository = repoWithUser();
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "Foo@GMAIL.com", password: PASSWORD },
      headers: { "user-agent": "Mozilla/5.0" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { publicId: PUBLIC_ID } });

    const cookie = response.cookies.find((c) => c.name === "session");
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 2_592_000,
    });

    expect(authRepository.sessions).toHaveLength(1);
    expect(authRepository.sessions[0]).toMatchObject({
      userId: 7,
      deviceLabel: "Mozilla/5.0",
      tokenHash: hashSessionToken(cookie?.value ?? ""),
    });
    expect(authRepository.sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(authRepository.sessions[0]?.tokenHash).not.toBe(cookie?.value);
    await app.close();
  });

  it("returns a generic 401 when the email is not registered", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid credentials." });
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it("returns the same generic 401 on a wrong password", async () => {
    const authRepository = repoWithUser();
    const app = buildApp(makeAppOptions({ authRepository }));
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: "wrong-password-entirely" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Invalid credentials." });
    expect(authRepository.sessions).toEqual([]);
    await app.close();
  });

  it("returns 400 on invalid body", async () => {
    const app = buildApp(makeAppOptions());
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "not-an-email", password: "" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
