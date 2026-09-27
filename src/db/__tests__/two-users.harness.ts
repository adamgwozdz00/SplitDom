import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Database } from "@/db";

export type DbClient = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  client: DbClient;
}

export interface TwoUsers {
  userA: TestUser;
  userB: TestUser;
  /** Unauthenticated client (anon key, no session). */
  anon: DbClient;
  /** Service-role client: bypasses RLS. For fixtures only — never to assert what a user can see. */
  admin: DbClient;
  /** Deletes both users. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

function newClient(key: string): DbClient {
  return createClient<Database>(inject("supabaseUrl"), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createSignedInUser(admin: DbClient, label: string): Promise<TestUser> {
  const email = `isolation-${label}-${randomUUID()}@example.com`;
  const password = randomUUID();

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    throw error;
  }

  const client = newClient(inject("anonKey"));
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw signInError;
  }

  return { id: data.user.id, email, client };
}

/**
 * Two independent signed-in users (A and B) plus anonymous and admin clients, for proving that
 * one user cannot read or change another group's data. Call `cleanup()` in `afterAll`.
 */
export async function createTwoUsers(): Promise<TwoUsers> {
  const admin = newClient(inject("serviceRoleKey"));
  const createdIds: string[] = [];

  const cleanup = async () => {
    while (createdIds.length > 0) {
      const id = createdIds[0];
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        throw error;
      }
      createdIds.shift();
    }
  };

  try {
    const userA = await createSignedInUser(admin, "a");
    createdIds.push(userA.id);
    const userB = await createSignedInUser(admin, "b");
    createdIds.push(userB.id);

    return { userA, userB, anon: newClient(inject("anonKey")), admin, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
