import { Group } from "@/lib/groups/group.aggregate";
import { GroupName } from "@/lib/groups/group-name.value";
import type { GroupError, GroupRepository, Result } from "@/lib/groups/types";

/** In-memory GroupRepository for unit tests. It returns whatever groups it holds, like a repository scoped to "me". */
export class FakeGroupRepository implements GroupRepository {
  readonly createCalls: Group[] = [];
  readonly findCalls: string[] = [];
  listCalls = 0;
  /** When set, every call fails with this error. */
  failure: GroupError | null = null;

  constructor(private readonly groups: Group[] = []) {}

  listGroupsOfCurrentUser(): Promise<Result<Group[]>> {
    this.listCalls += 1;
    return Promise.resolve(this.failure ?? { data: [...this.groups] });
  }

  findGroupOfCurrentUser(groupId: string): Promise<Result<Group | null>> {
    this.findCalls.push(groupId);
    return Promise.resolve(this.failure ?? { data: this.groups.find((group) => group.id === groupId) ?? null });
  }

  create(group: Group): Promise<Result<void>> {
    this.createCalls.push(group);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    this.groups.push(group);
    return Promise.resolve({ data: undefined });
  }
}

export function groupName(raw: string): GroupName {
  const result = GroupName.create(raw);
  if ("error" in result) {
    throw new Error(`Invalid test group name "${raw}"`);
  }
  return result.data;
}

/** A freshly created group with sensible defaults for tests. */
export function aGroup(overrides: { id?: string; hostId?: string; now?: Date; name?: string } = {}): Group {
  return Group.create({
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    name: groupName(overrides.name ?? "Mokotów"),
    hostId: overrides.hostId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now: overrides.now ?? new Date("2026-10-15T12:00:00.000Z"),
  });
}
