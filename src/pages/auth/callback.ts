import type { APIRoute } from "astro";
import { takePendingInvitePath } from "@/lib/invites";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const code = context.url.searchParams.get("code");
  const errorCode = context.url.searchParams.get("error");
  const errorDescription = context.url.searchParams.get("error_description");

  if (errorDescription) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(errorDescription)}`);
  }

  // Google sends only `error=access_denied` when the user cancels consent, so the description arrives empty.
  if (errorCode) {
    const message = errorCode === "access_denied" ? "Sign-in was cancelled" : errorCode;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  if (!code) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect(takePendingInvitePath(context.cookies) ?? "/dashboard");
};
