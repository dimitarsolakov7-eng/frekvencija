import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { BatteryCharging, BellOff, Cable, LifeBuoy, MonitorSmartphone, SlidersHorizontal, Speaker } from "lucide-react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Accordion, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { SupportContact } from "@/lib/api/contracts";
import { BLOCKED_COPY } from "./player-view";
import { DEVICE_SLEEP_NOTE } from "./PlaybackSettings";
import { SupportContactDetails } from "./SupportContactDetails";

export interface HelpViewProps {
  /** Completed songs between station announcements (the venue's setting). */
  everyNTracks: number;
  /** The venue has an approved clip that plays between songs. */
  hasRotation: boolean;
  /** The venue has an approved welcome clip. */
  hasWelcome: boolean;
  support: SupportContact;
  /** Where the playback settings (shortcuts, keep screen awake) live. */
  accountHref: Route;
}

function songs(n: number): string {
  return n === 1 ? "every song" : `every ${n} completed songs`;
}

export function stationVoiceHelp({ everyNTracks, hasRotation, hasWelcome }: Pick<HelpViewProps, "everyNTracks" | "hasRotation" | "hasWelcome">): string {
  const welcome = hasWelcome ? " A welcome recording also plays when you first start the radio." : "";
  if (hasRotation) {
    return `An approved recording with your venue's name plays between songs, after ${songs(everyNTracks)}. Skipped songs don't count, and Skip works during songs only, so the recording always plays to the end.${welcome}`;
  }
  return `When your administrator approves a recording with your venue's name, it plays between songs after ${songs(everyNTracks)}. Until then the music plays without voice clips.${welcome}`;
}

const TIPS: readonly { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <Speaker />,
    title: "Use a dedicated device",
    text: "A laptop, tablet or small computer that stays at the venue and is connected to your sound system works best.",
  },
  {
    icon: <Cable />,
    title: "Connect by cable when you can",
    text: "A cable to the amplifier or mixer is more reliable than Bluetooth, which can drop out in a busy room.",
  },
  {
    icon: <SlidersHorizontal />,
    title: "Set the room level on the amplifier",
    text: "Keep the device volume high and set the room volume on your amplifier; use the volume slider here for small changes.",
  },
  {
    icon: <BellOff />,
    title: "Silence other sounds",
    text: "Turn off notification and system sounds on the playback device so they never play through the speakers.",
  },
  {
    icon: <BatteryCharging />,
    title: "Keep it plugged in",
    text: "Leave the device on power so battery saving never pauses the music.",
  },
];

const TROUBLESHOOTING = [
  {
    id: "blocked",
    title: `The player says “${BLOCKED_COPY}”`,
    content:
      "Browsers only allow sound after someone has tapped or clicked the page, for example after it reloads or the device wakes up. Press the play button once and the music continues.",
  },
  {
    id: "silent",
    title: "It says Playing, but there is no sound",
    content:
      "Check that the radio isn't muted (the speaker button in the player bar), that the device volume is up, and that the right speakers, cable or Bluetooth device is connected. Trying another genre rules out a single track.",
  },
  {
    id: "network",
    title: "Connection lost",
    content:
      "The player tries again by itself for a short while, and music that already loaded may keep playing. Check the venue's internet connection, then press Retry.",
  },
  {
    id: "no-tracks",
    title: "A genre says No tracks yet",
    content: "No songs have been added to that genre yet. Choose another genre; it becomes playable as soon as music is added.",
  },
  {
    id: "session",
    title: "Your session has ended",
    content: "Sign-ins expire after a while for security. Press Log in again; your genre and volume are remembered.",
  },
  {
    id: "stopped",
    title: "The music stopped by itself",
    content: `${DEVICE_SLEEP_NOTE} When you're back, press play to continue.`,
  },
] as const;

const STEP_TITLES = ["Choose a genre", "Press play", "Hear your station voice"] as const;

/**
 * /help (03 shell): how the radio works, tips for venue speakers, the honest note about device sleep
 * and background tabs, troubleshooting, and how to reach the owner. Props-driven (dev previews).
 */
export function HelpView({ everyNTracks, hasRotation, hasWelcome, support, accountHref }: HelpViewProps) {
  const steps: readonly string[] = [
    "Tap a genre under Find your atmosphere to select it, or use its play button to start it straight away. Switch whenever you like.",
    "The big play button starts your station. It keeps playing while you move between Your radio, Account and Help; the bar at the bottom always controls it.",
    stationVoiceHelp({ everyNTracks, hasRotation, hasWelcome }),
  ];

  return (
    <div className="grid gap-6">
      <PageHeading eyebrow="Help" title="How your radio works" description="Everything you need to keep the music going." className="pb-0 lg:pb-2" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-5">
                {STEP_TITLES.map((title, index) => (
                  <li key={title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                    <span aria-hidden="true" className="row-span-2 text-sm font-semibold text-accent-text tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-semibold text-fg">{title}</h3>
                    <p className="text-sm text-fg-muted text-pretty">{steps[index]}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Troubleshooting</CardTitle>
              <CardDescription>Most problems are solved in a few seconds.</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <Accordion items={TROUBLESHOOTING} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Keep the music running</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="flex gap-3 text-sm text-fg-muted text-pretty">
                <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-muted" />
                <span>{DEVICE_SLEEP_NOTE}</span>
              </p>
              <p className="text-sm text-fg-muted text-pretty">
                You can ask this device to keep its screen awake while music plays, and turn keyboard shortcuts on or off, under{" "}
                <Link href={accountHref} className="rounded-sm font-medium text-accent-text underline-offset-4 hover:underline">
                  Account → Playback on this device
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tips for venue speakers</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-4">
                {TIPS.map((tip) => (
                  <li key={tip.title} className="flex gap-3">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-accent-text [&_svg]:size-5">
                      {tip.icon}
                    </span>
                    <span className="grid gap-0.5">
                      <span className="text-sm font-semibold text-fg">{tip.title}</span>
                      <span className="text-sm text-fg-muted text-pretty">{tip.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy aria-hidden="true" className="size-5 text-accent-text" />
                Contact
              </CardTitle>
              <CardDescription>Questions about your music, genres or announcements?</CardDescription>
            </CardHeader>
            <CardContent>
              <SupportContactDetails support={support} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
