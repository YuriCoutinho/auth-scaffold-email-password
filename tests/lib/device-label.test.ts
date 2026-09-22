import { describe, expect, it } from "vitest";
import {
  DEVICE_LABEL_MAX_LENGTH,
  deviceLabelFromUserAgent,
} from "../../src/lib/device-label.js";

describe("deviceLabelFromUserAgent", () => {
  it("returns the user agent as the label", () => {
    expect(deviceLabelFromUserAgent("Mozilla/5.0")).toBe("Mozilla/5.0");
  });

  it("truncates long user agents", () => {
    const label = deviceLabelFromUserAgent("x".repeat(1000));
    expect(label).toHaveLength(DEVICE_LABEL_MAX_LENGTH);
  });

  it("returns null when the header is missing", () => {
    expect(deviceLabelFromUserAgent(undefined)).toBeNull();
  });
});
