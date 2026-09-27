import pg from "pg";
import { inject } from "vitest";

// Direct Postgres access for catalog-level checks that PostgREST cannot express. Connects as the
// local superuser, so it bypasses RLS — use it to inspect the schema, never to assert isolation.
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("dbUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
