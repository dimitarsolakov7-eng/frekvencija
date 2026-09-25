import type { Metadata, Route } from "next";
import Link from "next/link";
import { CircleHelp, KeyRound, LayoutGrid, LogOut, Megaphone, Music, Pause, Radio, SkipForward, User, Volume2 } from "lucide-react";
import { AdminMobileMenu } from "@/components/admin/shell/AdminMobileMenu";
import {
  AppShell,
  MobileTabBar,
  MobileTopBar,
  PageHeading,
  SidebarBrand,
  SidebarButton,
  SidebarIdentity,
  SidebarNav,
  SidebarSection,
  UserMenu,
} from "@/components/shell";
import { Card, CoverImage, IconButton, ProgressBar, StatusPill } from "@/components/ui";

export const metadata: Metadata = {
  title: "App shell QA",
};

// Reads the toggles from the query string on every request.
export const dynamic = "force-dynamic";

type Flag = "player" | "tabs" | "topbar" | "long";

function flag(params: Record<string, string | string[] | undefined>, name: Flag, fallback: boolean): boolean {
  const value = params[name];
  if (value === undefined) return fallback;
  return (Array.isArray(value) ? value[0] : value) !== "0";
}

function toggleHref(current: Record<Flag, boolean>, name: Flag): Route {
  const next = { ...current, [name]: !current[name] };
  const query = (Object.keys(next) as Flag[]).map((key) => `${key}=${next[key] ? 1 : 0}`).join("&");
  return `/dev/ui/shell?${query}` as Route;
}

/** Placeholder with the geometry of the venue player bar (the real one lives in the player module). */
function SamplePlayerBar() {
  return (
    <Card className="flex items-center gap-3 p-3 sm:gap-4 sm:px-4" aria-label="Sample player bar" role="region">
      <CoverImage artworkKey="house" className="size-12 shrink-0 rounded-control sm:size-14" sizes="56px" />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="truncate font-semibold">Afterglow</p>
        <p className="truncate text-sm text-fg-muted">Frekvencija Sessions</p>
        <ProgressBar label="Track progress" value={34} size="sm" className="mt-1 max-w-md" />
      </div>
      <IconButton variant="primary" round aria-label="Pause" icon={<Pause />} />
      <IconButton aria-label="Skip" icon={<SkipForward />} />
      <IconButton className="hidden sm:inline-flex" aria-label="Mute" aria-pressed={false} icon={<Volume2 />} />
    </Card>
  );
}

export default async function AppShellQaPage({ searchParams }: PageProps<"/dev/ui/shell">) {
  const params = await searchParams;
  const flags: Record<Flag, boolean> = {
    player: flag(params, "player", true),
    tabs: flag(params, "tabs", true),
    topbar: flag(params, "topbar", true),
    long: flag(params, "long", true),
  };

  const navigation = (
    <SidebarNav
      label="Main"
      items={[
        { href: "/dev/ui/shell", label: "Your radio", icon: Radio, match: "exact" },
        { href: "/dev/ui", label: "UI gallery", icon: LayoutGrid, match: "exact" },
        { href: "/dev/ui/shell/nothing", label: "Announcements", icon: Megaphone },
      ]}
    />
  );

  return (
    <AppShell
      sidebar={
        <>
          <SidebarBrand href="/dev/ui/shell" />
          <SidebarIdentity name="EmeraldBar" initials="E" />
          {navigation}
          <SidebarSection>
            <SidebarButton href="/dev/ui/shell/help" label="Help" icon={CircleHelp} />
            <SidebarButton href="/dev/ui" match="exact" label="Back to the gallery" icon={LogOut} />
          </SidebarSection>
        </>
      }
      topBar={
        flags.topbar ? (
          <UserMenu
            name="Administrator"
            initials="A"
            email="admin@example.com"
            items={[
              { label: "Change password", href: "/dev/ui/shell", icon: KeyRound },
              { label: "UI gallery", href: "/dev/ui", icon: LayoutGrid },
            ]}
          />
        ) : undefined
      }
      mobileHeader={
        <MobileTopBar
          href="/dev/ui/shell"
          right={
            <AdminMobileMenu name="Administrator" email="admin@example.com">
              {navigation}
            </AdminMobileMenu>
          }
        />
      }
      mobileNav={
        flags.tabs ? (
          <MobileTabBar
            items={[
              { href: "/dev/ui/shell", label: "Radio", icon: Radio, match: "exact" },
              { href: "/dev/ui", label: "Gallery", icon: User, match: "exact" },
            ]}
          />
        ) : undefined
      }
      playerBar={flags.player ? <SamplePlayerBar /> : undefined}
    >
      <PageHeading
        eyebrow="Your station"
        title="EmeraldBar Radio"
        description="App shell QA: check at 1440, 768 and 390 px that nothing hides behind the bars. At 844×390 or 320×256 (400% zoom) the bars scroll with the page instead of staying pinned."
      />
      <nav aria-label="Shell toggles" className="mb-8 flex flex-wrap gap-2">
        {(Object.keys(flags) as Flag[]).map((name) => (
          <Link
            key={name}
            href={toggleHref(flags, name)}
            className="inline-flex h-11 items-center gap-2 rounded-control border border-border bg-control px-4 text-sm font-medium hover:border-border-strong"
          >
            <StatusPill tone={flags[name] ? "success" : "neutral"} size="sm">
              {flags[name] ? "On" : "Off"}
            </StatusPill>
            {name}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: flags.long ? 12 : 3 }, (_, index) => (
          <Card key={index} className="overflow-hidden">
            <CoverImage artworkKey={`card-${index}`} className="aspect-[5/2]" sizes="(max-width: 1024px) 50vw, 33vw" />
            <div className="grid gap-1 p-4">
              <p className="font-semibold">Genre card {index + 1}</p>
              <p className="text-sm text-fg-muted">Scroll to the end: the last card must stay reachable.</p>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 rounded-control border border-accent/40 bg-accent/10 p-4 text-sm">
        <Music aria-hidden="true" className="mr-2 inline size-4 text-accent-text" />
        End of content: this line must be fully visible above the player bar and tab bar.
      </p>
    </AppShell>
  );
}
