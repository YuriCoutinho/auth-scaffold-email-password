import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makeAppOptions } from "./helpers/app-options.js";

// Pins what a client can observe while the tree underneath is rearranged.
describe("public surface", () => {
  it("keeps the route table", async () => {
    const app = buildApp(makeAppOptions());
    await app.ready();
    expect(app.printRoutes({ commonPrefix: false })).toMatchSnapshot();
    await app.close();
  });

  it("keeps the OpenAPI document", async () => {
    const app = buildApp(makeAppOptions());
    await app.ready();
    expect(app.swagger()).toMatchSnapshot();
    await app.close();
  });
});
