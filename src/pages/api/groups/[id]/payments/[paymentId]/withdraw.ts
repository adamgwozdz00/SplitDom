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

  const withdrawn = await createBillingPeriodService(supabase).withdrawPayment({
    group: group.data,
    userId: user.id,
    paymentId: context.params.paymentId ?? "",
  });
  // A payment that is already gone (a repeated submit) is the outcome the sender asked for, not an error.
  if ("error" in withdrawn && withdrawn.error.code !== "payment_not_found") {
    return context.redirect(`${groupPage}?paymentError=${withdrawn.error.code}`);
  }

  return context.redirect(groupPage);
};
