import type pg from "pg";
import { describe, expect, it } from "vitest";
import { withDb } from "@/db/__tests__/pg.harness";

// Ordinary and partitioned tables in `public` with row-level security disabled.
const TABLES_WITHOUT_RLS = `
  select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
  order by c.relname
`;

async function findTablesWithoutRls(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(TABLES_WITHOUT_RLS);
  return rows.map((row) => row.table_name);
}

describe("RLS guard", () => {
  it("every table in public has row-level security enabled", async () => {
    const tables = await withDb(findTablesWithoutRls);

    expect(
      tables,
      `Tables in public without RLS: ${tables.join(", ")}. Add "alter table … enable row level security" to their migration.`,
    ).toEqual([]);
  });

  it("reports a table without RLS and stops reporting it once RLS is enabled (self-test)", async () => {
    await withDb(async (client) => {
      await client.query("begin");
      try {
        await client.query("create table public.rls_guard_self_test (id int)");
        expect(await findTablesWithoutRls(client)).toContain("rls_guard_self_test");

        await client.query("alter table public.rls_guard_self_test enable row level security");
        expect(await findTablesWithoutRls(client)).not.toContain("rls_guard_self_test");
      } finally {
        await client.query("rollback");
      }
    });
  });

  it("anon has no usage on schema private", async () => {
    const { rows } = await withDb((client) =>
      client.query<{ usage: boolean }>("select has_schema_privilege('anon', 'private', 'USAGE') as usage"),
    );

    expect(rows[0]?.usage).toBe(false);
  });
});
