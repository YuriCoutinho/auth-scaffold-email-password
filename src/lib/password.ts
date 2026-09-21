import argon2 from "argon2";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Precomputed argon2 hash verified when the email is unknown, so login always
// performs exactly one argon2 verification regardless of user existence.
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$QywJaGv9x8kAbC1MOS8Vaw$N3y5WWM4ZmXV+0xivA1g81doriRaqhFetOr3eSSatEI";
