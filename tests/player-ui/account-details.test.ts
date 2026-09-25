import { describe, expect, it, vi } from "vitest";
import { announcementLanguageLabel, businessTypeLabel, loadAccountDetails } from "@/app/(venue)/account/_lib/account-details";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

const BUSINESS = { id: "biz-1", name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true };

/** A minimal fake of `from("businesses").select(…).eq("id", …).maybeSingle()` that records the calls. */
function fakeClient(result: { data: unknown; error: unknown } | Error) {
  const calls: { table?: string; columns?: string; eq?: [string, unknown] } = {};
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select(columns: string) {
          calls.columns = columns;
          return {
            eq(column: string, value: unknown) {
              calls.eq = [column, value];
              return {
                maybeSingle: async () => {
                  if (result instanceof Error) throw result;
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as TypedSupabaseClient, calls };
}

describe("account detail labels", () => {
  it("names business types like the rest of the product", () => {
    expect(businessTypeLabel("cafe")).toBe("Café");
    expect(businessTypeLabel("hotel")).toBe("Hotel");
    expect(businessTypeLabel("spaceship")).toBe("Other");
    expect(businessTypeLabel(null)).toBe("Other");
  });

  it("shows the announcement language by name with its code", () => {
    expect(announcementLanguageLabel("en")).toBe("English (en)");
    expect(announcementLanguageLabel("  ")).toBe("Not set");
    expect(announcementLanguageLabel(null)).toBe("Not set");
  });
});

describe("loadAccountDetails", () => {
  it("reads only the session's own venue with the user's client", async () => {
    const { client, calls } = fakeClient({
      data: {
        name: "EmeraldBar",
        station_name: "EmeraldBar Radio",
        business_type: "bar",
        contact_email: " manager@emeraldbar.example ",
        announcement_language: "en",
      },
      error: null,
    });
    const result = await loadAccountDetails(client, BUSINESS, "manager@emeraldbar.example");
    expect(calls).toEqual({
      table: "businesses",
      columns: "name, station_name, business_type, contact_email, announcement_language",
      eq: ["id", "biz-1"],
    });
    expect(result).toEqual({
      partial: false,
      details: {
        businessName: "EmeraldBar",
        stationName: "EmeraldBar Radio",
        businessType: "Bar",
        contactEmail: "manager@emeraldbar.example",
        announcementLanguage: "English (en)",
        signedInEmail: "manager@emeraldbar.example",
      },
    });
  });

  it("degrades to the session's name and station when the row can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const failure of [{ data: null, error: { code: "PGRST000" } }, { data: null, error: null }, new Error("offline")]) {
      const result = await loadAccountDetails(fakeClient(failure).client, BUSINESS, "a@b.example");
      expect(result.partial).toBe(true);
      expect(result.details).toMatchObject({ businessName: "EmeraldBar", stationName: "EmeraldBar Radio", contactEmail: null });
    }
  });
});
