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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${groupPage}?paymentError=unexpected`);
  }

  const group = await createGroupService(supabase).getForMember({ groupId, userId: user.id });
  if ("error" in group) {
    return context.redirect(`${groupPage}?paymentError=${group.error.code}`);
  }

  // A repeated decision already succeeds in the aggregate, so every error here is shown.
  const confirmed = await createBillingPeriodService(supabase).confirmPayment({
    group: group.data,
    userId: user.id,
    paymentId: context.params.paymentId ?? "",
  });
  if ("error" in confirmed) {
    return context.redirect(`${groupPage}?paymentError=${confirmed.error.code}`);
  }

  return context.redirect(groupPage);
};
