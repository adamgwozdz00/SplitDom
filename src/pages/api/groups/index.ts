import type { APIRoute } from "astro";
import { createGroupService } from "@/lib/groups";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  // A request without a form body (e.g. JSON) is treated like a missing name, not a 500.
  const form = await context.request.formData().catch(() => null);
  const name = form?.get("name");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/dashboard?error=unexpected");
  }
  const result = await createGroupService(supabase).create({
    name: typeof name === "string" ? name : "",
    hostId: user.id,
  });

  if ("error" in result) {
    return context.redirect(`/dashboard?error=${result.error.code}`);
  }

  return context.redirect(`/groups/${result.data.groupId}`);
};
