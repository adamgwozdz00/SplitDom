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
    return context.redirect(`${groupPage}?expenseError=unexpected`);
  }

  const group = await createGroupService(supabase).getForMember({ groupId, userId: user.id });
  if ("error" in group) {
    return context.redirect(`${groupPage}?expenseError=${group.error.code}`);
  }

  const deleted = await createBillingPeriodService(supabase).deleteExpense({
    group: group.data,
    userId: user.id,
    expenseId: context.params.expenseId ?? "",
  });
  // An expense that is already gone (a repeated submit) is the outcome the author asked for, not an error.
  if ("error" in deleted && deleted.error.code !== "expense_not_found") {
    return context.redirect(`${groupPage}?expenseError=${deleted.error.code}`);
  }

  return context.redirect(groupPage);
};
