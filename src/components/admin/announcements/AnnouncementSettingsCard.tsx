"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Volume2 } from "lucide-react";
import { Card, FormMessage, Input, Select, Slider, SubmitButton } from "@/components/ui";
import { MUSIC_GAIN } from "@/config/platform";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/actions/state";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { MAX_VOLUME_PERCENT, MIN_VOLUME_PERCENT, volumeToPercent } from "./rules";
import { isPlayAfterPreset, MAX_PLAY_AFTER, MIN_PLAY_AFTER, PLAY_AFTER_PRESETS, playAfterLabel } from "./studio-model";

/** aria-describedby from the ids that apply (the hint always, the error while there is one). */
function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined;
}

export interface AnnouncementSettingsCardProps {
  everyNTracks: number;
  /** Stored gain 0.10–1.00. */
  volume: number;
  /** Server Action bound to the venue: fields announcementEveryNTracks (1–50), announcementVolumePercent (10–100). */
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Reports unsaved changes (the studio asks before switching venues). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Result to start from (default: none yet), e.g. to render a validation failure in isolation. */
  initialState?: ActionState;
}

const CUSTOM = "custom";

/**
 * "Announcement settings" (screen 07, right): how many completed songs play between announcements
 * (1–12 from the list, or a custom number up to 50) and the announcement volume. Saved explicitly.
 */
export function AnnouncementSettingsCard({
  everyNTracks,
  volume,
  action,
  onDirtyChange,
  initialState = IDLE_ACTION_STATE,
}: AnnouncementSettingsCardProps) {
  const [state, formAction] = useActionState(action, initialState);
  const selectId = useId();
  const customId = useId();
  const hintId = useId();
  const intervalErrorId = useId();
  const volumeHintId = useId();
  const volumeErrorId = useId();
  const [choice, setChoice] = useState(isPlayAfterPreset(everyNTracks) ? String(everyNTracks) : CUSTOM);
  const [custom, setCustom] = useState(String(everyNTracks));
  const [percent, setPercent] = useState(volumeToPercent(volume));
  const musicPercent = Math.round(MUSIC_GAIN * 100);
  const everyValue = choice === CUSTOM ? custom : choice;
  const intervalError = state.ok ? undefined : state.fieldErrors.announcementEveryNTracks;
  const volumeError = state.ok ? undefined : state.fieldErrors.announcementVolumePercent;
  // The interval error belongs to whichever control holds the value: the select, or the custom number.
  const selectInvalid = Boolean(intervalError) && choice !== CUSTOM;
  const customInvalid = Boolean(intervalError) && choice === CUSTOM;

  const dirty = everyValue.trim() !== String(everyNTracks) || percent !== volumeToPercent(volume);
  useUnsavedChangesGuard(dirty, { message: "Your announcement settings haven’t been saved." });
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 className="section-title font-bold text-fg">Announcement settings</h2>
        <p className="text-sm text-fg-muted">Control when your announcement plays and how loud it is.</p>
      </div>

      <form
        action={formAction}
        noValidate
        className="mt-5 grid gap-5"
      >
        <div className="grid gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium text-fg">
            Play after
          </label>
          <Select
            id={selectId}
            value={choice}
            aria-describedby={describedBy(hintId, selectInvalid && intervalErrorId)}
            aria-invalid={selectInvalid || undefined}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setChoice(next);
            }}
          >
            {PLAY_AFTER_PRESETS.map((songs) => (
              <option key={songs} value={String(songs)}>
                {playAfterLabel(songs)}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </Select>
          {choice === CUSTOM ? (
            <div className="mt-2 grid gap-1.5">
              <label htmlFor={customId} className="text-sm font-medium text-fg">
                Completed songs between announcements
              </label>
              <Input
                id={customId}
                name="announcementEveryNTracks"
                type="number"
                inputMode="numeric"
                min={MIN_PLAY_AFTER}
                max={MAX_PLAY_AFTER}
                step={1}
                required
                value={custom}
                aria-describedby={describedBy(hintId, customInvalid && intervalErrorId)}
                aria-invalid={customInvalid || undefined}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setCustom(next);
                }}
                className="max-w-32"
              />
            </div>
          ) : (
            <input type="hidden" name="announcementEveryNTracks" value={everyValue} />
          )}
          <p id={hintId} className="text-sm text-fg-muted">
            Announcements play between songs.{choice === CUSTOM ? ` Enter ${MIN_PLAY_AFTER}–${MAX_PLAY_AFTER}.` : ""} Skipped songs do not
            count.
          </p>
          {intervalError && (
            <p id={intervalErrorId} className="text-sm text-danger">
              {intervalError}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <span aria-hidden="true" className="text-sm font-medium text-fg">
            Announcement volume
          </span>
          <div className="flex items-center gap-3">
            <Volume2 aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            <Slider
              name="announcementVolumePercent"
              label="Announcement volume"
              hideLabel
              showValue={false}
              min={MIN_VOLUME_PERCENT}
              max={MAX_VOLUME_PERCENT}
              step={1}
              value={percent}
              onValueChange={(next) => {
                setPercent(next);
              }}
              formatValue={(value) => `${value}%`}
              aria-describedby={describedBy(volumeHintId, volumeError && volumeErrorId)}
              aria-invalid={volumeError ? true : undefined}
              className="min-w-0 flex-1"
            />
            <span aria-hidden="true" className="w-11 shrink-0 text-right text-sm text-fg-muted tabular-nums">
              {percent}%
            </span>
          </div>
          <p id={volumeHintId} className="text-sm text-fg-muted">
            Relative to the venue&apos;s own volume. Music plays at {musicPercent}%.
          </p>
          {volumeError && (
            <p id={volumeErrorId} className="text-sm text-danger">
              {volumeError}
            </p>
          )}
        </div>

        <FormMessage state={state} />
        <SubmitButton variant="outline" fullWidth pendingLabel="Saving…">
          Save settings
        </SubmitButton>
      </form>
    </Card>
  );
}
