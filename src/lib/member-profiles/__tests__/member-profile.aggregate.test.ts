import { describe, expect, it } from "vitest";
import { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";

const VALID = "34109010140000000000000000";

describe("MemberProfile", () => {
  it("lets the owner set an account number", () => {
    const profile = MemberProfile.empty("u1");

    const result = profile.setAccountNumber("u1", VALID);

    expect(result).toEqual({ data: undefined });
    expect(profile.accountNumber?.digits).toBe(VALID);
  });

  it("refuses anyone but the owner to set or clear", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, displayName: null, version: 1 });

    const set = profile.setAccountNumber("u2", VALID);
    const clear = profile.clearAccountNumber("u2");

    expect("error" in set && set.error.code).toBe("not_owner");
    expect("error" in clear && clear.error.code).toBe("not_owner");
    expect(profile.accountNumber?.digits).toBe(VALID);
  });

  it("keeps the old number when the new one is invalid", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, displayName: null, version: 1 });

    const result = profile.setAccountNumber("u1", "123");

    expect("error" in result && result.error.code).toBe("invalid_account_number");
    expect(profile.accountNumber?.digits).toBe(VALID);
  });

  it("clears the number", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, displayName: null, version: 1 });

    profile.clearAccountNumber("u1");

    expect(profile.toSnapshot()).toEqual({ userId: "u1", accountNumber: null, displayName: null, version: 1 });
  });

  it("lets the owner set and clear a display name", () => {
    const profile = MemberProfile.empty("u1");

    const set = profile.setDisplayName("u1", "  Ania ");
    const name = profile.displayName?.value;
    const cleared = profile.clearDisplayName("u1");

    expect(set).toEqual({ data: undefined });
    expect(name).toBe("Ania");
    expect(cleared).toEqual({ data: undefined });
    expect(profile.displayName).toBeNull();
  });

  it("refuses anyone but the owner to set or clear the display name", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: null, displayName: "Ania", version: 1 });

    const set = profile.setDisplayName("u2", "Basia");
    const clear = profile.clearDisplayName("u2");

    expect("error" in set && set.error.code).toBe("not_owner");
    expect("error" in clear && clear.error.code).toBe("not_owner");
    expect(profile.displayName?.value).toBe("Ania");
  });

  it("keeps the old name when the new one is invalid", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: null, displayName: "Ania", version: 1 });

    const result = profile.setDisplayName("u1", "a".repeat(41));

    expect("error" in result && result.error.code).toBe("invalid_display_name");
    expect(profile.displayName?.value).toBe("Ania");
  });

  it("keeps the account number when the name changes", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, displayName: null, version: 1 });

    profile.setDisplayName("u1", "Ania");

    expect(profile.toSnapshot()).toEqual({ userId: "u1", accountNumber: VALID, displayName: "Ania", version: 1 });
  });
});
