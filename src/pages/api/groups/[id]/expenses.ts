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
    return context.redirect(`${groupPage}?expenseError=unexpected`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${groupPage}?expenseError=unexpected`);
  }

  const group = await createGroupService(supabase).getForMember({ groupId, userId: user.id });
  if ("error" in group) {
    return context.redirect(`${groupPage}?expenseError=${group.error.code}`);
  }

  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const added = await createBillingPeriodService(supabase).addExpense({
    group: group.data,
    payerId: user.id,
    title: field("title"),
    amount: field("amount"),
    purchasedOn: field("purchasedOn"),
  });
  if ("error" in added) {
    return context.redirect(`${groupPage}?expenseError=${added.error.code}`);
  }

  return context.redirect(groupPage);
};
