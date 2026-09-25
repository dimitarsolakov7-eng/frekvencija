"use client";

import { MonitorSmartphone } from "lucide-react";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Kbd, Switch } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { ScreenWakeLockControl } from "./PlayerProvider";
import { PLAYER_SHORTCUT_KEYS } from "./shortcuts";

export interface PlaybackSettingsProps {
  shortcutsEnabled: boolean;
  onShortcutsChange(enabled: boolean): void;
  wakeLock: ScreenWakeLockControl;
  /** Heading id so the surrounding region can reference it. */
  headingId?: string;
  className?: string;
}

/** The honest note about what can stop playback (docs/research/browser-audio.md §7). */
export const DEVICE_SLEEP_NOTE =
  "Keep this tab open and the device awake and plugged in. Audio stops if the computer sleeps, the browser closes, or a phone or tablet puts the browser in the background. The player always shows when audio has stopped.";

export function wakeLockStatus(wakeLock: Pick<ScreenWakeLockControl, "supported" | "enabled" | "error" | "active">): {
  text: string;
  tone: "muted" | "accent" | "warning";
} {
  if (!wakeLock.supported) {
    return { text: "This browser can't keep the screen awake. Change the device's sleep settings instead.", tone: "muted" };
  }
  if (!wakeLock.enabled) return { text: "Off: the screen may dim or lock as usual.", tone: "muted" };
  if (wakeLock.error) return { text: wakeLock.error, tone: "warning" };
  if (wakeLock.active) return { text: "On: the screen stays awake while music plays.", tone: "accent" };
  return { text: "On: the screen stays awake whenever music is playing and this tab is visible.", tone: "muted" };
}

/**
 * "Playback on this device": the keyboard-shortcut switch (WCAG 2.1.4 needs a way to turn
 * single-key shortcuts off), Keep screen awake, and the honest device-sleep note. Saved per browser.
 */
export function PlaybackSettings({ shortcutsEnabled, onShortcutsChange, wakeLock, headingId, className }: PlaybackSettingsProps) {
  const awake = wakeLockStatus(wakeLock);
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle id={headingId}>Playback on this device</CardTitle>
        <CardDescription>These settings are saved in this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3">
          <Switch
            label="Keyboard shortcuts"
            description="Control the radio from the keyboard while the Your radio page is open. Turn this off if the keys get in the way."
            checked={shortcutsEnabled}
            onCheckedChange={onShortcutsChange}
          />
          <ul aria-label="Keyboard shortcuts" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
            {PLAYER_SHORTCUT_KEYS.map((shortcut) => (
              <li key={shortcut.action} className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  {shortcut.keys.map((key, index) => (
                    <span key={key} className="flex items-center gap-1">
                      {index > 0 && <span aria-hidden="true">/</span>}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </span>
                <span>{shortcut.action}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-2 border-t border-border pt-6">
          <Switch
            label="Keep screen awake"
            description="Stops this screen from dimming or locking while music plays."
            checked={wakeLock.supported && wakeLock.enabled}
            disabled={!wakeLock.supported}
            onCheckedChange={wakeLock.setEnabled}
          />
          <p
            className={cn(
              "text-sm",
              awake.tone === "accent" ? "text-accent-text" : awake.tone === "warning" ? "text-warning" : "text-fg-muted",
            )}
          >
            {awake.text}
          </p>
        </div>

        <Alert
          role="note"
          tone="neutral"
          icon={<MonitorSmartphone />}
          title="Keep the music running"
          description={`${DEVICE_SLEEP_NOTE} Keeping the screen awake helps, but it can't stop a laptop from sleeping when its lid is closed.`}
        />
      </CardContent>
    </Card>
  );
}
