// A null emailVerifiedAt is an account whose signup was never confirmed.
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
}

export interface UpsertUnverifiedInput {
  id: string;
  email: string;
  passwordHash: string;
}

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  // Creates the account unconfirmed, or replaces the password of one still
  // unconfirmed. Null when the address belongs to a confirmed account.
  upsertUnverified(
    input: UpsertUnverifiedInput,
  ): Promise<{ userId: string } | null>;
  // False when the account was already confirmed.
  markVerified(id: string, at: Date): Promise<boolean>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
  purgeAbandonedUnverified(): Promise<number>;
}
