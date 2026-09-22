import { join } from "node:path";
import autoload from "@fastify/autoload";
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import fp from "fastify-plugin";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { AppOptions } from "./app-options.js";

export type { AppOptions } from "./app-options.js";

const appPlugin: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  const load = (dir: string) =>
    fastify.register(autoload, {
      dir: join(import.meta.dirname, dir),
      options: opts,
      forceESM: true,
    });
  await load("plugins/external");
  await load("plugins/app");
  await load("routes");
};

export const app = fp(appPlugin, { name: "app" });

export function buildApp(opts: AppOptions): FastifyInstance {
  const instance = Fastify({
    logger: true,
  }).withTypeProvider<ZodTypeProvider>();
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  instance.register(app, opts);
  return instance;
}
