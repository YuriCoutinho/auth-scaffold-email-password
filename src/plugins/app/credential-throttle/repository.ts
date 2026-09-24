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
}
