"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Route } from "next";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BUTTON_VARIANT_CLASSES, type ButtonVariant } from "./button-styles";
import { computeMenuPosition } from "./internal/menu-position";
import { menuItemClasses } from "./internal/menu-styles";
import { renderIcon, type IconLike } from "./internal/render-icon";

export interface DropdownMenuActionItem {
  type?: "item";
  /** Stable React key (defaults to the index). */
  key?: string;
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /** `Pencil` or `<Pencil />` (use the element form when rendering from a Server Component). */
  icon?: IconLike;
  /**
   * Runs after the menu has closed and focus is back on the trigger, so a dialog opened from here
   * returns focus to the trigger when it closes. Client Components only.
   */
  onSelect?: () => void;
  /** Navigates with next/link (client-side, keeps the venue player alive). */
  href?: Route;
  /** POSTs a hidden form to this URL, e.g. "/auth/signout". Works from Server Components. */
  action?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
}

export interface DropdownMenuSeparator {
  type: "separator";
  key?: string;
}

export type DropdownMenuItem = DropdownMenuActionItem | DropdownMenuSeparator;

export interface DropdownMenuProps {
  /**
   * Accessible name of the trigger, e.g. "Actions for Afterglow". With a custom `trigger` it must
   * include the trigger's visible text (WCAG 2.5.3), e.g. "Administrator, account menu".
   */
  label: string;
  items: readonly DropdownMenuItem[];
  /** Custom trigger content (avatar + name…). Default: a "…" icon button. */
  trigger?: ReactNode;
  /** Trigger look. Default "ghost". */
  triggerVariant?: ButtonVariant;
  /** Icon trigger size: sm 36px, md 44px (default). */
  triggerSize?: "sm" | "md";
  /**
   * Extra trigger classes. With a custom `trigger` they replace the default size/padding/gap/radius
   * ("h-11 gap-2 rounded-control px-3"), so include those yourself.
   */
  triggerClassName?: string;
  /** Which trigger edge the menu lines up with. Default "end" (right). */
  align?: "start" | "end";
  /** Preferred side; flips automatically when there is no room. Default "bottom". */
  side?: "bottom" | "top";
  /** Non-interactive content above the items (e.g. the signed-in email). */
  header?: ReactNode;
  disabled?: boolean;
  /** Wrapper classes. */
  className?: string;
  menuClassName?: string;
}

interface OpenState {
  focus: "first" | "last";
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

function focusableItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
}

function isActionItem(item: DropdownMenuItem): item is DropdownMenuActionItem {
  return item.type !== "separator";
}

/**
 * Accessible menu button (WAI-ARIA APG): Enter/Space/↓ open on the first item, ↑ on the last;
 * ↑/↓/Home/End and first-letter typeahead move between items; Escape closes and returns focus
 * to the trigger; Tab closes and continues from the trigger; clicking outside closes. The menu is a
 * top-layer popover positioned next to the trigger, so it is never clipped by scrolling tables.
 */
export function DropdownMenu({
  label,
  items,
  trigger,
  triggerVariant = "ghost",
  triggerSize = "md",
  triggerClassName,
  align = "end",
  side = "bottom",
  header,
  disabled = false,
  className,
  menuClassName,
}: DropdownMenuProps) {
  const baseId = useId();
  const triggerId = `${baseId}trigger`;
  const menuId = `${baseId}menu`;
  const formId = (index: number) => `${baseId}form-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [openState, setOpenState] = useState<OpenState | null>(null);
  const open = openState !== null;

  const close = useCallback((returnFocus: boolean) => {
    setOpenState(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!openState) return;
    const popup = popupRef.current;
    const button = triggerRef.current;
    if (!popup || !button) return;

    try {
      if (!popup.matches(":popover-open")) popup.showPopover();
    } catch {
      // No Popover API: the menu stays a fixed-position element above the page.
    }

    const place = () => {
      const position = computeMenuPosition(
        button.getBoundingClientRect(),
        { width: popup.offsetWidth, height: popup.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
        { align, side },
      );
      popup.style.top = `${position.top}px`;
      popup.style.left = `${position.left}px`;
      popup.dataset.side = position.side;
    };
    place();

    const candidates = focusableItems(menuRef.current);
    (openState.focus === "last" ? candidates[candidates.length - 1] : candidates[0])?.focus();

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (popup.contains(target) || button.contains(target))) return;
      setOpenState(null);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      try {
        if (popup.matches(":popover-open")) popup.hidePopover();
      } catch {
        // Nothing to hide without the Popover API.
      }
    };
  }, [openState, align, side]);

  function activate(item: DropdownMenuActionItem, index: number) {
    if (item.disabled) return;
    close(true);
    if (item.action) {
      const form = document.getElementById(formId(index));
      if (form instanceof HTMLFormElement) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }
      return;
    }
    item.onSelect?.();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpenState({ focus: event.key === "ArrowUp" ? "last" : "first" });
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const candidates = focusableItems(menuRef.current);
    const current = candidates.findIndex((element) => element === document.activeElement);
    const focusAt = (index: number) => candidates[(index + candidates.length) % candidates.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(current + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(current === -1 ? -1 : current - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(-1);
        return;
      case "Escape":
        // Also keeps an enclosing modal dialog from closing on the same key press.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case "Tab":
        // Focus goes back to the trigger first, so the default Tab continues from there.
        close(true);
        return;
    }

    if (event.key.length === 1 && event.key.trim() && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLowerCase();
      for (let step = 1; step <= candidates.length; step++) {
        const candidate = candidates[(Math.max(current, 0) + step) % candidates.length];
        if (candidate.textContent?.trim().toLowerCase().startsWith(letter)) {
          candidate.focus();
          break;
        }
      }
    }
  }

  // Hover/focus tint plus a visible keyboard focus ring (see internal/menu-styles.ts).
  const itemClasses = (item: DropdownMenuActionItem) => menuItemClasses({ tone: item.tone, disabled: item.disabled });

  const itemContent = (item: DropdownMenuActionItem) => (
    <>
      {item.icon !== undefined && (
        <span aria-hidden="true" className={cn("flex", item.tone === "danger" ? "text-danger" : "text-fg-muted")}>
          {renderIcon(item.icon)}
        </span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate">{item.label}</span>
        {item.description && <span className="text-xs font-normal text-fg-muted">{item.description}</span>}
      </span>
    </>
  );

  return (
    <div className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={trigger ? undefined : label}
        disabled={disabled}
        onClick={() => setOpenState((current) => (current ? null : { focus: "first" }))}
        onKeyDown={handleTriggerKeyDown}
        className={
          trigger
            ? cn(
                "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors",
                "[&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
                BUTTON_VARIANT_CLASSES[triggerVariant],
                // Size, padding, gap and radius come from here so callers never fight the defaults.
                triggerClassName ?? "h-11 gap-2 rounded-control px-3",
              )
            : cn(
                "inline-flex shrink-0 items-center justify-center rounded-control transition-colors [&_svg]:shrink-0",
                "disabled:pointer-events-none disabled:opacity-50",
                BUTTON_VARIANT_CLASSES[triggerVariant],
                triggerSize === "sm" ? "size-9 [&_svg]:size-4" : "size-11 [&_svg]:size-5",
                triggerClassName,
              )
        }
      >
        {trigger ?? <MoreHorizontal aria-hidden="true" />}
      </button>

      {items.map((item, index) =>
        isActionItem(item) && item.action ? (
          <form key={`form-${item.key ?? index}`} id={formId(index)} action={item.action} method="post" hidden />
        ) : null,
      )}

      {open && (
        <div
          ref={popupRef}
          popover="manual"
          className={cn(
            "fixed inset-auto m-0 w-max max-w-[min(20rem,calc(100vw-1rem))] min-w-52 overflow-y-auto",
            "max-h-[calc(100dvh-1rem)] rounded-card border border-border-strong bg-surface-2 p-1.5 text-fg shadow-overlay",
            "motion-safe:animate-menu-in",
            menuClassName,
          )}
        >
          {header && <div className="mb-1 border-b border-border px-3 pt-2 pb-3 text-sm">{header}</div>}
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            aria-orientation="vertical"
            onKeyDown={handleMenuKeyDown}
            className="grid gap-0.5"
          >
            {items.map((item, index) => {
              const key = item.key ?? String(index);
              if (!isActionItem(item)) {
                return <div key={key} role="separator" className="mx-1 my-1 h-px bg-border" />;
              }
              if (item.href && !item.disabled) {
                return (
                  <Link
                    key={key}
                    href={item.href}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      close(true);
                      item.onSelect?.();
                    }}
                    className={itemClasses(item)}
                  >
                    {itemContent(item)}
                  </Link>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => activate(item, index)}
                  className={itemClasses(item)}
                >
                  {itemContent(item)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
