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
    return context.redirect("/profile?error=unexpected");
  }

  const raw = form.get("accountNumber");
  const saved = await createMemberProfileService(supabase).saveAccountNumber({
    userId: user.id,
    raw: typeof raw === "string" ? raw : "",
  });
  if ("error" in saved) {
    return context.redirect(`/profile?error=${saved.error.code}`);
  }

  return context.redirect("/profile?saved=1");
};
