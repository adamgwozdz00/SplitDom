import type { APIRoute } from "astro";
import { createGroupService } from "@/lib/groups";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const token = form.get("token");
  if (typeof token !== "string" || token === "") {
    return context.redirect("/dashboard");
  }
  const invitePage = `/invite/${encodeURIComponent(token)}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${invitePage}?error=unexpected`);
  }

  const result = await createGroupService(supabase).join({ token, userId: user.id });
  if ("error" in result) {
    return context.redirect(`${invitePage}?error=${result.error.code}`);
  }

  return context.redirect(`/groups/${encodeURIComponent(result.data.groupId)}`);
};
