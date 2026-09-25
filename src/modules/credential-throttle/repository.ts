export interface ThrottleRecord {
  failedCount: number;
  lastFailedAt: Date;
}

export interface ThrottleFailureInput {
  keyHash: string;
  failedCount: number;
  lastFailedAt: Date;
}

export interface CredentialThrottleRepository {
  findThrottleByKeyHash(keyHash: string): Promise<ThrottleRecord | undefined>;
  upsertThrottleFailure(input: ThrottleFailureInput): Promise<void>;
  clearThrottle(keyHash: string): Promise<void>;
  // A trail this cold no longer extends a block, so it is safe to drop.
  purgeStale(before: Date): Promise<number>;
}
