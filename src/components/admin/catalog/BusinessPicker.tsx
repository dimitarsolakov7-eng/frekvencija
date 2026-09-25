"use client";

import { useId, useState, type ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button, Checkbox, SearchInput, StatusPill } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { normalizeForSearch } from "./genre-helpers";
import type { BusinessOption } from "./types";

/** Show a filter box once the list is longer than this. */
const FILTER_THRESHOLD = 8;

export interface BusinessPickerProps {
  legend: ReactNode;
  businesses: readonly BusinessOption[];
  /** Selected business ids. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  /** Where "Add a business" links when there are none. */
  businessesHref?: string;
}

/** Multi-select of businesses as a filterable list of checkbox tiles (fieldset + legend). */
export function BusinessPicker({
  legend,
  businesses,
  value,
  onChange,
  hint,
  error,
  disabled,
  businessesHref = "/admin/businesses",
}: BusinessPickerProps) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const selected = new Set(value);
  const needle = normalizeForSearch(filter);
  const shown = needle ? businesses.filter((business) => normalizeForSearch(business.name).includes(needle)) : businesses;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const countId = `${id}-count`;

  function toggle(businessId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(businessId);
    else next.delete(businessId);
    onChange(businesses.filter((business) => next.has(business.id)).map((business) => business.id));
  }

  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-describedby={[hintId, businesses.length > 0 ? countId : undefined, errorId].filter(Boolean).join(" ") || undefined}
      disabled={disabled}
    >
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {hint && (
        <p id={hintId} className="-mt-1 text-sm text-fg-muted">
          {hint}
        </p>
      )}

      {businesses.length === 0 ? (
        <p className="rounded-control border border-dashed border-border-strong px-3 py-3 text-sm text-fg-muted">
          No businesses yet.{" "}
          <Link href={businessesHref as Route} className="font-medium text-accent-text underline-offset-4 hover:underline">
            Add a business
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={countId} aria-live="polite" className="text-sm text-fg-muted">
              {value.length === 0 ? "None selected" : `${value.length} of ${businesses.length} selected`}
            </p>
            {value.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                Clear
              </Button>
            )}
          </div>
          {businesses.length > FILTER_THRESHOLD && (
            <SearchInput label="Filter businesses by name" placeholder="Filter businesses" value={filter} onValueChange={setFilter} />
          )}
          <div className={cn("grid gap-2 p-0.5", businesses.length > 6 && "max-h-72 overflow-y-auto")}>
            {shown.length === 0 ? (
              <p className="text-sm text-fg-muted">No business matches “{filter.trim()}”.</p>
            ) : (
              shown.map((business) => (
                <Checkbox
                  key={business.id}
                  variant="tile"
                  checked={selected.has(business.id)}
                  onChange={(event) => toggle(business.id, event.currentTarget.checked)}
                  label={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {business.name}
                      {!business.isActive && <StatusPill tone="neutral" size="sm" label="Inactive" />}
                    </span>
                  }
                />
              ))
            )}
          </div>
        </>
      )}

      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  );
}
