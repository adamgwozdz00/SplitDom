import type { BillingMonth } from "@/lib/groups/billing-month.value";
import type { Group } from "@/lib/groups/group.aggregate";

export type GroupErrorCode = "invalid_group_name" | "group_not_found" | "not_authenticated" | "unexpected";

// Project-wide error shape, owned here until a second module needs it.
export interface GroupError {
  error: { code: GroupErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | GroupError;

export interface GroupMember {
  readonly userId: string;
  readonly joinedAt: Date;
}

export interface OpenPeriod {
  readonly id: string;
  readonly month: BillingMonth;
  readonly openedAt: Date;
}

/** Persistence shape of the Group aggregate. Timestamps are UTC ISO strings with millisecond precision. */
export interface GroupSnapshot {
  id: string;
  name: string;
  hostId: string;
  createdAt: string;
  members: { userId: string; joinedAt: string }[];
  /** `month` is the first day of the billing month, `YYYY-MM-01`. */
  openPeriod: { id: string; month: string; openedAt: string };
}

/** Loads and persists Group aggregates on behalf of the signed-in user. */
export interface GroupRepository {
  listGroupsOfCurrentUser(): Promise<Result<Group[]>>;
  findGroupOfCurrentUser(groupId: string): Promise<Result<Group | null>>;
  create(group: Group): Promise<Result<void>>;
}
