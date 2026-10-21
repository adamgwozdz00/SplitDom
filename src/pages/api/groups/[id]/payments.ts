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

  const form = await context.request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  // The signed-in user is always the sender: nobody records a payment on someone else's behalf.
  const sent = await createBillingPeriodService(supabase).sendPayment({
    group: group.data,
    senderId: user.id,
    recipientId: field("recipientId"),
    paymentId: field("paymentId"),
    amount: field("amount"),
  });
  if ("error" in sent) {
    return context.redirect(`${groupPage}?paymentError=${sent.error.code}`);
  }

  return context.redirect(groupPage);
};
