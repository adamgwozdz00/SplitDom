import { describe, expect, it } from "vitest";
import { GroupName } from "@/lib/groups/group-name.value";

describe("GroupName", () => {
  it("trims surrounding whitespace", () => {
    const result = GroupName.create("  Mokotów  ");

    expect(result).toEqual({ data: expect.objectContaining({ value: "Mokotów" }) as unknown });
  });

  it.each(["", "   "])("rejects a blank name %j", (raw) => {
    const result = GroupName.create(raw);

    expect(result).toEqual({
      error: { code: "invalid_group_name", message: expect.any(String) as unknown, context: { length: 0 } },
    });
  });

  it("accepts 60 characters", () => {
    const result = GroupName.create("a".repeat(60));

    expect("data" in result && result.data.value).toBe("a".repeat(60));
  });

  it("rejects 61 characters", () => {
    const result = GroupName.create("a".repeat(61));

    expect("error" in result && result.error).toMatchObject({ code: "invalid_group_name", context: { length: 61 } });
  });

  it("counts characters, not UTF-16 units", () => {
    const result = GroupName.create("🏠".repeat(60));

    expect("data" in result).toBe(true);
  });
});
