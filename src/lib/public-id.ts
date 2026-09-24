import { randomUUID } from "node:crypto";

// Version 4 on purpose: the public id is not a primary key, so the index
// fragmentation that motivates version 7 does not apply here, and version 7
// would carry the creation instant inside an identifier the API exposes.
export function generatePublicId(): string {
  return randomUUID();
}
