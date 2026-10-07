import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { Group } from "@/lib/groups/group.aggregate";
import { groupError } from "@/lib/groups/group-error.messages";
import { InviteToken } from "@/lib/groups/invite-token.value";
import { GroupService } from "@/lib/groups/group.service";
import type {
  GroupError,
  GroupInviteSnapshot,
  GroupRepository,
  GroupSnapshot,
  InvitePreview,
  Result,
} from "@/lib/groups/types";

type JsonObject = Record<string, Json | undefined>;

/**
 * GroupRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `settlement_groups` and `billing_period_aggregate` migrations, which scope every read and write to `auth.uid()`.
 */
export function createSupabaseGroupRepository(client: SupabaseClient<Database>): GroupRepository {
  return {
    async create(group) {
      const snapshot = group.toSnapshot();
      const { error } = await client.rpc("add_group", {
        p_group_id: snapshot.id,
        p_name: snapshot.name,
        p_host_id: snapshot.hostId,
        p_now: snapshot.createdAt,
      });
      return error ? fromDbError(error) : { data: undefined };
    },

    async listGroupsOfCurrentUser() {
      const { data, error } = await client.rpc("list_my_group_aggregates");
      if (error) {
        return fromDbError(error);
      }
      if (!Array.isArray(data)) {
        return groupError("unexpected");
      }
      const groups: Group[] = [];
      // One corrupt group fails the whole list: it is a data-integrity bug, not a user error.
      for (const value of data) {
        const group = restore(value, idOf(value));
        if ("error" in group) {
          return group;
        }
        groups.push(group.data);
      }
      return { data: groups };
    },

    async findGroupOfCurrentUser(groupId) {
      const { data, error } = await client.rpc("get_group_aggregate", { p_group_id: groupId });
      if (error) {
        return fromDbError(error);
      }
      return data === null ? { data: null } : restore(data, groupId);
    },

    async findByInviteToken(tokenHash) {
      const { data, error } = await client.rpc("get_group_by_invite_token", { p_token_hash: tokenHash });
      if (error) {
        return fromDbError(error);
      }
      return data === null ? { data: null } : restore(data, idOf(data));
    },

    async previewInvite(tokenHash) {
      const { data, error } = await client.rpc("get_invite_preview", { p_token_hash: tokenHash });
      if (error) {
        return fromDbError(error);
      }
      if (data === null) {
        return { data: null };
      }
      try {
        return { data: toInvitePreview(data) };
      } catch {
        return groupError("unexpected");
      }
    },

    async save(group) {
      const { data, error } = await client.rpc("save_group", {
        p_group_id: group.id,
        p_expected_version: group.version,
        p_new_invites: group.newInvites().map((invite) => ({
          id: invite.id,
          created_by: invite.createdBy,
          created_at: invite.createdAt,
          expires_at: invite.expiresAt,
          token_hash: invite.tokenHash,
        })),
        p_used_invites: group.usedInvites().map((invite) => ({
          id: invite.id,
          used_at: invite.usedAt.toISOString(),
          used_by: invite.usedBy,
        })),
        p_new_members: group.newMembers().map((member) => ({
          user_id: member.userId,
          joined_at: member.joinedAt.toISOString(),
        })),
      });
      // SD001: an invite was claimed meanwhile (by the previous redeem path); the save rolled back, a reload will tell.
      if (error?.code === "SD001") {
        return { data: "conflict" };
      }
      if (error) {
        return fromDbError(error);
      }
      return typeof data === "boolean" ? { data: data ? "saved" : "conflict" } : groupError("unexpected");
    },
  };
}

/**
 * The GroupService for a request, persisting through the signed-in user's Supabase client. The id generator
 * must stay an arrow: workerd throws "Illegal invocation" for an unbound crypto.randomUUID.
 */
export function createGroupService(client: SupabaseClient<Database>): GroupService {
  return new GroupService(
    createSupabaseGroupRepository(client),
    () => crypto.randomUUID(),
    () => new Date(),
    () => InviteToken.generate(),
  );
}

function fromDbError(error: PostgrestError): GroupError {
  return error.code === "28000" ? groupError("not_authenticated") : groupError("unexpected", { dbCode: error.code });
}

// Stored data that cannot be mapped or breaks an invariant surfaces as `unexpected`, never as a raw throw.
function restore(value: Json, groupId: string | null): Result<Group> {
  try {
    return { data: Group.restore(toSnapshot(value)) };
  } catch {
    return groupError("unexpected", { groupId });
  }
}

function idOf(value: Json): string | null {
  const id = isObject(value) ? value.id : null;
  return typeof id === "string" ? id : null;
}

/** Maps the persistence functions' snake_case JSON to a GroupSnapshot; throws TypeError on a malformed shape. */
function toSnapshot(value: Json): GroupSnapshot {
  const group = asObject(value, "group");
  const members = group.members;
  if (!Array.isArray(members)) {
    throw new TypeError("group.members: expected an array");
  }
  const invites = group.invites;
  if (!Array.isArray(invites)) {
    throw new TypeError("group.invites: expected an array");
  }
  if (typeof group.version !== "number") {
    throw new TypeError("group.version: expected a number");
  }
  return {
    id: asString(group.id, "group.id"),
    name: asString(group.name, "group.name"),
    hostId: asString(group.host_id, "group.host_id"),
    createdAt: asInstant(group.created_at, "group.created_at"),
    members: members.map((member) => {
      const row = asObject(member, "group.members[]");
      return {
        userId: asString(row.user_id, "member.user_id"),
        joinedAt: asInstant(row.joined_at, "member.joined_at"),
        email: row.email === null ? null : asString(row.email, "member.email"),
      };
    }),
    version: group.version,
    invites: invites.map(toInviteSnapshot),
  };
}

function toInviteSnapshot(value: Json): GroupInviteSnapshot {
  const row = asObject(value, "group.invites[]");
  return {
    id: asString(row.id, "invite.id"),
    createdBy: asString(row.created_by, "invite.created_by"),
    createdAt: asInstant(row.created_at, "invite.created_at"),
    expiresAt: asInstant(row.expires_at, "invite.expires_at"),
    tokenHash: asString(row.token_hash, "invite.token_hash"),
  };
}

function toInvitePreview(value: Json): InvitePreview {
  const row = asObject(value, "invite preview");
  if (typeof row.caller_is_member !== "boolean") {
    throw new TypeError("invite preview.caller_is_member: expected a boolean");
  }
  return {
    groupId: asString(row.group_id, "invite preview.group_id"),
    groupName: asString(row.group_name, "invite preview.group_name"),
    expiresAt: new Date(asInstant(row.expires_at, "invite preview.expires_at")),
    ...(row.used_at === null ? {} : { usedAt: new Date(asInstant(row.used_at, "invite preview.used_at")) }),
    callerIsMember: row.caller_is_member,
  };
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: Json | undefined, field: string): JsonObject {
  if (!isObject(value)) {
    throw new TypeError(`${field}: expected an object`);
  }
  return value;
}

function asString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field}: expected a string`);
  }
  return value;
}

// Postgres returns microseconds and an offset (`…06.604123+00:00`); the snapshot holds UTC milliseconds.
// An unparseable value makes toISOString() throw RangeError.
function asInstant(value: Json | undefined, field: string): string {
  return new Date(asString(value, field)).toISOString();
}
