import type { Group } from "@/lib/groups";
import { Invite } from "@/lib/invites/invite.aggregate";
import { inviteError } from "@/lib/invites/invite-error.messages";
import { InviteToken } from "@/lib/invites/invite-token.value";
import type { InviteRepository, Result } from "@/lib/invites/types";

/**
 * The only entry point to the Invite aggregate: it generates tokens and ids, loads and saves invites
 * through the repository, and leaves the rules to the aggregate. The clock and generators are injected
 * so tests are deterministic.
 */
export class InviteService {
  constructor(
    private readonly repository: InviteRepository,
    private readonly newId: () => string,
    private readonly clock: () => Date,
    private readonly newToken: () => InviteToken,
  ) {}

  /** Creates an invite to `group` on behalf of `createdBy`. The token is returned once and never stored in plain. */
  async create(input: { group: Group; createdBy: string }): Promise<Result<{ token: InviteToken; expiresAt: Date }>> {
    const invite = Invite.create({
      id: this.newId(),
      group: input.group,
      createdBy: input.createdBy,
      now: this.clock(),
    });
    if ("error" in invite) {
      return invite;
    }

    const token = this.newToken();
    const saved = await this.repository.create(invite.data, token);
    if ("error" in saved) {
      return saved;
    }
    return { data: { token, expiresAt: invite.data.expiresAt } };
  }

  /**
   * What the invite page shows before the user joins. A malformed, unknown, used or expired token
   * all give the same `invite_invalid`, so the answer never tells which it was.
   */
  async preview(input: {
    token: string;
  }): Promise<Result<{ groupId: string; groupName: string; callerIsMember: boolean; expiresAt: Date }>> {
    const token = InviteToken.parse(input.token);
    if (!token) {
      return inviteError("invite_invalid");
    }

    const found = await this.repository.findByToken(token);
    if ("error" in found) {
      return found;
    }
    const lookup = found.data;
    if (!lookup?.invite.isActive(this.clock())) {
      return inviteError("invite_invalid");
    }
    return {
      data: {
        groupId: lookup.invite.groupId,
        groupName: lookup.groupName,
        callerIsMember: lookup.callerIsMember,
        expiresAt: lookup.invite.expiresAt,
      },
    };
  }

  /** Uses up the invite for `userId` and makes them a member; `joined` is false when they already were one. */
  async redeem(input: { token: string; userId: string }): Promise<Result<{ groupId: string; joined: boolean }>> {
    const token = InviteToken.parse(input.token);
    if (!token) {
      return inviteError("invite_invalid");
    }

    const found = await this.repository.findByToken(token);
    if ("error" in found) {
      return found;
    }
    if (!found.data) {
      return inviteError("invite_invalid");
    }

    const redeemed = found.data.invite.redeem(input.userId, this.clock());
    if ("error" in redeemed) {
      return redeemed;
    }
    // The repository claims the invite atomically, so a concurrent redeem that got there first yields `invite_invalid`.
    return this.repository.redeem(redeemed.data, token);
  }
}
