// risk: test-plan.md #3 — a duplicated expense corrupts the monthly settlement, so its author must be able to remove it
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";

test.describe("risk #3: the author removes a duplicated expense", () => {
  test("deleting one of two identical expenses leaves exactly one", async ({ page }) => {
    const runId = Date.now();
    const groupName = `E2E delete duplicate ${runId}`;
    const expenseTitle = `Rent ${runId}`;
    test.info().annotations.push({ type: "test-data", description: groupName });

    // A fresh group, so the test owns its open period and starts with no expenses.
    await page.goto("/dashboard");
    await page.getByRole("textbox", { name: "Group name" }).fill(groupName);
    await page.getByRole("button", { name: "Create group" }).click();
    await page.waitForURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("heading", { name: groupName, level: 1 })).toBeVisible();

    // Add the same expense twice, as a retried POST would.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole("textbox", { name: "Title" }).fill(expenseTitle);
      await page.getByRole("textbox", { name: "Amount" }).fill("12,34");
      await page.getByRole("button", { name: "Add expense" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: expenseTitle })).toHaveCount(attempt + 1);
    }

    // Open the edit page of one of them and delete it through the confirmation.
    await page
      .getByRole("listitem")
      .filter({ hasText: expenseTitle })
      .first()
      .getByRole("link", { name: "Edit" })
      .click();
    await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();
    await page.getByText("Delete expense", { exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete this expense" }).click();
    await page.waitForURL(/\/groups\/[^/]+$/);

    // One expense is left, also after a fresh load from the server.
    const remaining = page.getByRole("listitem").filter({ hasText: expenseTitle });
    await expect(remaining).toHaveCount(1);
    await page.reload();
    await expect(remaining).toHaveCount(1);
    await expect(remaining).toContainText("12,34 zł");

    // Cleanup: delete the other one too, so the group is left without expenses. The app cannot delete groups
    // yet, so the uniquely named group stays in the local database until `npm run db:reset`.
    await remaining.getByRole("link", { name: "Edit" }).click();
    await page.getByText("Delete expense", { exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete this expense" }).click();
    await page.waitForURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("listitem").filter({ hasText: expenseTitle })).toHaveCount(0);
  });
});
