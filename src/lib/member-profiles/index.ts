// Public API of the member-profiles domain module. Never import `@/lib/supabase` here: it pulls in
// `astro:env/server`, which plain Vitest cannot resolve.
export type * from "@/lib/member-profiles/types";
export { AccountNumber } from "@/lib/member-profiles/account-number.value";
export { DisplayName } from "@/lib/member-profiles/display-name.value";
export { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";
export { memberProfileErrorMessage } from "@/lib/member-profiles/member-profile-error.messages";
export { MemberProfileService } from "@/lib/member-profiles/member-profile.service";
export {
  createMemberProfileService,
  createSupabaseMemberProfileRepository,
} from "@/lib/member-profiles/member-profile.repository";
