// Pure planning logic for scripts/db-migrate.ts (unit-tested in scripts/tests/db-migrate.test.ts).
import { readdirSync } from "node:fs";

export interface MigrationFile {
  /** Supabase CLI version: the 14-digit timestamp prefix of the file name. */
  version: string;
  /** Rest of the file name without extension, e.g. "core_schema". */
  name: string;
  fileName: string;
}

const MIGRATION_FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** Migration files in apply order (filename order). Files that do not match the CLI naming are rejected. */
export function listMigrationFiles(dir: string, readDir: (path: string) => string[] = (p) => readdirSync(p)): MigrationFile[] {
  const files = readDir(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((fileName) => {
    const match = MIGRATION_FILE.exec(fileName);
    if (!match) {
      throw new Error(`Migration file "${fileName}" does not follow the YYYYMMDDHHMMSS_name.sql naming.`);
    }
    return { version: match[1], name: match[2], fileName };
  });
}

export function pendingMigrations(files: readonly MigrationFile[], applied: ReadonlySet<string>): MigrationFile[] {
  return files.filter((f) => !applied.has(f.version));
}

/** Project ref from the API URL, e.g. https://abcd.supabase.co → "abcd". Null for non-hosted URLs. */
export function projectRefFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface ConnectionCandidate {
  label: string;
  host: string;
  port: number;
  user: string;
}

/** Regions tried for the Supavisor session pooler, most likely first (EU projects for Balkan venues). */
export const POOLER_REGIONS = [
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
] as const;

/**
 * Where to try connecting when only the database password is known: the direct host first (IPv6 on
 * hosted Supabase), then the session poolers (IPv4, port 5432, user "postgres.<ref>").
 */
export function connectionCandidates(ref: string, preferredRegion?: string | null): ConnectionCandidate[] {
  const regions = preferredRegion
    ? [preferredRegion, ...POOLER_REGIONS.filter((r) => r !== preferredRegion)]
    : [...POOLER_REGIONS];
  const candidates: ConnectionCandidate[] = [
    { label: "direct", host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  ];
  for (const region of regions) {
    for (const prefix of ["aws-0", "aws-1"]) {
      candidates.push({
        label: `session pooler ${prefix}-${region}`,
        host: `${prefix}-${region}.pooler.supabase.com`,
        port: 5432,
        user: `postgres.${ref}`,
      });
    }
  }
  return candidates;
}

/** Errors that mean "wrong host/region, try the next candidate" rather than "stop". */
export function isTryNextError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  const message = (e?.message ?? "").toLowerCase();
  if (["ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ECONNRESET"].includes(code)) {
    return true;
  }
  // Supavisor answers a wrong region with "Tenant or user not found" or "(ENOTFOUND) tenant/user … not found".
  const wrongTenant = message.includes("tenant") && message.includes("not found");
  return wrongTenant || message.includes("timeout") || message.includes("getaddrinfo");
}

/** Errors that mean the password is wrong — stop immediately (do not lock the account with retries). */
export function isAuthError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "28P01" || /password authentication failed/i.test(e?.message ?? "");
}
