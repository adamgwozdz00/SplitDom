// Public API of the groups domain module. Never import `@/lib/supabase` here: it pulls in
// `astro:env/server`, which plain Vitest cannot resolve.
export type * from "@/lib/groups/types";
export { Group } from "@/lib/groups/group.aggregate";
export { GROUPS_LOAD_FAILED_MESSAGE, groupErrorMessage } from "@/lib/groups/group-error.messages";
export { GroupName } from "@/lib/groups/group-name.value";
export { createGroupService, createSupabaseGroupRepository } from "@/lib/groups/group.repository";
export { GroupService } from "@/lib/groups/group.service";
export { InviteToken } from "@/lib/groups/invite-token.value";
export {
  hasPendingInvite,
  rememberPendingInvite,
  stashNewInvite,
  takeNewInvite,
  takePendingInvitePath,
} from "@/lib/groups/invite.cookies";
