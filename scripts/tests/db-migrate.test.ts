import { describe, expect, it } from "vitest";
import {
  connectionCandidates,
  isAuthError,
  isTryNextError,
  listMigrationFiles,
  pendingMigrations,
  projectRefFromUrl,
} from "../lib/db-migrate-plan";

describe("listMigrationFiles", () => {
  it("returns CLI-named .sql files in filename order", () => {
    const files = listMigrationFiles("x", () => [
      "20260926000100_frekvencija.sql",
      "README.md",
      "20260925000100_core_schema.sql",
    ]);
    expect(files.map((f) => f.version)).toEqual(["20260925000100", "20260926000100"]);
    expect(files[0]).toEqual({ version: "20260925000100", name: "core_schema", fileName: "20260925000100_core_schema.sql" });
  });

  it("rejects files that do not follow the CLI naming", () => {
    expect(() => listMigrationFiles("x", () => ["init.sql"])).toThrow(/naming/);
  });

  it("reads the real migrations folder", () => {
    const files = listMigrationFiles("supabase/migrations");
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.map((f) => f.fileName)).toEqual([...files.map((f) => f.fileName)].sort());
  });
});

describe("pendingMigrations", () => {
  it("skips applied versions", () => {
    const files = listMigrationFiles("x", () => ["20260925000100_a.sql", "20260925000200_b.sql"]);
    expect(pendingMigrations(files, new Set(["20260925000100"])).map((f) => f.name)).toEqual(["b"]);
  });
});

describe("projectRefFromUrl", () => {
  it("extracts the 20-character ref from hosted URLs", () => {
    expect(projectRefFromUrl("https://rqybdoiknzisphqscgty.supabase.co")).toBe("rqybdoiknzisphqscgty");
  });
  it("rejects local or malformed URLs", () => {
    expect(projectRefFromUrl("http://127.0.0.1:54321")).toBeNull();
    expect(projectRefFromUrl("not a url")).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe("connectionCandidates", () => {
  it("tries the direct host first, then the preferred region's poolers", () => {
    const c = connectionCandidates("rqybdoiknzisphqscgty", "eu-west-2");
    expect(c[0]).toMatchObject({ label: "direct", host: "db.rqybdoiknzisphqscgty.supabase.co", user: "postgres" });
    expect(c[1]).toMatchObject({ host: "aws-0-eu-west-2.pooler.supabase.com", user: "postgres.rqybdoiknzisphqscgty", port: 5432 });
    expect(new Set(c.map((x) => x.host)).size).toBe(c.length);
  });
});

describe("error classification", () => {
  it("treats wrong-region and network errors as try-next", () => {
    expect(isTryNextError({ code: "ENOTFOUND" })).toBe(true);
    expect(isTryNextError({ message: "Tenant or user not found" })).toBe(true);
    expect(isTryNextError({ code: "XX000", message: "(ENOTFOUND) tenant/user postgres.abc not found" })).toBe(true);
    expect(isTryNextError({ code: "42601", message: "syntax error" })).toBe(false);
  });
  it("detects a wrong password", () => {
    expect(isAuthError({ code: "28P01" })).toBe(true);
    expect(isAuthError({ message: 'password authentication failed for user "postgres"' })).toBe(true);
    expect(isAuthError({ code: "ENOTFOUND" })).toBe(false);
  });
});
