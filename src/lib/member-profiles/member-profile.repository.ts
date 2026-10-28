import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";
import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import { MemberProfileService } from "@/lib/member-profiles/member-profile.service";
import type { MemberProfileError, MemberProfileRepository } from "@/lib/member-profiles/types";

type JsonObject = Record<string, Json | undefined>;

/**
 * MemberProfileRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `member_profiles` migration, which scope every read and write to `auth.uid()`.
 */
export function createSupabaseMemberProfileRepository(client: SupabaseClient<Database>): MemberProfileRepository {
  return {
    async loadOwn(userId) {
      const { data, error } = await client.rpc("get_my_member_profile");
      if (error) {
        return fromDbError(error);
      }
      if (data === null) {
        return { data: MemberProfile.empty(userId) };
      }
      try {
        const row = asObject(data, "profile");
        return {
          data: MemberProfile.restore({
            userId: asString(row.user_id, "profile.user_id"),
            accountNumber: row.account_number === null ? null : asString(row.account_number, "profile.account_number"),
            displayName: row.display_name == null ? null : asString(row.display_name, "profile.display_name"),
            version: asInteger(row.version, "profile.version"),
          }),
        };
      } catch {
        return memberProfileError("unexpected");
      }
    },

    async save(profile) {
      const snapshot = profile.toSnapshot();
      const { data, error } = await client.rpc("save_my_member_profile_with_display_name", {
        p_account_number: snapshot.accountNumber ?? undefined,
        p_display_name: snapshot.displayName ?? undefined,
        p_expected_version: snapshot.version,
      });
      if (error) {
        return fromDbError(error);
      }
      return data ? { data: "saved" } : { data: "conflict" };
    },

    async accountNumbers(groupId, userIds) {
      const { data, error } = await client.rpc("get_group_member_account_numbers", {
        p_group_id: groupId,
        p_user_ids: userIds,
      });
      if (error) {
        return fromDbError(error);
      }
      try {
        if (!Array.isArray(data)) {
          throw new TypeError("account numbers: expected an array");
        }
        return {
          data: data.map((value) => {
            const row = asObject(value, "account_number");
            return {
              userId: asString(row.user_id, "account_number.user_id"),
              accountNumber: asString(row.account_number, "account_number.account_number"),
            };
          }),
        };
      } catch {
        return memberProfileError("unexpected");
      }
    },

    async displayNames(groupId, userIds) {
      const { data, error } = await client.rpc("get_group_member_display_names", {
        p_group_id: groupId,
        p_user_ids: userIds,
      });
      if (error) {
        return fromDbError(error);
      }
      try {
        if (!Array.isArray(data)) {
          throw new TypeError("display names: expected an array");
        }
        return {
          data: data.map((value) => {
            const row = asObject(value, "display_name");
            return {
              userId: asString(row.user_id, "display_name.user_id"),
              displayName: asString(row.display_name, "display_name.display_name"),
            };
          }),
        };
      } catch {
        return memberProfileError("unexpected");
      }
    },
  };
}

/**
 * The MemberProfileService for a request, persisting through the signed-in user's Supabase client.
 */
export function createMemberProfileService(client: SupabaseClient<Database>): MemberProfileService {
  return new MemberProfileService(createSupabaseMemberProfileRepository(client));
}

function fromDbError(error: PostgrestError): MemberProfileError {
  switch (error.code) {
    case "28000":
      return memberProfileError("not_authenticated");
    default:
      return memberProfileError("unexpected", { dbCode: error.code });
  }
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

function asInteger(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${field}: expected an integer`);
  }
  return value;
}
