"use client";

import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { Card, CoverImage, DropdownMenu, StatusPill, type DropdownMenuItem } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { AdminGenreItem } from "./types";

export interface GenreCardProps {
  genre: AdminGenreItem;
  /** 1-based position in the full order. */
  position: number;
  total: number;
  selected: boolean;
  /** Reordering is possible (not while a search filters the grid). */
  canReorder: boolean;
  /** This card is being dragged / is the current drop target. */
  dragging: boolean;
  dropTarget: boolean;
  /** Id of the visually hidden reorder instructions. */
  instructionsId: string;
  onSelect: () => void;
  onMove: (direction: "up" | "down") => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onHandleDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onHandleDragEnd: () => void;
  onHandlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onHandlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onHandlePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onHandlePointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onCardDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onCardDrop: (event: DragEvent<HTMLLIElement>) => void;
}

/** Clicks on these never select the card (they have their own meaning). */
const INTERACTIVE = "button, a, input, [role='button'], [role='menu'], [role='menuitem'], [popover]";

/**
 * One genre in the grid (screen 08): cover, drag handle, name, Active/Inactive pill and a "…" menu
 * (Edit, Move up, Move down, Activate/Deactivate, Delete). In narrow grids (two columns on phones,
 * or beside the editor) the handle and menu sit on the cover so the name keeps its width.
 */
export function GenreCard({
  genre,
  position,
  total,
  selected,
  canReorder,
  dragging,
  dropTarget,
  instructionsId,
  onSelect,
  onMove,
  onToggleActive,
  onDelete,
  onHandleKeyDown,
  onHandleDragStart,
  onHandleDragEnd,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  onCardDragOver,
  onCardDrop,
}: GenreCardProps) {
  const items: DropdownMenuItem[] = [
    { key: "edit", label: "Edit", icon: Pencil, onSelect },
    { key: "up", label: "Move up", icon: ArrowUp, disabled: !canReorder || position === 1, onSelect: () => onMove("up") },
    { key: "down", label: "Move down", icon: ArrowDown, disabled: !canReorder || position === total, onSelect: () => onMove("down") },
    genre.isEnabled
      ? { key: "deactivate", label: "Deactivate", description: "Hide it from venues", icon: PowerOff, onSelect: onToggleActive }
      : { key: "activate", label: "Activate", description: "Venues with access can choose it", icon: Power, onSelect: onToggleActive },
    { type: "separator", key: "separator" },
    { key: "delete", label: "Delete", description: "Tracks and their audio are kept", icon: Trash2, tone: "danger", onSelect: onDelete },
  ];

  function handle(variant: "overlay" | "row") {
    return (
      // A focusable element with button semantics rather than a <button>: Firefox does not start
      // native drags on buttons. It has no click action; arrow keys move the genre.
      <div
        role="button"
        tabIndex={canReorder ? 0 : -1}
        aria-disabled={!canReorder || undefined}
        data-genre-handle={genre.id}
        aria-label={`Reorder ${genre.name}, position ${position} of ${total}`}
        aria-describedby={instructionsId}
        title={canReorder ? "Drag to reorder" : "Clear the search to reorder"}
        draggable={canReorder}
        onKeyDown={onHandleKeyDown}
        onDragStart={onHandleDragStart}
        onDragEnd={onHandleDragEnd}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerCancel}
        className={cn(
          "inline-flex shrink-0 touch-none items-center justify-center transition-colors select-none [&_svg]:size-5",
          canReorder ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-40",
          variant === "overlay"
            ? "size-11 rounded-full bg-canvas/75 text-fg backdrop-blur-sm"
            : "h-11 w-8 rounded-control text-fg-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        <GripVertical aria-hidden="true" />
      </div>
    );
  }

  function menu(variant: "overlay" | "row") {
    return (
      <DropdownMenu
        label={`Actions for ${genre.name}`}
        items={items}
        triggerClassName={variant === "overlay" ? "rounded-full! bg-canvas/75! text-fg! backdrop-blur-sm" : undefined}
      />
    );
  }

  function handleClick(event: MouseEvent<HTMLLIElement>) {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    onSelect();
  }

  return (
    <li
      data-genre-card={genre.id}
      onDragOver={onCardDragOver}
      onDrop={onCardDrop}
      onClick={handleClick}
      className={cn(
        "min-w-0 cursor-pointer rounded-card transition-opacity",
        dragging && "opacity-50",
        dropTarget && "outline-2 outline-offset-2 outline-accent outline-dashed",
      )}
    >
      <Card variant={selected ? "selected" : "default"} className="h-full overflow-hidden">
        <div className="relative">
          <CoverImage
            src={genre.coverUrl}
            artworkKey={genre.slug}
            sizes="(min-width: 1536px) 26rem, (min-width: 1024px) 22rem, 50vw"
            className="aspect-[16/10] @xl:aspect-[5/2]"
          />
          <div className="absolute inset-x-2 top-2 flex items-start justify-between @xl:hidden">
            {handle("overlay")}
            {menu("overlay")}
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 @xl:gap-3 @xl:px-4 @xl:py-3.5">
          <span className="hidden @xl:contents">{handle("row")}</span>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <h3 className="min-w-0">
              <button
                type="button"
                onClick={onSelect}
                aria-current={selected ? "true" : undefined}
                className="block max-w-full truncate rounded-sm text-left text-base font-bold text-fg underline-offset-4 hover:underline @xl:text-lg"
                title={genre.name}
              >
                <span className="sr-only">Edit </span>
                {genre.name}
              </button>
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill size="sm" tone={genre.isEnabled ? "success" : "neutral"} label={genre.isEnabled ? "Active" : "Inactive"} />
              <span className="text-xs text-fg-muted tabular-nums">
                {genre.totalCount === 1 ? "1 track" : `${genre.totalCount} tracks`}
              </span>
            </div>
          </div>
          <span className="hidden @xl:contents">{menu("row")}</span>
        </div>
      </Card>
    </li>
  );
}
