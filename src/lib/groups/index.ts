// Public API of the groups domain module. Never import `@/lib/supabase` here: it pulls in
// `astro:env/server`, which plain Vitest cannot resolve.
export type * from "@/lib/groups/types";
export { BillingMonth } from "@/lib/groups/billing-month.value";
export { Group } from "@/lib/groups/group.aggregate";
export { groupErrorMessage } from "@/lib/groups/group-error.messages";
export { GroupName } from "@/lib/groups/group-name.value";
export { createSupabaseGroupRepository } from "@/lib/groups/group.repository";
export { GroupService } from "@/lib/groups/group.service";
