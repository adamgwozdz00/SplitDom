import type { GroupMember } from "@/lib/groups";
import type { DisplayNames } from "@/lib/member-profiles";

/**
 * How a member is shown to `viewerId`: "You", their display name, their email, or "Member" when neither is
 * known.
 */
export function memberLabel(
  members: readonly GroupMember[],
  userId: string,
  viewerId: string,
  displayNames: DisplayNames,
): string {
  if (userId === viewerId) {
    return "You";
  }
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) {
    return "Member";
  }
  return displayNames.get(userId)?.value ?? member.email ?? "Member";
}
