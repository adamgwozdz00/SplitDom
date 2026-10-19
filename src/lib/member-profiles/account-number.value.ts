import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import type { Result } from "@/lib/member-profiles/types";

// 26 digits, optionally prefixed with PL, with spaces or dashes between the digits.
const NRB_INPUT = /^(?:PL)?[\d\s-]+$/i;
const NRB_LENGTH = 26;
// "PL" as digits (P=25, L=21) followed by 00, appended after moving the first four characters to the end.
const PL_COUNTRY_DIGITS = "2521";

/** A Polish bank account number (NRB), stored as its 26 digits after the mod-97 checksum has passed. */
export class AccountNumber {
  private constructor(readonly digits: string) {}

  static parse(raw: string): Result<AccountNumber> {
    const trimmed = raw.trim();
    if (!NRB_INPUT.test(trimmed)) {
      return memberProfileError("invalid_account_number");
    }
    const digits = trimmed.replace(/^PL/i, "").replace(/[\s-]/g, "");
    if (!/^\d+$/.test(digits) || digits.length !== NRB_LENGTH || !checksumHolds(digits)) {
      return memberProfileError("invalid_account_number");
    }
    return { data: new AccountNumber(digits) };
  }

  /** Rebuilds a number that was already accepted and stored; the creation rule is not applied again. */
  static fromStored(digits: string): AccountNumber {
    if (!/^\d{26}$/.test(digits)) {
      throw new Error("AccountNumber.fromStored: expected 26 digits");
    }
    return new AccountNumber(digits);
  }

  /** The number grouped for reading: `61 1090 1014 0000 0712 1981 2874`. */
  label(): string {
    const groups = this.digits.slice(2).match(/.{4}/g) ?? [];
    return [this.digits.slice(0, 2), ...groups].join(" ");
  }
}

function checksumHolds(digits: string): boolean {
  const rearranged = digits.slice(2) + PL_COUNTRY_DIGITS + digits.slice(0, 2);
  let remainder = 0;
  for (const char of rearranged) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  return remainder === 1;
}
