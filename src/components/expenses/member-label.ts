import type { GroupMember } from "@/lib/groups";

/** How a member is shown to `viewerId`: "You", their email, or "Member" when the email is unknown. */
export function memberLabel(members: readonly GroupMember[], userId: string, viewerId: string): string {
  if (userId === viewerId) {
    return "You";
  }
  return members.find((member) => member.userId === userId)?.email ?? "Member";
}
