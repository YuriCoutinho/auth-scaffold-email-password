import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export type CheckPwnedPassword = (password: string) => Promise<boolean>;

export interface PwnedPasswordCheckerOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

export function createPwnedPasswordChecker(
  options: PwnedPasswordCheckerOptions = {},
): CheckPwnedPassword {
  const { fetchFn = fetch, timeoutMs = 2000, onError } = options;

  return async (password) => {
    const digest = createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    try {
      const response = await fetchFn(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) {
        return false;
      }
      const body = await response.text();
      return body
        .split("\n")
        .some((line) => line.split(":")[0]?.trim() === suffix);
    } catch (error) {
      // Fail open: signup availability wins over an unavailable third party.
      onError?.(error);
      return false;
    }
  };
}

declare module "fastify" {
  interface FastifyInstance {
    checkPwnedPassword: CheckPwnedPassword;
  }
}

const plugin: FastifyPluginAsync<{
  checkPwnedPassword?: CheckPwnedPassword;
}> = async (fastify, opts) => {
  fastify.decorate(
    "checkPwnedPassword",
    opts.checkPwnedPassword ??
      createPwnedPasswordChecker({
        onError: (error) =>
          fastify.log.warn({ err: error }, "pwned password check failed open"),
      }),
  );
};

export default fp(plugin, { name: "pwned-password" });
