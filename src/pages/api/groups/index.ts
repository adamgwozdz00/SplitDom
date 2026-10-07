import type { APIRoute } from "astro";
import { createBillingPeriodService } from "@/lib/billing-periods";
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

  // Creating a group is two writes. If opening its period fails, the group page opens it on first visit.
  await createBillingPeriodService(supabase).openFor(result.data);

  return context.redirect(`/groups/${result.data.id}`);
};
