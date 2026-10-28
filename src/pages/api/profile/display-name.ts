import type { APIRoute } from "astro";
import { createMemberProfileService } from "@/lib/member-profiles";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData().catch(() => null);
  const supabase = createClient(context.request.headers, context.cookies);
  if (!form || !supabase) {
    return context.redirect("/profile?nameError=unexpected");
  }

  const raw = form.get("displayName");
  const saved = await createMemberProfileService(supabase).saveDisplayName({
    userId: user.id,
    raw: typeof raw === "string" ? raw : "",
  });
  if ("error" in saved) {
    return context.redirect(`/profile?nameError=${saved.error.code}`);
  }

  return context.redirect("/profile?saved=name");
};
