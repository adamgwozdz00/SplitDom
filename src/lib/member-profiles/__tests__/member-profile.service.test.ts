import { describe, expect, it } from "vitest";
import { FakeMemberProfileRepository } from "@/lib/member-profiles/__tests__/member-profiles.harness";
import { MemberProfileService } from "@/lib/member-profiles/member-profile.service";

const VALID = "34109010140000000000000000";
const OTHER = "21114020040000000000000000";

function setup() {
  const repository = new FakeMemberProfileRepository();
  return { repository, service: new MemberProfileService(repository) };
}

describe("MemberProfileService", () => {
  describe("saveAccountNumber", () => {
    it("stores a valid number and bumps the version", async () => {
      const { repository, service } = setup();

      const result = await service.saveAccountNumber({ userId: "u1", raw: "34 1090 1014 0000 0000 0000 0000" });

      expect(result).toEqual({ data: undefined });
      expect(repository.stored("u1")).toEqual({ userId: "u1", accountNumber: VALID, displayName: null, version: 1 });
    });

    it("stores nothing for an invalid number", async () => {
      const { repository, service } = setup();

      const result = await service.saveAccountNumber({ userId: "u1", raw: "12345" });

      expect("error" in result && result.error.code).toBe("invalid_account_number");
      expect(repository.saveCalls).toHaveLength(0);
    });

    it("clears the number on blank input", async () => {
      const { repository, service } = setup();
      repository.put({ userId: "u1", accountNumber: VALID, displayName: null, version: 3 });

      const result = await service.saveAccountNumber({ userId: "u1", raw: "   " });

      expect(result).toEqual({ data: undefined });
      expect(repository.stored("u1")).toEqual({ userId: "u1", accountNumber: null, displayName: null, version: 4 });
    });

    it("retries once on a lost race and then succeeds", async () => {
      const { repository, service } = setup();
      repository.saveConflicts = 1;

      const result = await service.saveAccountNumber({ userId: "u1", raw: VALID });

      expect(result).toEqual({ data: undefined });
      expect(repository.saveCalls).toHaveLength(2);
    });

    it("reports profile_changed after a second lost race", async () => {
      const { repository, service } = setup();
      repository.saveConflicts = 2;

      const result = await service.saveAccountNumber({ userId: "u1", raw: VALID });

      expect("error" in result && result.error.code).toBe("profile_changed");
      expect(repository.stored("u1")).toBeUndefined();
    });

    it("passes a repository failure through", async () => {
      const { repository, service } = setup();
      repository.failure = { error: { code: "unexpected", message: "x", context: {} } };

      const result = await service.saveAccountNumber({ userId: "u1", raw: VALID });

      expect("error" in result && result.error.code).toBe("unexpected");
    });
  });

  describe("accountNumbersFor", () => {
    it("maps the visible numbers by user id", async () => {
      const { repository, service } = setup();
      repository.visibleNumbers = [
        { userId: "u2", accountNumber: OTHER },
        { userId: "u3", accountNumber: VALID },
      ];

      const result = await service.accountNumbersFor({ groupId: "g1", userIds: ["u2"] });

      expect("data" in result && result.data.get("u2")?.digits).toBe(OTHER);
      expect("data" in result && result.data.has("u3")).toBe(false);
    });

    it("does not ask the repository when no user is requested", async () => {
      const { repository, service } = setup();

      const result = await service.accountNumbersFor({ groupId: "g1", userIds: [] });

      expect("data" in result && result.data.size).toBe(0);
      expect(repository.accountNumberCalls).toHaveLength(0);
    });
  });

  describe("saveDisplayName", () => {
    it("stores the name, keeps the account number and bumps the version", async () => {
      const { repository, service } = setup();
      repository.put({ userId: "u1", accountNumber: VALID, displayName: null, version: 2 });

      const result = await service.saveDisplayName({ userId: "u1", raw: " Ania " });

      expect(result).toEqual({ data: undefined });
      expect(repository.stored("u1")).toEqual({ userId: "u1", accountNumber: VALID, displayName: "Ania", version: 3 });
    });

    it("stores nothing for an invalid name", async () => {
      const { repository, service } = setup();

      const result = await service.saveDisplayName({ userId: "u1", raw: "a".repeat(41) });

      expect("error" in result && result.error.code).toBe("invalid_display_name");
      expect(repository.saveCalls).toHaveLength(0);
    });

    it("clears the name on blank input and keeps the account number", async () => {
      const { repository, service } = setup();
      repository.put({ userId: "u1", accountNumber: VALID, displayName: "Ania", version: 1 });

      const result = await service.saveDisplayName({ userId: "u1", raw: "  " });

      expect(result).toEqual({ data: undefined });
      expect(repository.stored("u1")).toEqual({ userId: "u1", accountNumber: VALID, displayName: null, version: 2 });
    });

    it("retries once on a lost race and then reports profile_changed", async () => {
      const { repository, service } = setup();
      repository.saveConflicts = 1;
      const retried = await service.saveDisplayName({ userId: "u1", raw: "Ania" });
      repository.saveConflicts = 2;
      const lost = await service.saveDisplayName({ userId: "u2", raw: "Basia" });

      expect(retried).toEqual({ data: undefined });
      expect("error" in lost && lost.error.code).toBe("profile_changed");
    });
  });

  describe("displayNamesFor", () => {
    it("maps the visible names by user id", async () => {
      const { repository, service } = setup();
      repository.visibleNames = [
        { userId: "u2", displayName: "Basia" },
        { userId: "u3", displayName: "Celina" },
      ];

      const result = await service.displayNamesFor({ groupId: "g1", userIds: ["u2"] });

      expect("data" in result && result.data.get("u2")?.value).toBe("Basia");
      expect("data" in result && result.data.has("u3")).toBe(false);
    });

    it("does not ask the repository when no user is requested", async () => {
      const { repository, service } = setup();

      const result = await service.displayNamesFor({ groupId: "g1", userIds: [] });

      expect("data" in result && result.data.size).toBe(0);
      expect(repository.displayNameCalls).toHaveLength(0);
    });
  });
});
