import type { APIRoute } from "astro";
import { createGroupService, stashNewInvite } from "@/lib/groups";
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

  const invite = await createGroupService(supabase).invite({ groupId, userId: user.id });
  if ("error" in invite) {
    return context.redirect(`${groupPage}?error=${invite.error.code}`);
  }

  stashNewInvite(context.cookies, context.url, groupId, invite.data.token);
  return context.redirect(groupPage);
};
