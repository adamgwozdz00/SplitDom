import { Group } from "@/lib/groups/group.aggregate";
import { GroupName } from "@/lib/groups/group-name.value";
import { InviteToken } from "@/lib/groups/invite-token.value";
import { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";
import { groupError } from "@/lib/groups/group-error.messages";
import type {
  GroupError,
  GroupInviteSnapshot,
  GroupRepository,
  GroupSnapshot,
  InvitePreview,
  Result,
} from "@/lib/groups/types";

interface StoredGroup {
  snapshot: GroupSnapshot;
  usedInvites: { invite: GroupInviteSnapshot; usedAt: Date }[];
}

/**
 * In-memory GroupRepository for unit tests. It returns whatever groups it holds, like a repository scoped to "me",
 * and guards saves with the group's version like the real one: every load is a fresh aggregate.
 */
export class FakeGroupRepository implements GroupRepository {
  readonly createCalls: Group[] = [];
  readonly findCalls: string[] = [];
  readonly tokenLookups: string[] = [];
  readonly saveCalls: Group[] = [];
  listCalls = 0;
  /** When set, every call fails with this error. */
  failure: GroupError | null = null;
  /** The next this many saves lose the race against a concurrent writer: the version moves and nothing is stored. */
  conflicts = 0;
  /** The user the invite preview reports on. */
  callerId: string | null = null;

  private readonly stored = new Map<string, StoredGroup>();

  constructor(groups: Group[] = []) {
    for (const group of groups) {
      this.stored.set(group.id, { snapshot: group.toSnapshot(), usedInvites: [] });
    }
  }

  /** The members and active invites as currently stored. */
  storedSnapshot(groupId: string): GroupSnapshot | undefined {
    return this.stored.get(groupId)?.snapshot;
  }

  listGroupsOfCurrentUser(): Promise<Result<Group[]>> {
    this.listCalls += 1;
    const groups = [...this.stored.values()].map((entry) => Group.restore(entry.snapshot));
    return Promise.resolve(this.failure ?? { data: groups });
  }

  findGroupOfCurrentUser(groupId: string): Promise<Result<Group | null>> {
    this.findCalls.push(groupId);
    const entry = this.stored.get(groupId);
    return Promise.resolve(this.failure ?? { data: entry ? Group.restore(entry.snapshot) : null });
  }

  create(group: Group): Promise<Result<void>> {
    this.createCalls.push(group);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    this.stored.set(group.id, { snapshot: group.toSnapshot(), usedInvites: [] });
    return Promise.resolve({ data: undefined });
  }

  findByInviteToken(tokenHash: string): Promise<Result<Group | null>> {
    this.tokenLookups.push(tokenHash);
    const entry = [...this.stored.values()].find((candidate) =>
      candidate.snapshot.invites.some((invite) => invite.tokenHash === tokenHash),
    );
    if (!entry) {
      return Promise.resolve(this.failure ?? { data: null });
    }
    const group = Group.restore({
      ...entry.snapshot,
      members: entry.snapshot.members.map((member) => ({ ...member, email: null })),
      invites: entry.snapshot.invites.filter((invite) => invite.tokenHash === tokenHash),
    });
    return Promise.resolve(this.failure ?? { data: group });
  }

  previewInvite(tokenHash: string): Promise<Result<InvitePreview | null>> {
    for (const { snapshot, usedInvites } of this.stored.values()) {
      const active = snapshot.invites.find((invite) => invite.tokenHash === tokenHash);
      const used = usedInvites.find((entry) => entry.invite.tokenHash === tokenHash);
      const invite = active ?? used?.invite;
      if (invite) {
        return Promise.resolve(
          this.failure ?? {
            data: {
              groupId: snapshot.id,
              groupName: snapshot.name,
              expiresAt: new Date(invite.expiresAt),
              ...(used ? { usedAt: used.usedAt } : {}),
              callerIsMember: snapshot.members.some((member) => member.userId === this.callerId),
            },
          },
        );
      }
    }
    return Promise.resolve(this.failure ?? { data: null });
  }

  save(group: Group): Promise<Result<"saved" | "conflict">> {
    this.saveCalls.push(group);
    const entry = this.stored.get(group.id);
    if (this.failure || !entry) {
      return Promise.resolve(this.failure ?? groupError("group_not_found", { groupId: group.id }));
    }
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      entry.snapshot = { ...entry.snapshot, version: entry.snapshot.version + 1 };
      return Promise.resolve({ data: "conflict" });
    }
    if (entry.snapshot.version !== group.version) {
      return Promise.resolve({ data: "conflict" });
    }
    const used = group.usedInvites();
    const usedIds = new Set(used.map((invite) => invite.id));
    for (const invite of entry.snapshot.invites.filter((candidate) => usedIds.has(candidate.id))) {
      const usedAt = used.find((candidate) => candidate.id === invite.id)?.usedAt ?? new Date(0);
      entry.usedInvites.push({ invite, usedAt });
    }
    entry.snapshot = {
      ...entry.snapshot,
      version: entry.snapshot.version + 1,
      members: [
        ...entry.snapshot.members,
        ...group.newMembers().map((member) => ({
          userId: member.userId,
          joinedAt: member.joinedAt.toISOString(),
          email: member.email,
        })),
      ],
      invites: [...entry.snapshot.invites.filter((invite) => !usedIds.has(invite.id)), ...group.newInvites()],
    };
    return Promise.resolve({ data: "saved" });
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

/** A token hash of 32 repetitions of a two-digit hex pair, e.g. `aTokenHash("ab")`. */
export function aTokenHash(pair: string): InviteTokenHash {
  const hash = InviteTokenHash.parse(pair.repeat(32));
  if (!hash) {
    throw new Error(`Invalid test token hash pair "${pair}"`);
  }
  return hash;
}

/** A valid token made of 43 repetitions of one character. */
export function aToken(char: string): InviteToken {
  const token = InviteToken.parse(char.repeat(43));
  if (!token) {
    throw new Error(`Invalid test token character "${char}"`);
  }
  return token;
}

/** A group hosted by `hostId` holding one active invite for `token`, created at `now` by the host. */
export async function aGroupWithInvite(
  token: InviteToken,
  overrides: { id?: string; hostId?: string; now?: Date } = {},
): Promise<Group> {
  const group = aGroup(overrides);
  const invited = group.invite({
    id: "invite-1",
    by: group.hostId,
    tokenHash: await InviteTokenHash.of(token),
    now: overrides.now ?? new Date("2026-10-15T12:00:00.000Z"),
  });
  if ("error" in invited) {
    throw new Error("Test group refused its own host's invite");
  }
  return group;
}
