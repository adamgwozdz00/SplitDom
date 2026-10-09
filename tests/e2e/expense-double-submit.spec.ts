// risk: test-plan.md #3 — a duplicated expense (double click or double submit) corrupts the monthly settlement
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";

test.describe("risk #3: double submit stores one expense", () => {
  test("tapping Add expense again while the first submit is in flight stores exactly one expense", async ({ page }) => {
    const runId = Date.now();
    const groupName = `E2E double submit ${runId}`;
    const expenseTitle = `Groceries ${runId}`;
    test.info().annotations.push({ type: "test-data", description: groupName });

    // Create a fresh group, so the test owns its open period and starts with no expenses.
    await page.goto("/dashboard");
    await page.getByRole("textbox", { name: "Group name" }).fill(groupName);
    await page.getByRole("button", { name: "Create group" }).click();
    await page.waitForURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("heading", { name: groupName, level: 1 })).toBeVisible();

    // Make the first submit slow, like a phone on a bad connection: the request reaches the
    // server and the expense is stored, but the browser waits for the answer until the second
    // tap. Nothing is mocked; every request still goes to the real app.
    let firstSent!: () => void;
    const firstRequestStored = new Promise<void>((resolve) => (firstSent = resolve));
    let release!: () => void;
    const secondTapDone = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    await page.route("**/api/groups/*/expenses", async (route) => {
      if (held) return route.continue();
      held = true;
      // The browser follows the redirect itself, as it would without the route; a followed
      // redirect would leave the page on the POST, and a reload would submit it again.
      const response = await route.fetch({ maxRedirects: 0 });
      firstSent();
      await secondTapDone;
      // Without the guard the second submit has already replaced this navigation in the browser,
      // so its answer has nowhere to go; the server stored the expense either way.
      await route.fulfill({ response }).catch(() => undefined);
    });

    // Fill the expense form and submit it.
    await page.getByRole("textbox", { name: "Title" }).fill(expenseTitle);
    await page.getByRole("textbox", { name: "Amount" }).fill("12,34");
    const addExpense = page.getByRole("button", { name: "Add expense" });
    const button = await addExpense.boundingBox();
    if (!button) throw new Error("Add expense button is not rendered");
    // Not awaited yet: the click waits for the navigation it starts, which waits for the second tap.
    const firstTap = addExpense.click();
    await firstRequestStored;

    // Tap the button again while the first submit is in flight. A raw mouse click, because locator
    // actions wait for the pending navigation; like a real tap, it lands whether the button is
    // disabled or not.
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    release();
    await firstTap;

    // The period lists the expense once, also after a fresh load from the server.
    const expense = page.getByRole("listitem").filter({ hasText: expenseTitle });
    await expect(expense).toHaveCount(1);
    await page.unroute("**/api/groups/*/expenses");
    await page.reload();
    await expect(expense).toHaveCount(1);
    await expect(expense).toContainText("12,34 zł");

    // No cleanup: the app cannot delete groups or expenses yet (S-05), so each run leaves its
    // uniquely named group in the local database until `npm run db:reset`.
  });
});
