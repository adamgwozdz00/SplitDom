import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { Group } from "@/lib/groups/group.aggregate";
import { groupError } from "@/lib/groups/group-error.messages";
import { GroupService } from "@/lib/groups/group.service";
import type { GroupError, GroupRepository, GroupSnapshot, Result } from "@/lib/groups/types";

type JsonObject = Record<string, Json | undefined>;

/**
 * GroupRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `settlement_groups` migration, which scope every read and write to `auth.uid()`.
 */
export function createSupabaseGroupRepository(client: SupabaseClient<Database>): GroupRepository {
  return {
    async create(group) {
      const snapshot = group.toSnapshot();
      const { error } = await client.rpc("create_group", {
        p_group_id: snapshot.id,
        p_name: snapshot.name,
        p_host_id: snapshot.hostId,
        p_period_id: snapshot.openPeriod.id,
        p_period_month: snapshot.openPeriod.month,
        p_now: snapshot.createdAt,
      });
      return error ? fromDbError(error) : { data: undefined };
    },

    async listGroupsOfCurrentUser() {
      const { data, error } = await client.rpc("list_my_groups");
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
      const { data, error } = await client.rpc("get_my_group", { p_group_id: groupId });
      if (error) {
        return fromDbError(error);
      }
      return data === null ? { data: null } : restore(data, groupId);
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
  const period = asObject(group.open_period, "group.open_period");
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
    openPeriod: {
      id: asString(period.id, "open_period.id"),
      month: asString(period.month, "open_period.month"),
      openedAt: asInstant(period.opened_at, "open_period.opened_at"),
    },
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
