"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Building2, Inbox, SearchX } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  ButtonLink,
  CoverImage,
  DropdownMenu,
  EmptyState,
  SearchInput,
  Select,
  StatusPill,
} from "@/components/ui";
import type { AdminBusinessListItem } from "@/lib/data/admin/businesses";
import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/initials";
import { useBusinessMenuItems } from "./BusinessActionDialogs";
import { businessTypeLabel } from "./business-form";
import { countBusinessStatuses, filterBusinesses, MAX_SEARCH_LENGTH } from "./business-list";
import {
  BUSINESS_STATUS_FILTERS,
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_TONES,
  isBusinessStatusFilter,
  type BusinessStatusFilter,
} from "./business-status";

export interface BusinessListProps {
  items: readonly AdminBusinessListItem[];
  /** Why Active/Invited could not be verified, or null. */
  statusNote: string | null;
  /** The venue open in the detail panel. */
  selectedId: string | null;
  basePath: string;
  /** Link to the access-request list, with the number of new requests (null = unknown). */
  requestsHref: string;
  newRequestCount: number | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

function plural(count: number, one: string, many: string): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

function StatusDot({ filter }: { filter: BusinessStatusFilter }) {
  if (filter === "all") return null;
  const color = { active: "bg-accent", invited: "bg-warning", inactive: "bg-fg-muted" }[filter];
  return <span className={cn("block size-2 rounded-full", color)} />;
}

function RequestsLink({ href, count }: { href: string; count: number | null }) {
  return (
    <ButtonLink href={href as Route} variant="secondary" size="sm" icon={<Inbox aria-hidden="true" />}>
      Access requests
      {count !== null && count > 0 && (
        <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent-text ring-1 ring-accent/30 ring-inset">
          {numberFormat.format(count)} new
        </span>
      )}
    </ButtonLink>
  );
}

function BusinessRow({ item, selected, basePath }: { item: AdminBusinessListItem; selected: boolean; basePath: string }) {
  const menuItems = useBusinessMenuItems({
    id: item.id,
    name: item.name,
    isActive: item.isActive,
    memberCount: item.memberCount,
    memberEmails: item.memberEmails,
  });
  const typeLabel = businessTypeLabel(item.businessType);

  return (
    <li
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-card border px-3 py-3 transition-colors sm:px-4",
        "@xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_6.75rem_auto] @xl:gap-x-3 @2xl:gap-x-4",
        selected
          ? "border-accent bg-accent/[0.07] ring-1 ring-accent/40 ring-inset"
          : "border-transparent hover:bg-surface-2/70",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={item.name} initials={initials(item.name).slice(0, 1)} tone="auto" shape="rounded" size="md" decorative />
        <CoverImage
          src={item.logoUrl}
          artworkKey={item.id}
          sizes="56px"
          className="hidden size-14 shrink-0 rounded-control border border-border @md:block"
        />
      </div>

      <div className="grid min-w-0 gap-0.5">
        <Link
          href={`${basePath}/${item.id}` as Route}
          scroll={false}
          aria-current={selected ? "page" : undefined}
          data-business-row={item.id}
          className="truncate rounded-sm font-semibold text-fg after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
        >
          {item.name}
        </Link>
        <span className="truncate text-sm text-fg-muted">
          {typeLabel}
          <span className="@xl:hidden"> · {item.stationName}</span>
        </span>
      </div>

      <span className="hidden truncate text-[0.9375rem] text-fg @xl:block">{item.stationName}</span>

      <div className="col-start-2 row-start-2 @xl:col-start-auto @xl:row-start-auto">
        <StatusPill
          tone={BUSINESS_STATUS_TONES[item.status]}
          label={BUSINESS_STATUS_LABELS[item.status]}
          title={item.statusDetail}
          size="sm"
          className="@xl:h-8 @xl:px-3 @xl:text-sm"
        />
        <span className="sr-only">. {item.statusDetail}</span>
      </div>

      <div className="relative z-10 col-start-3 row-span-2 row-start-1 self-center @xl:col-start-auto @xl:row-span-1 @xl:row-start-auto">
        <DropdownMenu label={`Actions for ${item.name}`} items={menuItems} />
      </div>
    </li>
  );
}

/**
 * The business list of screen 06: instant search (name, station, contact email) and status filter,
 * one row per venue with its initial, logo or artwork, type, station and status. Rows adapt to the
 * list's own width (container queries), so the same list works beside the detail panel and alone.
 */
export function BusinessList({ items, statusNote, selectedId, basePath, requestsHref, newRequestCount }: BusinessListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BusinessStatusFilter>("all");
  const visible = filterBusinesses(items, { query, status });
  const counts = countBusinessStatuses(items);
  const filtering = query.trim() !== "" || status !== "all";

  function clearFilters() {
    setQuery("");
    setStatus("all");
  }

  if (items.length === 0) {
    return (
      <div className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex justify-end">
          <RequestsLink href={requestsHref} count={newRequestCount} />
        </div>
        <EmptyState
          icon={<Building2 />}
          title="No businesses yet"
          description="Add your first venue: its station name, the genres it may play and the contact who signs in to play it."
          action={
            <ButtonLink href={`${basePath}/new` as Route} icon={<Building2 aria-hidden="true" />}>
              Add business
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="@container rounded-card border border-border bg-surface shadow-card">
      <div className="grid gap-3 p-4 sm:p-5">
        <div role="search" aria-label="Businesses" className="flex flex-col gap-3 @lg:flex-row">
          <SearchInput
            label="Search businesses"
            placeholder="Search businesses"
            value={query}
            maxLength={MAX_SEARCH_LENGTH}
            onValueChange={setQuery}
            autoComplete="off"
            className="@lg:flex-1"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (isBusinessStatusFilter(value)) setStatus(value);
            }}
            leading={status === "all" ? undefined : <StatusDot filter={status} />}
            className="@lg:w-52"
          >
            {BUSINESS_STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-fg-muted">
            {filtering
              ? `${plural(visible.length, "business", "businesses")} shown of ${numberFormat.format(counts.total)}`
              : `${plural(counts.total, "business", "businesses")} · ${numberFormat.format(counts.active)} active · ${numberFormat.format(counts.invited)} invited · ${numberFormat.format(counts.inactive)} inactive`}
          </p>
          <RequestsLink href={requestsHref} count={newRequestCount} />
        </div>
        {statusNote && <Alert tone="info" description={statusNote} className="py-3" />}
      </div>

      {visible.length === 0 ? (
        <div className="border-t border-border p-4 sm:p-5">
          <EmptyState
            icon={<SearchX />}
            headingLevel="h3"
            title="No businesses match"
            description={query.trim() ? `Nothing matches “${query.trim()}” with this status.` : "No business has this status."}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <div className="border-t border-border px-2 pt-2 pb-3 sm:px-3">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_6.75rem_auto] items-center gap-x-3 border border-transparent px-4 py-3 text-sm font-medium text-fg-muted @xl:grid @2xl:gap-x-4"
          >
            <span className="w-[6.75rem]">Business</span>
            <span />
            <span>Station name</span>
            <span>Status</span>
            <span className="w-11" />
          </div>
          <ul aria-label="Businesses" className="grid gap-1">
            {visible.map((item) => (
              <BusinessRow key={item.id} item={item} selected={item.id === selectedId} basePath={basePath} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
