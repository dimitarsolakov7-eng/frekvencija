import type { ReactNode } from "react";
import { CloudOff, LifeBuoy, PowerOff, Unlink } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { SignOutButton } from "@/components/player/SignOutButton";
import { venueInitial } from "@/components/player/player-view";
import { SupportContactDetails } from "@/components/player/SupportContactDetails";
import { Avatar, Card, SkipLink } from "@/components/ui";
import { PLATFORM_NAME } from "@/config/platform";
import type { SupportContact } from "@/lib/api/contracts";
import { RefreshButton } from "./RefreshButton";

export type VenueStatusVariant = "no-business" | "inactive" | "unavailable";

export interface VenueStatusScreenProps {
  variant: VenueStatusVariant;
  email: string;
  business?: { name: string; stationName: string } | null;
  /** The owner's contact details (platform settings); nulls when not configured. */
  support: SupportContact;
}

interface ScreenContent {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: ReactNode;
  retry: boolean;
}

function contentFor({ variant, email, business }: VenueStatusScreenProps): ScreenContent {
  switch (variant) {
    case "no-business":
      return {
        icon: <Unlink />,
        eyebrow: "Your account",
        title: "No venue is linked to this account",
        body: (
          <>
            You are signed in as <span className="font-medium break-all text-fg">{email}</span>, but this account is not
            connected to a venue yet. Ask your {PLATFORM_NAME} administrator to add you to your venue, then sign in again.
          </>
        ),
        retry: false,
      };
    case "inactive":
      return {
        icon: <PowerOff />,
        eyebrow: business?.stationName ?? "Your station",
        title: "This venue is not active yet — contact your administrator",
        body: (
          <>
            {business ? (
              <>
                <span className="font-medium text-fg">{business.stationName}</span> for {business.name} is switched off, so
                the radio can&apos;t play.
              </>
            ) : (
              "This venue is switched off, so the radio can't play."
            )}{" "}
            Your administrator can switch it on; sign in again afterwards.
          </>
        ),
        retry: false,
      };
    case "unavailable":
      return {
        icon: <CloudOff />,
        eyebrow: business?.stationName ?? "Your station",
        title: "We couldn't load your station",
        body: "This is usually a temporary connection problem. Try again in a moment; if it keeps happening, contact your administrator.",
        retry: true,
      };
  }
}

/**
 * Full-page explanation for venue accounts that cannot use the player (no venue linked, venue
 * inactive, station failed to load), with the owner's contact details and always a way out.
 */
export function VenueStatusScreen(props: VenueStatusScreenProps) {
  const content = contentFor(props);
  const { business, support } = props;
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <SkipLink />
      <header className="border-b border-border bg-sidebar pt-safe">
        <div className="flex h-16 items-center justify-between gap-4 px-page">
          <BrandLogo tone="ivory" size="md" priority />
          <SignOutButton variant="ghost" />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-page py-12 focus:outline-none sm:py-20"
      >
        <Card className="grid w-full max-w-xl gap-6 p-6 sm:p-10">
          <div className="flex items-center gap-4">
            {business && props.variant !== "no-business" ? (
              <Avatar name={business.name} initials={venueInitial(business.name)} size="xl" shape="rounded" decorative />
            ) : (
              <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-8">
                {content.icon}
              </span>
            )}
            <p className="eyebrow min-w-0 truncate text-fg-muted">{content.eyebrow}</p>
          </div>
          <div className="grid gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-fg text-balance sm:text-3xl">{content.title}</h1>
            <p className="text-fg-muted text-pretty">{content.body}</p>
          </div>
          <section aria-labelledby="venue-status-contact" className="grid gap-3 rounded-card border border-border bg-control p-4">
            <h2 id="venue-status-contact" className="flex items-center gap-2 text-sm font-semibold text-fg">
              <LifeBuoy aria-hidden="true" className="size-4 text-accent-text" />
              Contact
            </h2>
            <SupportContactDetails support={support} />
          </section>
          <div className="flex flex-wrap items-center gap-3">
            {content.retry && <RefreshButton />}
            <SignOutButton variant={content.retry ? "secondary" : "primary"} size="lg" />
          </div>
        </Card>
      </main>
    </div>
  );
}
