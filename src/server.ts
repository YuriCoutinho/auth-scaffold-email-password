import { buildApp } from "./app.js";
import { type Env, loadEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createDrizzleAuthRepository } from "./db/drizzle-auth-repository.js";
import { createEmailSender } from "./email/create-email-sender.js";
import { createPwnedPasswordChecker } from "./lib/pwned-password.js";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const database = createDatabase(env.DATABASE_URL);
const checkPwnedPassword = createPwnedPasswordChecker({
  onError: (error) =>
    app.log.warn({ err: error }, "pwned password check failed open"),
});
const app = buildApp({
  authRepository: createDrizzleAuthRepository(database.db),
  emailSender: createEmailSender(env),
  checkPwnedPassword,
  enableDocsUi: env.NODE_ENV !== "production",
});
app.addHook("onClose", async () => {
  await database.close();
});

function shutdown(signal: NodeJS.Signals): void {
  app.log.info(`${signal} received, shutting down`);
  app
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      app.log.error(error);
      process.exit(1);
    });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, shutdown);
}

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
