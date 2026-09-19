import { buildApp } from "./app.js";
import { type Env, loadEnv } from "./config/env.js";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = buildApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        app.log.error(error);
        process.exit(1);
      });
  });
}

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
