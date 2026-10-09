// Seed E2E test — the pattern every generated test copies (see context/foundation/test-stack.md, ## E2E).
// Protects test-plan.md risk #2 (anonymous part): a signed-out visitor never sees a group page.
import { test, expect } from "@playwright/test";

// The risk is the signed-out path, so this file opts out of the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visitor opening a group page is sent to sign-in", async ({ page }) => {
  // Any id will do: the guard must refuse before it looks the group up, so the answer
  // never reveals whether a group exists.
  const groupId = crypto.randomUUID();

  await page.goto(`/groups/${groupId}`);

  await expect(page).toHaveURL("/auth/signin");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add expense" })).toBeHidden();

  // Nothing to clean up: the test creates no data.
});
