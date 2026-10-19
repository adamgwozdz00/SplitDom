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
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, version: 1 });

    const set = profile.setAccountNumber("u2", VALID);
    const clear = profile.clearAccountNumber("u2");

    expect("error" in set && set.error.code).toBe("not_owner");
    expect("error" in clear && clear.error.code).toBe("not_owner");
    expect(profile.accountNumber?.digits).toBe(VALID);
  });

  it("keeps the old number when the new one is invalid", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, version: 1 });

    const result = profile.setAccountNumber("u1", "123");

    expect("error" in result && result.error.code).toBe("invalid_account_number");
    expect(profile.accountNumber?.digits).toBe(VALID);
  });

  it("clears the number", () => {
    const profile = MemberProfile.restore({ userId: "u1", accountNumber: VALID, version: 1 });

    profile.clearAccountNumber("u1");

    expect(profile.toSnapshot()).toEqual({ userId: "u1", accountNumber: null, version: 1 });
  });
});
