import { Group } from "@/lib/groups/group.aggregate";
import { groupError } from "@/lib/groups/group-error.messages";
import { GroupName } from "@/lib/groups/group-name.value";
import { InviteToken } from "@/lib/groups/invite-token.value";
import { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";
import type { GroupError, GroupRepository, Result } from "@/lib/groups/types";

// Group ids are UUIDs; anything else cannot name a group, so it is not worth a database call.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only entry point to the Group aggregate: it loads and saves groups through the repository
 * and leaves the rules to the aggregate. The clock and id generator are injected so tests are deterministic.
 */
export class GroupService {
  constructor(
    private readonly repository: GroupRepository,
    private readonly newId: () => string,
    private readonly clock: () => Date,
    private readonly newToken: () => InviteToken,
  ) {}

  /** Creates a settlement group hosted by `hostId`. A user may create any number of groups. */
  async create(input: { name: string; hostId: string }): Promise<Result<Group>> {
    const name = GroupName.create(input.name);
    if ("error" in name) {
      return name;
    }

    const group = Group.create({
      id: this.newId(),
      name: name.data,
      hostId: input.hostId,
      now: this.clock(),
    });

    const saved = await this.repository.create(group);
    if ("error" in saved) {
      return saved;
    }
    return { data: group };
  }

  /** The groups `userId` belongs to, newest first. */
  async listForMember(userId: string): Promise<Result<Group[]>> {
    const result = await this.repository.listGroupsOfCurrentUser();
    if ("error" in result) {
      return result;
    }
    const groups = result.data.filter((group) => group.isMember(userId));
    return { data: groups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) };
  }

  /** One group, only if `userId` is its member; otherwise it is reported as not found. */
  async getForMember(input: { groupId: string; userId: string }): Promise<Result<Group>> {
    const notFound = groupError("group_not_found", { groupId: input.groupId });
    if (!UUID.test(input.groupId)) {
      return notFound;
    }

    const result = await this.repository.findGroupOfCurrentUser(input.groupId);
    if ("error" in result) {
      return result;
    }
    if (!result.data?.isMember(input.userId)) {
      return notFound;
    }
    return { data: result.data };
  }

  /** Creates an invite to the group on behalf of `userId`. The token is returned once and only its hash is stored. */
  async invite(input: { groupId: string; userId: string }): Promise<Result<{ token: InviteToken; expiresAt: Date }>> {
    const notFound = groupError("group_not_found", { groupId: input.groupId });
    if (!UUID.test(input.groupId)) {
      return notFound;
    }

    const token = this.newToken();
    const tokenHash = await InviteTokenHash.of(token);
    const id = this.newId();
    return this.change(
      () => this.repository.findGroupOfCurrentUser(input.groupId),
      notFound,
      (group) => {
        const invite = group.invite({ id, by: input.userId, tokenHash, now: this.clock() });
        return "error" in invite ? invite : { data: { token, expiresAt: invite.data.expiresAt } };
      },
    );
  }

  /** Uses up the invite for `userId` and makes them a member; `joined` is false when they already were one. */
  async join(input: { token: string; userId: string }): Promise<Result<{ groupId: string; joined: boolean }>> {
    const token = InviteToken.parse(input.token);
    if (!token) {
      return groupError("invite_invalid");
    }

    const tokenHash = await InviteTokenHash.of(token);
    return this.change(
      () => this.repository.findByInviteToken(tokenHash.value),
      groupError("invite_invalid"),
      (group) => {
        const joined = group.join({ tokenHash, userId: input.userId, now: this.clock() });
        return "error" in joined ? joined : { data: { groupId: group.id, joined: joined.data.joined } };
      },
    );
  }

  /**
   * What the invite page shows before the user joins. A malformed, unknown, used or expired token
   * all give the same `invite_invalid`, so the answer never tells which it was.
   */
  async previewInvite(input: {
    token: string;
  }): Promise<Result<{ groupId: string; groupName: string; callerIsMember: boolean; expiresAt: Date }>> {
    const token = InviteToken.parse(input.token);
    if (!token) {
      return groupError("invite_invalid");
    }

    const found = await this.repository.previewInvite((await InviteTokenHash.of(token)).value);
    if ("error" in found) {
      return found;
    }
    const preview = found.data;
    if (!preview || preview.usedAt || preview.expiresAt.getTime() <= this.clock().getTime()) {
      return groupError("invite_invalid");
    }
    return {
      data: {
        groupId: preview.groupId,
        groupName: preview.groupName,
        callerIsMember: preview.callerIsMember,
        expiresAt: preview.expiresAt,
      },
    };
  }

  /**
   * Loads the group, runs `command` on it and saves. When a concurrent write got there first the group is reloaded and
   * the command runs once more on the fresh state; a second conflict is reported as `group_changed`.
   */
  private async change<T>(
    load: () => Promise<Result<Group | null>>,
    notFound: GroupError,
    command: (group: Group) => Result<T>,
  ): Promise<Result<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const loaded = await load();
      if ("error" in loaded) {
        return loaded;
      }
      if (!loaded.data) {
        return notFound;
      }

      const outcome = command(loaded.data);
      if ("error" in outcome) {
        return outcome;
      }
      const saved = await this.repository.save(loaded.data);
      if ("error" in saved) {
        return saved;
      }
      if (saved.data === "saved") {
        return outcome;
      }
    }
    return groupError("group_changed");
  }
}
