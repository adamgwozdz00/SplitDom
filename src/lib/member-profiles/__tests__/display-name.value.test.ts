import { describe, expect, it } from "vitest";
import { DisplayName } from "@/lib/member-profiles/display-name.value";

function valueOf(raw: string): string | undefined {
  const parsed = DisplayName.parse(raw);
  return "data" in parsed ? parsed.data.value : undefined;
}

describe("DisplayName", () => {
  it("trims surrounding whitespace", () => {
    expect(valueOf("  Ania  ")).toBe("Ania");
  });

  it("accepts one character and forty characters", () => {
    expect(valueOf("A")).toBe("A");
    expect(valueOf("a".repeat(40))).toBe("a".repeat(40));
  });

  it("counts Polish letters and emoji as one character each", () => {
    expect(valueOf("ą".repeat(40))).toBe("ą".repeat(40));
    expect(valueOf("😀".repeat(40))).toBe("😀".repeat(40));
  });

  it("rejects forty-one characters", () => {
    const parsed = DisplayName.parse("a".repeat(41));

    expect("error" in parsed && parsed.error.code).toBe("invalid_display_name");
  });

  it("rejects an empty or blank name", () => {
    expect("error" in DisplayName.parse("")).toBe(true);
    expect("error" in DisplayName.parse("   ")).toBe(true);
  });

  it("rejects a name with a control character", () => {
    expect("error" in DisplayName.parse("Ania\nKowalska")).toBe(true);
    expect("error" in DisplayName.parse("Ania\tK")).toBe(true);
  });
});
