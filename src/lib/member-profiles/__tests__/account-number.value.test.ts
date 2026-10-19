import { describe, expect, it } from "vitest";
import { AccountNumber } from "@/lib/member-profiles/account-number.value";

const VALID = "34109010140000000000000000";

describe("AccountNumber", () => {
  it("accepts 26 digits with a valid checksum", () => {
    const result = AccountNumber.parse(VALID);

    expect("data" in result && result.data.digits).toBe(VALID);
  });

  it("ignores spaces, dashes and a PL prefix", () => {
    const result = AccountNumber.parse(" pl34 1090 1014-0000 0000 0000 0000 ");

    expect("data" in result && result.data.digits).toBe(VALID);
  });

  it("rejects a number with one changed digit", () => {
    const result = AccountNumber.parse("34109010140000000000000001");

    expect("error" in result && result.error.code).toBe("invalid_account_number");
  });

  it.each([
    "",
    "3410901014000000000000000",
    "341090101400000000000000000",
    "3410901014000000000000000A",
    "DE34109010140000000000000000",
  ])("rejects %j", (raw) => {
    const result = AccountNumber.parse(raw);

    expect("error" in result && result.error.code).toBe("invalid_account_number");
  });

  it("groups the digits for reading", () => {
    expect(AccountNumber.fromStored(VALID).label()).toBe("34 1090 1014 0000 0000 0000 0000");
  });

  it("refuses to restore anything but 26 digits", () => {
    expect(() => AccountNumber.fromStored("123")).toThrow();
  });
});
