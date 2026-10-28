import type { GroupMember } from "@/lib/groups";
import type { DisplayNames } from "@/lib/member-profiles";

/**
 * How a member is shown to `viewerId`: "Ty", their display name, their email, or "Członek grupy" when neither is
 * known.
 */
export function memberLabel(
  members: readonly GroupMember[],
  userId: string,
  viewerId: string,
  displayNames: DisplayNames,
): string {
  if (userId === viewerId) {
    return "Ty";
  }
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) {
    return "Członek grupy";
  }
  return displayNames.get(userId)?.value ?? member.email ?? "Członek grupy";
}
