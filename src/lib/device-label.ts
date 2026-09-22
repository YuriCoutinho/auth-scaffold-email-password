export const DEVICE_LABEL_MAX_LENGTH = 256;

export function deviceLabelFromUserAgent(
  userAgent: string | undefined,
): string | null {
  return userAgent?.slice(0, DEVICE_LABEL_MAX_LENGTH) ?? null;
}
