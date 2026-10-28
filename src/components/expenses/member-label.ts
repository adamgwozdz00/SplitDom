import type { GroupMember } from "@/lib/groups";

/** How a member is shown to `viewerId`: "Ty", their email, or "Członek grupy" when the email is unknown. */
export function memberLabel(members: readonly GroupMember[], userId: string, viewerId: string): string {
  if (userId === viewerId) {
    return "Ty";
  }
  return members.find((member) => member.userId === userId)?.email ?? "Członek grupy";
}
