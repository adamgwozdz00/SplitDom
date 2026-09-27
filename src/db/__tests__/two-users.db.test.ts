import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTwoUsers, type TwoUsers } from "@/db/__tests__/two-users.harness";

describe("two-user harness", () => {
  let users: TwoUsers;

  beforeAll(async () => {
    users = await createTwoUsers();
  });

  afterAll(async () => {
    await users.cleanup();
  });

  it("creates two distinct users", () => {
    expect(users.userA.id).not.toBe(users.userB.id);
    expect(users.userA.email).not.toBe(users.userB.email);
  });

  it("signs each client in as its own user", async () => {
    const a = await users.userA.client.auth.getUser();
    const b = await users.userB.client.auth.getUser();

    expect(a.data.user?.id).toBe(users.userA.id);
    expect(b.data.user?.id).toBe(users.userB.id);
  });

  it("gives the anonymous client no user", async () => {
    const { data } = await users.anon.auth.getUser();

    expect(data.user).toBeNull();
  });

  it("removes both users on cleanup", async () => {
    await users.cleanup();

    for (const { id } of [users.userA, users.userB]) {
      const { data, error } = await users.admin.auth.admin.getUserById(id);
      expect(error).not.toBeNull();
      expect(data.user).toBeNull();
    }
  });
});
