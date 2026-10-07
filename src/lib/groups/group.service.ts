import { Group } from "@/lib/groups/group.aggregate";
import { groupError } from "@/lib/groups/group-error.messages";
import { GroupName } from "@/lib/groups/group-name.value";
import type { GroupRepository, Result } from "@/lib/groups/types";

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
}
