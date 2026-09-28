import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppOptions } from "../../app-options.js";
import { cookiePolicy } from "../../lib/cookies.js";
import { resolveTtl } from "../../lib/ttl.js";
import { logoutSchema } from "./schema.js";
import { createLogout } from "./use-case.js";

const route: FastifyPluginAsyncZod<AppOptions> = async (app, opts) => {
  const cookies = cookiePolicy(resolveTtl(opts.ttl));
  const logout = createLogout({ sessions: app.sessions });

  app.delete("/current", { schema: logoutSchema }, async (request, reply) => {
    await logout(request.cookies[cookies.session.name]);

    // The full cookie options, not just the path: a deletion cookie without
    // Secure does not overwrite a Secure one in every browser, and the
    // session would survive the logout. clearCookie forces Max-Age=0.
    reply.clearCookie(cookies.session.name, cookies.session.options);
    return reply.code(204).send();
  });
};

export default route;
