import { noContentSchema } from "../../http/schemas.js";

export const logoutSchema = {
  tags: ["sessions"],
  summary: "Sign out of this device",
  description:
    "Deletes the session behind the cookie of this request and clears " +
    "the cookie. Only this device is signed out: other sessions of the " +
    "same user stay active. The response is 204 whether the cookie was " +
    "missing, unknown, already signed out or expired, so signing out never " +
    "reports the state of a session back to the caller.",
  response: {
    204: noContentSchema,
  },
};
