import type { APIRoute } from "astro";
import { createGroupService } from "@/lib/groups";
import { createInviteService, stashNewInvite } from "@/lib/invites";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const groupId = context.params.id ?? "";
  const groupPage = `/groups/${encodeURIComponent(groupId)}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${groupPage}?error=unexpected`);
  }

  const group = await createGroupService(supabase).getForMember({ groupId, userId: user.id });
  if ("error" in group) {
    return context.redirect(`${groupPage}?error=${group.error.code}`);
  }

  const invite = await createInviteService(supabase).create({ group: group.data, createdBy: user.id });
  if ("error" in invite) {
    return context.redirect(`${groupPage}?error=${invite.error.code}`);
  }

  stashNewInvite(context.cookies, context.url, groupId, invite.data.token);
  return context.redirect(groupPage);
};
