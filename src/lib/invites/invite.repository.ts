import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { Invite } from "@/lib/invites/invite.aggregate";
import { inviteError } from "@/lib/invites/invite-error.messages";
import { InviteToken } from "@/lib/invites/invite-token.value";
import { InviteService } from "@/lib/invites/invite.service";
import type { InviteError, InviteLookup, InviteRepository, InviteSnapshot, Result } from "@/lib/invites/types";

type JsonObject = Record<string, Json | undefined>;

/**
 * InviteRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `group_invites` migration, which scope every read and write to `auth.uid()` and store
 * only the token's hash.
 */
export function createSupabaseInviteRepository(client: SupabaseClient<Database>): InviteRepository {
  return {
    async create(invite, token) {
      const snapshot = invite.toSnapshot();
      const { error } = await client.rpc("create_group_invite", {
        p_invite_id: snapshot.id,
        p_group_id: snapshot.groupId,
        p_token: token.value,
        p_created_by: snapshot.createdBy,
        p_created_at: snapshot.createdAt,
        p_expires_at: snapshot.expiresAt,
      });
      return error ? fromDbError(error) : { data: undefined };
    },

    async findByToken(token) {
      const { data, error } = await client.rpc("get_group_invite", { p_token: token.value });
      if (error) {
        return fromDbError(error);
      }
      return data === null ? { data: null } : restore(data);
    },

    async redeem(invite, token) {
      const { data, error } = await client.rpc("redeem_group_invite", {
        p_token: token.value,
        p_used_at: invite.usedAt?.toISOString() ?? new Date().toISOString(),
      });
      if (error) {
        return fromDbError(error);
      }
      if (!isObject(data) || typeof data.group_id !== "string" || typeof data.joined !== "boolean") {
        return inviteError("unexpected", { inviteId: invite.id });
      }
      return { data: { groupId: data.group_id, joined: data.joined } };
    },
  };
}

/**
 * The InviteService for a request, persisting through the signed-in user's Supabase client. The generators
 * must stay arrows: workerd throws "Illegal invocation" for an unbound crypto.randomUUID.
 */
export function createInviteService(client: SupabaseClient<Database>): InviteService {
  return new InviteService(
    createSupabaseInviteRepository(client),
    () => crypto.randomUUID(),
    () => new Date(),
    () => InviteToken.generate(),
  );
}

function fromDbError(error: PostgrestError): InviteError {
  switch (error.code) {
    case "28000":
      return inviteError("not_authenticated");
    case "SD001":
      return inviteError("invite_invalid");
    case "42501":
      return inviteError("group_not_found");
    default:
      return inviteError("unexpected", { dbCode: error.code });
  }
}

// Stored data that cannot be mapped or breaks an invariant surfaces as `unexpected`, never as a raw throw.
function restore(value: Json): Result<InviteLookup> {
  try {
    const row = asObject(value, "invite");
    const snapshot: InviteSnapshot = {
      id: asString(row.id, "invite.id"),
      groupId: asString(row.group_id, "invite.group_id"),
      createdBy: asString(row.created_by, "invite.created_by"),
      createdAt: asInstant(row.created_at, "invite.created_at"),
      expiresAt: asInstant(row.expires_at, "invite.expires_at"),
      usedAt: row.used_at === null ? null : asInstant(row.used_at, "invite.used_at"),
      usedBy: row.used_by === null ? null : asString(row.used_by, "invite.used_by"),
    };
    if (typeof row.caller_is_member !== "boolean") {
      throw new TypeError("invite.caller_is_member: expected a boolean");
    }
    return {
      data: {
        invite: Invite.restore(snapshot),
        groupName: asString(row.group_name, "invite.group_name"),
        callerIsMember: row.caller_is_member,
      },
    };
  } catch {
    return inviteError("unexpected", { inviteId: idOf(value) });
  }
}

function idOf(value: Json): string | null {
  const id = isObject(value) ? value.id : null;
  return typeof id === "string" ? id : null;
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
