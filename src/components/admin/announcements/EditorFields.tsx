"use client";

import { useId, type Ref } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button, Input, Label, Textarea } from "@/components/ui";
import type { AnnouncementPlacement } from "@/lib/api/contracts";
import { PLACEMENT_CHOICES, placementTiming } from "@/lib/announcements/labels";
import { PRONUNCIATION_MAX_LENGTH, type TextCounter } from "@/lib/announcements/spoken";
import { ANNOUNCEMENT_TEMPLATES } from "@/lib/announcements/templates";
import { cn } from "@/lib/utils/cn";
import { InfoToggletip } from "./InfoToggletip";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Template quick-picks
// ---------------------------------------------------------------------------

export interface TemplatePicksProps {
  /** Key of the template the current text matches, if any. */
  activeKey: string | null;
  onPick: (templateKey: string) => void;
  disabled?: boolean;
}

/** "Start from a template" chips: each fills the text with the venue's names and sets its placement. */
export function TemplatePicks({ activeKey, onPick, disabled = false }: TemplatePicksProps) {
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <p id={labelId} className="text-sm font-medium text-fg">
        Start from a template
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {ANNOUNCEMENT_TEMPLATES.map((template) => {
          const active = template.key === activeKey;
          return (
            <button
              key={template.key}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onPick(template.key)}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                "disabled:pointer-events-none disabled:opacity-50",
                active
                  ? "border-accent/50 bg-accent/15 text-fg"
                  : "border-border bg-control text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg",
              )}
            >
              {template.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface PlacementFieldProps {
  value: AnnouncementPlacement;
  onChange: (placement: AnnouncementPlacement) => void;
  everyNTracks: number;
  disabled?: boolean;
}

/** Station identity / Welcome message / Both, as a labelled radio group of pills. */
export function PlacementField({ value, onChange, everyNTracks, disabled = false }: PlacementFieldProps) {
  const name = useId();
  const hintId = `${name}-hint`;
  return (
    <fieldset className="grid gap-2" disabled={disabled} aria-describedby={hintId}>
      <legend className="mb-2 text-sm font-medium text-fg">Placement</legend>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {PLACEMENT_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "relative flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-3 py-2 text-center text-sm font-medium transition-colors",
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
              "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60",
              choice.value === value
                ? "border-accent/50 bg-accent/15 text-fg"
                : "border-border bg-control text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={choice.value === value}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
      <p id={hintId} className="text-sm text-fg-muted">
        {placementTiming(value, everyNTracks)}
      </p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Announcement text
// ---------------------------------------------------------------------------

export interface AnnouncementTextFieldProps {
  value: string;
  onChange: (text: string) => void;
  counter: TextCounter;
  error?: string;
  hint?: string;
  disabled?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/** Announcement text with its live "n/500" counter. */
export function AnnouncementTextField({ value, onChange, counter, error, hint, disabled = false, textareaRef }: AnnouncementTextFieldProps) {
  const id = useId();
  const counterId = `${id}-counter`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, counterId, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} required>
        Announcement text
      </Label>
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={3}
        required
        disabled={disabled}
        spellCheck
        aria-invalid={error || counter.over ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="flex items-start justify-between gap-3">
        {hint ? (
          <p id={hintId} className="text-sm text-fg-muted">
            {hint}
          </p>
        ) : (
          <span />
        )}
        <p id={counterId} className={cn("shrink-0 text-sm tabular-nums", counter.over ? "font-medium text-danger" : "text-fg-muted")}>
          <span className="sr-only">Characters used: </span>
          {counter.label}
        </p>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pronunciation spelling
// ---------------------------------------------------------------------------

export interface PronunciationFieldProps {
  value: string;
  onChange: (value: string) => void;
  venueName: string;
  /** Wording the voice will say, or null while the text is not valid yet. */
  spokenAs: string | null;
  /** The loaded recording's own spoken wording is used (it differs from the rebuilt one). */
  overridden: boolean;
  onRebuild: () => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Optional pronunciation spelling of the venue name. It only shapes this announcement's spoken
 * wording ("Spoken as: …"); the venue's own records are never changed from here.
 */
export function PronunciationField({ value, onChange, venueName, spokenAs, overridden, onRebuild, error, disabled = false }: PronunciationFieldProps) {
  const id = useId();
  const spokenId = `${id}-spoken`;
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <Label htmlFor={id} optional>
          Pronunciation spelling
        </Label>
        <InfoToggletip label="About pronunciation spelling">
          Write {venueName} the way it should sound, for example with spaces or phonetic spelling. The venue and station names in
          the text are respelled for the voice only; the venue&apos;s name and details are not changed.
        </InfoToggletip>
      </div>
      <Input
        id={id}
        value={value}
        maxLength={PRONUNCIATION_MAX_LENGTH}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={venueName}
        aria-invalid={error ? true : undefined}
        aria-describedby={[spokenId, error ? errorId : null].filter(Boolean).join(" ")}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div id={spokenId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
        {spokenAs ? (
          <p className="text-pretty">
            <span className="font-medium text-fg">Spoken as:</span> “{spokenAs}”
            {overridden && <span> (the recording&apos;s saved spoken wording)</span>}
          </p>
        ) : (
          <p>The spoken wording appears once the text is valid.</p>
        )}
        {overridden && (
          <Button variant="ghost" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={onRebuild} disabled={disabled} className="-my-1">
            Rebuild from spelling
          </Button>
        )}
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
