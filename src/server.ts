import closeWithGrace from "close-with-grace";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = buildApp({ config: env });

closeWithGrace({ delay: 500 }, async ({ signal, err }) => {
  if (err) {
    app.log.error({ err }, "server closing with error");
  } else {
    app.log.info(`${signal} received, server closing`);
  }
  await app.close();
});

await app.ready();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
