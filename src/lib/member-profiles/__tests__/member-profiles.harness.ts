import { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";
import type {
  MemberProfileError,
  MemberProfileRepository,
  MemberProfileSnapshot,
  Result,
} from "@/lib/member-profiles/types";

/** In-memory MemberProfileRepository for unit tests, version-guarded like the database. */
export class FakeMemberProfileRepository implements MemberProfileRepository {
  readonly saveCalls: MemberProfile[] = [];
  readonly accountNumberCalls: { groupId: string; userIds: string[] }[] = [];
  /** Answers this many `save` calls with "conflict" before storing anything. */
  saveConflicts = 0;
  /** When set, every call fails with this error. */
  failure: MemberProfileError | null = null;
  readonly displayNameCalls: { groupId: string; userIds: string[] }[] = [];
  /** Rows `displayNames` answers with. */
  visibleNames: { userId: string; displayName: string }[] = [];
  /** Rows `accountNumbers` answers with. */
  visibleNumbers: { userId: string; accountNumber: string }[] = [];
  private readonly profiles = new Map<string, MemberProfileSnapshot>();

  stored(userId: string): MemberProfileSnapshot | undefined {
    return this.profiles.get(userId);
  }

  put(snapshot: MemberProfileSnapshot): void {
    this.profiles.set(snapshot.userId, structuredClone(snapshot));
  }

  loadOwn(userId: string): Promise<Result<MemberProfile>> {
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    const snapshot = this.profiles.get(userId);
    return Promise.resolve({
      data: snapshot ? MemberProfile.restore(structuredClone(snapshot)) : MemberProfile.empty(userId),
    });
  }

  save(profile: MemberProfile): Promise<Result<"saved" | "conflict">> {
    this.saveCalls.push(profile);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    if (this.saveConflicts > 0) {
      this.saveConflicts--;
      return Promise.resolve({ data: "conflict" });
    }
    const stored = this.profiles.get(profile.userId)?.version ?? 0;
    if (stored !== profile.version) {
      return Promise.resolve({ data: "conflict" });
    }
    this.profiles.set(profile.userId, { ...profile.toSnapshot(), version: profile.version + 1 });
    return Promise.resolve({ data: "saved" });
  }

  accountNumbers(groupId: string, userIds: string[]): Promise<Result<{ userId: string; accountNumber: string }[]>> {
    this.accountNumberCalls.push({ groupId, userIds });
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    return Promise.resolve({ data: this.visibleNumbers.filter((row) => userIds.includes(row.userId)) });
  }

  displayNames(groupId: string, userIds: string[]): Promise<Result<{ userId: string; displayName: string }[]>> {
    this.displayNameCalls.push({ groupId, userIds });
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    return Promise.resolve({ data: this.visibleNames.filter((row) => userIds.includes(row.userId)) });
  }
}
