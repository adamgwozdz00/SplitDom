import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import type { Expense } from "@/lib/billing-periods/expense.entity";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import type {
  BillingPeriodError,
  BillingPeriodRepository,
  BillingPeriodSnapshot,
  Result,
} from "@/lib/billing-periods/types";
import { Group, GroupName } from "@/lib/groups";

/**
 * In-memory BillingPeriodRepository for unit tests. It holds the latest period of each group as a snapshot,
 * so every load restores a fresh aggregate, and guards `save` with the stored version like the database does.
 */
export class FakeBillingPeriodRepository implements BillingPeriodRepository {
  readonly findCalls: string[] = [];
  readonly openCalls: BillingPeriod[] = [];
  readonly saveCalls: BillingPeriod[] = [];
  /** Answers this many `open` calls with "conflict" before storing anything. */
  openConflicts = 0;
  /** Answers this many `save` calls with "conflict" before storing anything. */
  saveConflicts = 0;
  /** Runs on every forced conflict: the concurrent write that caused it. */
  onConflict: (() => void) | null = null;
  /** When set, every call fails with this error. */
  failure: BillingPeriodError | null = null;
  private readonly periods = new Map<string, BillingPeriodSnapshot>();

  constructor(periods: BillingPeriodSnapshot[] = []) {
    periods.forEach((period) => {
      this.put(period);
    });
  }

  /** The latest stored period of the group. */
  stored(groupId: string): BillingPeriodSnapshot | undefined {
    return this.periods.get(groupId);
  }

  /** Stores `snapshot` as its group's latest period, as a concurrent writer would. */
  put(snapshot: BillingPeriodSnapshot): void {
    this.periods.set(snapshot.groupId, structuredClone(snapshot));
  }

  findCurrentOfGroup(group: Group): Promise<Result<BillingPeriod | null>> {
    this.findCalls.push(group.id);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    const snapshot = this.periods.get(group.id);
    const participants = group.members.map((member) => member.userId);
    return Promise.resolve({ data: snapshot ? BillingPeriod.restore(structuredClone(snapshot), participants) : null });
  }

  open(period: BillingPeriod): Promise<Result<"opened" | "conflict">> {
    this.openCalls.push(period);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    if (this.openConflicts > 0) {
      this.openConflicts -= 1;
      this.onConflict?.();
      return Promise.resolve({ data: "conflict" });
    }
    // The one-open-period-per-group index.
    if (this.periods.get(period.groupId)?.closedAt === null) {
      return Promise.resolve({ data: "conflict" });
    }
    this.put(period.toSnapshot());
    return Promise.resolve({ data: "opened" });
  }

  save(period: BillingPeriod): Promise<Result<"saved" | "conflict">> {
    this.saveCalls.push(period);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    if (this.saveConflicts > 0) {
      this.saveConflicts -= 1;
      this.onConflict?.();
      return Promise.resolve({ data: "conflict" });
    }
    const stored = this.periods.get(period.groupId);
    if (stored?.id !== period.id || stored.version !== period.version) {
      return Promise.resolve({ data: "conflict" });
    }
    this.put({
      ...stored,
      version: stored.version + 1,
      expenses: [...stored.expenses, ...period.newExpenses().map((expense) => expense.toSnapshot())],
    });
    return Promise.resolve({ data: "saved" });
  }

  listOpenMonthsOfCurrentUser(): Promise<Result<{ groupId: string; month: BillingMonth }[]>> {
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    return Promise.resolve({
      data: [...this.periods.values()]
        .filter((period) => period.closedAt === null)
        .map((period) => ({ groupId: period.groupId, month: BillingMonth.fromDate(period.month) })),
    });
  }
}

export const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const GROUP_ID = "11111111-1111-4111-8111-111111111111";
export const PERIOD_ID = "22222222-2222-4222-8222-222222222222";

/** The id of the n-th test member (0 is the host): "member-0" ... */
export function memberId(position: number): string {
  return position === 0 ? HOST_ID : `member-${position}`;
}

/**
 * A group hosted by member 0 with `memberCount` members who joined in order, built through the groups
 * module's public API.
 */
export function aGroup(overrides: { id?: string; memberCount?: number } = {}): Group {
  const name = GroupName.create("Mokotów");
  if ("error" in name) {
    throw new Error("Invalid test group name");
  }
  const created = Group.create({
    id: overrides.id ?? GROUP_ID,
    name: name.data,
    hostId: HOST_ID,
    now: new Date("2026-10-01T08:00:00.000Z"),
  });
  const snapshot = created.toSnapshot();
  const count = overrides.memberCount ?? 2;
  return Group.restore({
    ...snapshot,
    members: Array.from({ length: count }, (_, position) => ({
      userId: memberId(position),
      joinedAt: new Date(Date.parse(snapshot.createdAt) + position * 60_000).toISOString(),
      email: position === 0 ? null : `member-${position}@example.com`,
    })),
  });
}

export interface ExpenseInput {
  id: string;
  payerId?: string;
  title?: string;
  grosze?: number;
  purchasedOn?: string;
  now?: Date;
}

/**
 * The stored snapshot of `group`'s October 2026 period, opened on 1 October, with `expenses` added
 * through the aggregate (so they carry its equal split) and stored at `version`.
 */
export function anOctoberPeriod(
  input: { group?: Group; id?: string; expenses?: ExpenseInput[]; version?: number; closedAt?: string } = {},
): BillingPeriodSnapshot {
  const group = input.group ?? aGroup();
  const period = BillingPeriod.open({
    id: input.id ?? PERIOD_ID,
    groupId: group.id,
    participants: group.members.map((member) => member.userId),
    now: new Date("2026-10-01T08:00:00.000Z"),
  });
  for (const expense of input.expenses ?? []) {
    const added = period.addExpense({
      id: expense.id,
      payerId: expense.payerId ?? HOST_ID,
      title: title(expense.title),
      amount: Money.ofGrosze(expense.grosze ?? 40000),
      purchasedOn: expense.purchasedOn ?? "2026-10-10",
      now: expense.now ?? new Date("2026-10-10T12:00:00.000Z"),
    });
    if ("error" in added) {
      throw new Error(`Invalid test expense: ${added.error.code}`);
    }
  }
  return { ...period.toSnapshot(), version: input.version ?? 0, closedAt: input.closedAt ?? null };
}

/** An expense paid by `payerId` (default: the host) in October 2026, split among `group`'s members by a period. */
export function anExpense(
  input: { id?: string; group?: Group; payerId?: string; title?: string; grosze?: number; purchasedOn?: string } = {},
): Expense {
  const group = input.group ?? aGroup();
  const period = BillingPeriod.open({
    id: PERIOD_ID,
    groupId: group.id,
    participants: group.members.map((member) => member.userId),
    now: new Date("2026-10-01T08:00:00.000Z"),
  });
  const added = period.addExpense({
    id: input.id ?? "33333333-3333-4333-8333-333333333333",
    payerId: input.payerId ?? HOST_ID,
    title: title(input.title),
    amount: Money.ofGrosze(input.grosze ?? 40000),
    purchasedOn: input.purchasedOn ?? "2026-10-10",
    now: new Date("2026-10-10T12:00:00.000Z"),
  });
  if ("error" in added) {
    throw new Error(`Invalid test expense: ${added.error.code}`);
  }
  return added.data;
}

function title(raw = "Czynsz"): ExpenseTitle {
  const result = ExpenseTitle.create(raw);
  if ("error" in result) {
    throw new Error(`Invalid test title "${raw}"`);
  }
  return result.data;
}
