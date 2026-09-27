import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    dbUrl: string;
  }
}

const NOT_RUNNING = "Local Supabase is not running — start it with: npx supabase start";

// `supabase status -o env` output key for each value handed to the tests.
const STATUS_KEYS = {
  supabaseUrl: "API_URL",
  anonKey: "ANON_KEY",
  serviceRoleKey: "SERVICE_ROLE_KEY",
  dbUrl: "DB_URL",
} as const;

// The CLI mixes warnings into the same output, so only `KEY="value"` lines are kept.
function parseStatusEnv(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match) {
      values.set(match[1], match[2]);
    }
  }
  return values;
}

// Runs once in the main process; values reach test workers through provide/inject, not process.env.
export default function setup(project: TestProject) {
  let output: string;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    throw new Error(NOT_RUNNING, { cause });
  }

  const status = parseStatusEnv(output);
  for (const [name, statusKey] of Object.entries(STATUS_KEYS) as [keyof typeof STATUS_KEYS, string][]) {
    const value = status.get(statusKey);
    if (!value) {
      throw new Error(`${NOT_RUNNING} (missing ${statusKey} in \`supabase status -o env\`)`);
    }
    project.provide(name, value);
  }
}
