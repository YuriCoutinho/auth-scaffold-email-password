export interface ThrottleRecord {
  failedCount: number;
  lastFailedAt: Date;
  blockedUntil: Date | null;
}

export interface ThrottleFailureInput {
  keyHash: string;
  failedCount: number;
  lastFailedAt: Date;
  blockedUntil: Date | null;
}

export interface CredentialThrottleRepository {
  findThrottleByKeyHash(keyHash: string): Promise<ThrottleRecord | undefined>;
  upsertThrottleFailure(input: ThrottleFailureInput): Promise<void>;
  clearThrottle(keyHash: string): Promise<void>;
}
