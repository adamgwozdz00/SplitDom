import type { APIRoute } from "astro";
import { createBillingPeriodService } from "@/lib/billing-periods";
import { createGroupService } from "@/lib/groups";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const groupId = context.params.id ?? "";
  const groupPage = `/groups/${encodeURIComponent(groupId)}`;

  const form = await context.request.formData().catch(() => null);
  if (!form) {
    return context.redirect(`${groupPage}?closeError=unexpected`);
  }
  const periodValue = form.get("periodId");
  const periodId = typeof periodValue === "string" ? periodValue : "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${groupPage}?closeError=unexpected`);
  }

  const group = await createGroupService(supabase).getForMember({ groupId, userId: user.id });
  if ("error" in group) {
    return context.redirect(`${groupPage}?closeError=${group.error.code}`);
  }

  // A repeated close of the same period already succeeds in the service, so every error here is shown.
  const closed = await createBillingPeriodService(supabase).closePeriod({
    group: group.data,
    userId: user.id,
    periodId,
  });
  if ("error" in closed) {
    return context.redirect(`${groupPage}?closeError=${closed.error.code}`);
  }

  return context.redirect(groupPage);
};
