"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Select } from "@/components/ui";

export interface VenueOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface VenueSelectProps {
  venues: readonly VenueOption[];
  currentId: string;
  /** Called when the admin commits another venue (the studio may ask to discard unsaved edits). */
  onSelect: (venueId: string) => void;
  disabled?: boolean;
}

/** Keys that change a closed native select's value without the admin having committed a choice. */
const BROWSING_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * Venue selector (screen 07, top right). Choosing a venue with the pointer opens it at once. With the
 * keyboard, arrow keys only browse (a closed select changes its value on every arrow press); Enter or
 * leaving the field opens the chosen venue, so keyboard users are never sent away by accident.
 */
export function VenueSelect({ venues, currentId, onSelect, disabled = false }: VenueSelectProps) {
  const id = useId();
  const [value, setValue] = useState(currentId);
  const browsingRef = useRef(false);

  function commit(next: string) {
    browsingRef.current = false;
    if (next && next !== currentId) onSelect(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
      return;
    }
    browsingRef.current = BROWSING_KEYS.has(event.key) || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey);
  }

  return (
    <div className="grid w-full gap-1 sm:w-64">
      <label htmlFor={id} className="sr-only">
        Venue
      </label>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          if (!browsingRef.current) commit(next);
        }}
        onBlur={(event) => {
          if (browsingRef.current) commit(event.currentTarget.value);
        }}
        aria-describedby={`${id}-hint`}
      >
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.isActive ? venue.name : `${venue.name} (inactive)`}
          </option>
        ))}
      </Select>
      <p id={`${id}-hint`} className="sr-only">
        Choosing a venue opens its announcements.
      </p>
    </div>
  );
}
