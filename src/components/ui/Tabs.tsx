"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  SEGMENTED_ACTIVE_CLASSES,
  SEGMENTED_INACTIVE_CLASSES,
  SEGMENTED_LIST_CLASSES,
  SEGMENTED_TAB_CLASSES,
  TAB_ACTIVE_CLASSES,
  TAB_CLASSES,
  TAB_INACTIVE_CLASSES,
  TAB_LIST_CLASSES,
} from "./internal/control-styles";

export interface TabItem {
  /** Stable key for the tab. */
  value: string;
  label: ReactNode;
  /** Decorative icon before the label, e.g. <Upload />. */
  icon?: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export type TabsVariant = "underline" | "segmented";

export interface TabsProps {
  items: readonly TabItem[];
  /** Accessible name of the tab list, e.g. "Announcement settings". */
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** `underline` (screens 05/06, default) or `segmented` (screen 07). */
  variant?: TabsVariant;
  className?: string;
  /** Classes for the tab list (e.g. full-width segmented control: "w-full [&>*]:flex-1"). */
  listClassName?: string;
  panelClassName?: string;
}

/**
 * Client-side tabs following the WAI-ARIA tabs pattern: one Tab stop for the list, arrow keys
 * (and Home/End) move between tabs and select them. Inactive panels stay mounted but hidden, so
 * form input inside them is kept. For route-based navigation use <NavTabs>.
 */
export function Tabs({
  items,
  label,
  value,
  defaultValue,
  onValueChange,
  variant = "underline",
  className,
  listClassName,
  panelClassName,
}: TabsProps) {
  const baseId = useId();
  const firstEnabled = items.find((item) => !item.disabled)?.value;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? firstEnabled);
  const requested = value ?? uncontrolledValue;
  const selected = items.some((item) => item.value === requested && !item.disabled) ? requested : firstEnabled;
  const segmented = variant === "segmented";

  function select(next: string) {
    if (value === undefined) setUncontrolledValue(next);
    if (next !== selected) onValueChange?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const index = tabs.findIndex((tab) => tab === event.target);
    if (index === -1) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab.focus();
    const nextValue = nextTab.dataset.value;
    if (nextValue !== undefined) select(nextValue);
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className={cn(segmented ? SEGMENTED_LIST_CLASSES : TAB_LIST_CLASSES, listClassName)}
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => {
          const isSelected = item.value === selected;
          return (
            <button
              key={item.value}
              id={`${baseId}tab-${index}`}
              type="button"
              role="tab"
              data-value={item.value}
              aria-selected={isSelected}
              aria-controls={`${baseId}panel-${index}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              className={
                segmented
                  ? cn(SEGMENTED_TAB_CLASSES, isSelected ? SEGMENTED_ACTIVE_CLASSES : SEGMENTED_INACTIVE_CLASSES)
                  : cn(TAB_CLASSES, isSelected ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES)
              }
            >
              {item.icon && (
                <span aria-hidden="true" className="flex">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item, index) => (
        <div
          key={item.value}
          id={`${baseId}panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${baseId}tab-${index}`}
          hidden={item.value !== selected}
          tabIndex={0}
          className={cn(segmented ? "pt-4" : "pt-5", "focus-visible:outline-offset-4", panelClassName)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

export type SegmentedTabsProps = Omit<TabsProps, "variant">;

/**
 * Segmented control with tab semantics (screen 07 "Generate voice | Upload recording"): the
 * selected segment is emerald-tinted. Same props and keyboard behaviour as <Tabs>.
 */
export function SegmentedTabs(props: SegmentedTabsProps) {
  return <Tabs {...props} variant="segmented" />;
}
