import type { APIRoute } from "astro";
import { createBillingPeriodService } from "@/lib/billing-periods";
import { createGroupService } from "@/lib/groups";
import { createClient } from "@/lib/supabase";

// Mistakes in the form send the author back to the edit page; anything else (the expense is gone, not
// theirs, or its period closed) leaves nothing to edit, so it goes to the group page.
const FORM_ERRORS = new Set(["invalid_expense_title", "invalid_amount", "invalid_purchase_date"]);

export const POST: APIRoute = async (context) => {
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const groupId = context.params.id ?? "";
  const expenseId = context.params.expenseId ?? "";
  const groupPage = `/groups/${encodeURIComponent(groupId)}`;
  const editPage = `${groupPage}/expenses/${encodeURIComponent(expenseId)}/edit`;

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
  const edited = await createBillingPeriodService(supabase).editExpense({
    group: group.data,
    userId: user.id,
    expenseId,
    title: field("title"),
    amount: field("amount"),
    purchasedOn: field("purchasedOn"),
  });
  if ("error" in edited) {
    const target = FORM_ERRORS.has(edited.error.code) ? editPage : groupPage;
    return context.redirect(`${target}?expenseError=${edited.error.code}`);
  }

  return context.redirect(groupPage);
};
