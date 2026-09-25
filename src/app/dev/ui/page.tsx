import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  CircleHelp,
  CloudUpload,
  KeyRound,
  LayoutGrid,
  ListMusic,
  LogOut,
  Megaphone,
  Music,
  Plus,
  Radio,
  Settings,
  Upload,
  User,
} from "lucide-react";
import { BrandEmblem, BrandLogo, EqualizerBars, PlatformMark, StationLogo } from "@/components/brand";
import {
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
import {
  Accordion,
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CoverImage,
  DropdownMenu,
  EmptyState,
  Field,
  GENRE_CHIP_TONES,
  GenreChip,
  GenreDot,
  IconButton,
  Input,
  Kbd,
  NavTabs,
  PageHeader,
  ProgressBar,
  SegmentedTabs,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Table,
  Tabs,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  VisuallyHidden,
  Waveform,
  type AlertTone,
  type BadgeTone,
  type ButtonSize,
  type ButtonVariant,
  type StatusPillTone,
} from "@/components/ui";
import { formatBytes, formatDateTime, formatDuration, initials } from "@/lib/utils";
import {
  ConfirmDialogDemo,
  DialogDemo,
  DrawerDemo,
  DropdownMenuDemo,
  DropzoneDemo,
  FormDemo,
  LoadingButtonDemo,
  PasswordDemo,
  SearchDemo,
  SliderDemo,
  SwitchDemo,
  ToastDemo,
  ToastOverModalDemo,
  ToggleButtonsDemo,
  UnmountFocusDemo,
} from "./InteractiveDemos";

export const metadata: Metadata = {
  title: "UI gallery",
};

const SECTIONS = [
  { id: "tokens", title: "Tokens" },
  { id: "type", title: "Typography" },
  { id: "brand", title: "Brand" },
  { id: "buttons", title: "Buttons" },
  { id: "forms", title: "Forms" },
  { id: "labels", title: "Pills & avatars" },
  { id: "media", title: "Media" },
  { id: "feedback", title: "Feedback" },
  { id: "overlays", title: "Overlays" },
  { id: "navigation", title: "Navigation" },
  { id: "data", title: "Data" },
  { id: "shell", title: "Shell" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const SWATCHES: readonly { name: string; className: string }[] = [
  { name: "canvas", className: "bg-canvas" },
  { name: "sidebar", className: "bg-sidebar" },
  { name: "surface", className: "bg-surface" },
  { name: "surface-2", className: "bg-surface-2" },
  { name: "surface-3", className: "bg-surface-3" },
  { name: "control", className: "bg-control" },
  { name: "border", className: "bg-border" },
  { name: "border-strong", className: "bg-border-strong" },
  { name: "border-input", className: "bg-border-input" },
  { name: "border-input-hover", className: "bg-border-input-hover" },
  { name: "fg", className: "bg-fg" },
  { name: "fg-muted", className: "bg-fg-muted" },
  { name: "fg-subtle", className: "bg-fg-subtle" },
  { name: "accent", className: "bg-accent" },
  { name: "accent-hover", className: "bg-accent-hover" },
  { name: "accent-text", className: "bg-accent-text" },
  { name: "accent-fg", className: "bg-accent-fg" },
  { name: "success", className: "bg-success" },
  { name: "warning", className: "bg-warning" },
  { name: "danger", className: "bg-danger" },
  { name: "danger-solid", className: "bg-danger-solid" },
  { name: "info", className: "bg-info" },
  { name: "ring", className: "bg-ring" },
];

const BUTTON_VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "outline", "ghost", "danger"];
const BUTTON_SIZES: readonly ButtonSize[] = ["sm", "md", "lg", "xl"];
const BADGE_TONES: readonly BadgeTone[] = ["neutral", "accent", "success", "warning", "danger", "info"];
const ALERT_TONES: readonly AlertTone[] = ["neutral", "info", "success", "warning", "danger"];
const PILL_TONES: readonly { tone: StatusPillTone; label: string }[] = [
  { tone: "success", label: "Active" },
  { tone: "warning", label: "Invited" },
  { tone: "neutral", label: "Draft" },
  { tone: "danger", label: "Failed" },
  { tone: "info", label: "Ready for review" },
];
const GENRES = [
  { slug: "house", name: "House" },
  { slug: "deep-house", name: "Deep House" },
  { slug: "lounge", name: "Lounge" },
  { slug: "jazz", name: "Jazz" },
  { slug: "balkan-hits", name: "Balkan Hits" },
  { slug: "chillout", name: "Chillout" },
] as const;

const DEMO_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#0f3d2e"/><circle cx="60" cy="60" r="34" fill="none" stroke="#34d399" stroke-width="8"/><text x="60" y="70" font-family="sans-serif" font-size="30" font-weight="700" fill="#ecfdf5" text-anchor="middle">EB</text></svg>',
  );

const SAMPLE_TRACKS = [
  { id: "t1", title: "Afterglow", artist: "Frekvencija Sessions", genres: ["house"], duration: 248, status: "Active" },
  { id: "t2", title: "Slow Motion", artist: "Frekvencija Sessions", genres: ["deep-house", "lounge"], duration: 312, status: "Active" },
  { id: "t3", title: "Midnight Notes (a very long demo title that needs room)", artist: "Unknown Artist", genres: ["jazz"], duration: 222, status: "Disabled" },
  { id: "t4", title: "Blue Horizon", artist: "Frekvencija Sessions", genres: [], duration: 328, status: "Removed" },
] as const;

const TRACK_STATUS_TONE: Record<(typeof SAMPLE_TRACKS)[number]["status"], StatusPillTone> = {
  Active: "success",
  Disabled: "neutral",
  Removed: "danger",
};

function genreName(slug: string): string {
  return GENRES.find((genre) => genre.slug === slug)?.name ?? slug;
}

function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 gap-6 border-t border-border pt-10">
      <h2 id={`${id}-title`} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demo({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-3 text-sm font-medium text-fg-muted">{title}</h3>
      {children}
    </div>
  );
}

export default function UiGalleryPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-6xl gap-10 px-page py-10 focus:outline-none">
      <PageHeader
        eyebrow="Developer tools"
        title="UI gallery"
        description="Every primitive and shell piece in its states, for visual and accessibility QA at 1440, 768 and 390 px. Development only."
        breadcrumbs={[{ label: "Start", href: "/" }, { label: "Developer tools" }, { label: "UI gallery" }]}
        actions={
          <>
            <Badge tone="warning" dot>
              Development only
            </Badge>
            <ButtonLink href="/dev/ui/shell" variant="secondary" iconRight={<ArrowRight aria-hidden="true" />}>
              Live app shell
            </ButtonLink>
          </>
        }
      >
        <nav aria-label="Gallery sections">
          <ul className="flex flex-wrap gap-2">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex h-9 items-center rounded-full border border-border px-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>

      <Section id="tokens" title="Tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {SWATCHES.map((swatch) => (
            <li key={swatch.name} className="grid gap-2">
              <span className={`h-14 rounded-control border border-border ${swatch.className}`} />
              <code className="font-mono text-xs text-fg-muted">{swatch.name}</code>
            </li>
          ))}
        </ul>
        <Demo title="Radii and surfaces: rounded-card (12px) and rounded-control (10px)">
          <div className="flex flex-wrap gap-4">
            <div className="grid h-24 w-40 place-items-center rounded-card border border-border bg-surface text-sm text-fg-muted shadow-card">
              card · 12px
            </div>
            <div className="grid h-11 w-40 place-items-center rounded-control border border-border-input bg-control text-sm text-fg-muted">
              control · 10px
            </div>
            <div className="grid h-24 w-40 place-items-center rounded-card border border-border bg-sidebar text-sm text-fg-muted">
              sidebar
            </div>
          </div>
        </Demo>
      </Section>

      <Section id="type" title="Typography">
        <div className="grid gap-4">
          <p className="eyebrow text-fg-muted">Your station · eyebrow</p>
          <p className="hero-title text-fg">
            Your place. Your sound. <span className="text-accent-text">Your radio.</span>
          </p>
          <p className="page-title text-fg">EmeraldBar Radio · page-title</p>
          <p className="section-title text-fg">Find your atmosphere · section-title</p>
          <p className="text-base">Body 16px · the quick brown fox plays jazz at the hotel bar.</p>
          <p className="text-sm text-fg-muted">Supporting 14px · secondary information and hints.</p>
          <p className="text-xs text-fg-subtle">Small label 12px · fine print.</p>
          <p className="text-accent-text">Accent text · links and highlights.</p>
          <p className="font-mono text-sm">Mono · 3:35 · 12.5 MB</p>
        </div>
      </Section>

      <Section id="brand" title="Brand">
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="BrandLogo (ivory: sm / md / lg / xl) and BrandEmblem">
            <div className="flex flex-wrap items-end gap-6">
              <BrandLogo size="sm" />
              <BrandLogo />
              <BrandLogo size="lg" />
              <BrandEmblem className="size-10" label="Frekvencija" />
            </div>
          </Demo>
          <Demo title="Legacy PlatformMark">
            <div className="flex flex-wrap items-center gap-6">
              <PlatformMark size="sm" />
              <PlatformMark />
              <PlatformMark iconOnly />
            </div>
          </Demo>
          <Demo title="EqualizerBars (static when paused or with reduced motion)">
            <div className="flex items-end gap-6">
              <EqualizerBars playing size="sm" />
              <EqualizerBars playing />
              <EqualizerBars playing size="lg" label="Now playing" />
              <EqualizerBars playing={false} size="lg" />
            </div>
          </Demo>
          <Demo title="StationLogo: monogram, image, broken URL falling back">
            <div className="flex flex-wrap items-end gap-4">
              <StationLogo name="Hotel Aurora" size="sm" />
              <StationLogo name="Hotel Aurora" size="md" />
              <StationLogo name="EmeraldBar" src={DEMO_LOGO} size="lg" />
              <StationLogo name="Broken Logo Bar" src="/dev-missing-logo.png" size="lg" />
            </div>
          </Demo>
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <Demo title="Variants × sizes (sm 36 · md 44 · lg 48 · xl 64)">
          <div className="grid gap-4">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-3">
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {variant} {size}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Demo>
        <Demo title="States">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" icon={<Plus aria-hidden="true" />}>
              Upload music
            </Button>
            <Button variant="secondary" icon={<Music aria-hidden="true" />}>
              Manage tracks
            </Button>
            <Button variant="outline">Save settings</Button>
            <Button variant="secondary" iconRight={<ArrowRight aria-hidden="true" />}>
              Icon right
            </Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <LoadingButtonDemo />
            <ButtonLink href="/" variant="outline">
              ButtonLink
            </ButtonLink>
          </div>
        </Demo>
        <Demo title="IconButton (variants, sizes, round, loading, disabled)">
          <div className="flex flex-wrap items-center gap-3">
            {BUTTON_VARIANTS.map((variant) => (
              <IconButton key={variant} variant={variant} aria-label={`Settings (${variant})`} icon={<Settings />} />
            ))}
            <IconButton size="sm" aria-label="Small" icon={<Settings />} />
            <IconButton size="lg" variant="secondary" aria-label="Large" icon={<Settings />} />
            <IconButton size="lg" round variant="outline" aria-label="Round" icon={<Settings />} />
            <IconButton loading variant="secondary" aria-label="Loading" icon={<Settings />} />
            <IconButton disabled variant="secondary" aria-label="Disabled" icon={<Settings />} />
          </div>
        </Demo>
        <Demo title="Toggle patterns">
          <ToggleButtonsDemo />
        </Demo>
      </Section>

      <Section id="forms" title="Forms">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="grid gap-5">
            <Field label="Station name" hint="Shown on the venue player.">
              <Input placeholder="EmeraldBar Radio" />
            </Field>
            <Field label="Contact email" error="Enter a valid email address." required>
              <Input type="email" defaultValue="not-an-email" />
            </Field>
            <Field
              label="Pronunciation spelling"
              optional
              labelAside={
                <a className="text-sm text-accent-text hover:underline" href="#forms">
                  Help
                </a>
              }
            >
              <Input placeholder="Emerald Bar" />
            </Field>
            <Field label="Disabled">
              <Input disabled defaultValue="Cannot edit" />
            </Field>
            <Field label="Read-only">
              <Input readOnly defaultValue="Read-only value" />
            </Field>
          </div>
          <div className="grid gap-5">
            <Field label="Announcement text" hint="Up to 500 characters.">
              <Textarea defaultValue="You’re listening to EmeraldBar Radio." />
            </Field>
            <Field label="Language">
              <Select defaultValue="en">
                <option value="en">English</option>
                <option value="bg">Bulgarian</option>
                <option value="de">German</option>
              </Select>
            </Field>
            <Field label="Genre (leading dot)">
              <Select defaultValue="house" leading={<GenreDot genreKey="house" />}>
                {GENRES.map((genre) => (
                  <option key={genre.slug} value={genre.slug}>
                    {genre.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" error={["Choose a status.", "Inactive venues cannot play music."]}>
              <Select placeholder="All statuses">
                <option value="active">Active</option>
              </Select>
            </Field>
          </div>
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="SearchInput (controlled with clear button; uncontrolled)">
            <SearchDemo />
          </Demo>
          <Demo title="PasswordInput (show/hide with aria-pressed)">
            <PasswordDemo />
          </Demo>
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="Checkbox (plain)">
            <div className="grid gap-3">
              <Checkbox label="Available to all businesses" defaultChecked />
              <Checkbox label="Enabled" description="Disabled genres are invisible to venues." />
              <Checkbox label="Disabled checkbox" disabled />
            </div>
          </Demo>
          <Demo title="Checkbox (tile) — genre access grid">
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <legend className="sr-only">Genre access</legend>
              {GENRES.map((genre, index) => (
                <Checkbox key={genre.slug} variant="tile" label={genre.name} defaultChecked={index !== 4} />
              ))}
            </fieldset>
          </Demo>
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="Switch">
            <SwitchDemo />
          </Demo>
          <Demo title="Slider">
            <SliderDemo />
          </Demo>
        </div>
        <Demo title="FileDropzone (validates dropped files in the caller)">
          <DropzoneDemo />
        </Demo>
        <Demo title="Server-action style form: SubmitButton, Field errors, FormMessage">
          <FormDemo />
        </Demo>
      </Section>

      <Section id="labels" title="Pills & avatars">
        <Demo title="StatusPill (md / sm)">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {PILL_TONES.map((pill) => (
                <StatusPill key={pill.tone} tone={pill.tone}>
                  {pill.label}
                </StatusPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PILL_TONES.map((pill) => (
                <StatusPill key={pill.tone} tone={pill.tone} size="sm" label={pill.label} />
              ))}
            </div>
          </div>
        </Demo>
        <Demo title="GenreChip (tone derived from the genre key) and every tone">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {GENRES.map((genre) => (
                <GenreChip key={genre.slug} genreKey={genre.slug} name={genre.name} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {GENRE_CHIP_TONES.map((tone) => (
                <GenreChip key={tone} tone={tone} size="sm">
                  {tone}
                </GenreChip>
              ))}
            </div>
          </div>
        </Demo>
        <Demo title="Badge">
          <div className="flex flex-wrap items-center gap-2">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
            {BADGE_TONES.map((tone) => (
              <Badge key={`${tone}-dot`} tone={tone} dot>
                {tone}
              </Badge>
            ))}
          </div>
        </Demo>
        <Demo title="Avatar (sizes; accent / neutral / auto tones; image; broken image)">
          <div className="flex flex-wrap items-end gap-4">
            <Avatar name="Administrator" initials="A" size="xs" />
            <Avatar name="Administrator" initials="A" size="sm" />
            <Avatar name="EmeraldBar" size="md" />
            <Avatar name="Hotel Aurora" size="lg" tone="neutral" />
            <Avatar name="EmeraldBar" size="xl" src={DEMO_LOGO} />
            <Avatar name="Broken Image Bar" size="lg" src="/dev-missing-avatar.png" />
            {["EmeraldBar", "Hotel Aurora", "Café Central", "Restaurant Olive"].map((name) => (
              <Avatar key={name} name={name} initials={initials(name).slice(0, 1)} tone="auto" shape="rounded" />
            ))}
          </div>
        </Demo>
      </Section>

      <Section id="media" title="Media">
        <div className="grid gap-6 md:grid-cols-3">
          {GENRES.slice(0, 3).map((genre) => (
            <Card key={genre.slug} className="overflow-hidden">
              <CoverImage artworkKey={genre.slug} className="aspect-[5/2]" sizes="(max-width: 768px) 100vw, 33vw" />
              <CardContent className="py-4">
                <p className="font-semibold">{genre.name}</p>
                <p className="text-sm text-fg-muted">Default artwork for “{genre.slug}”</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Demo title="CoverImage with overlay=“left” and content (now-playing hero)">
            <CoverImage artworkKey="house" overlay="left" className="aspect-[16/9] rounded-card border border-border" priority>
              <div className="flex h-full flex-col justify-center gap-2 p-6 sm:p-8">
                <p className="eyebrow text-fg-muted">Now playing</p>
                <p className="page-title">House</p>
                <p className="text-lg font-semibold">Afterglow</p>
                <p className="text-fg-muted">Frekvencija Sessions</p>
              </div>
            </CoverImage>
          </Demo>
          <Demo title="Broken cover URL falls back to the artwork; overlay=“bottom”">
            <CoverImage
              src="https://example.invalid/expired-signed-url.jpg"
              artworkKey="lounge"
              overlay
              className="aspect-[16/9] rounded-card border border-border"
            >
              <div className="flex h-full items-end p-5">
                <p className="text-lg font-semibold">Lounge</p>
              </div>
            </CoverImage>
          </Demo>
        </div>
        <Demo title="Waveform (decorative): voice card, compact icon, preview with progress">
          <div className="grid gap-4">
            <Waveform bars={36} seed="station-voice" className="h-7 w-56" />
            <Waveform bars={5} seed="icon" className="h-8 w-8" />
            <Card variant="inset" className="flex items-center gap-4 p-3">
              <IconButton variant="primary" round aria-label="Play preview" icon={<AudioLines />} />
              <Waveform bars={90} seed="preview" progress={0.35} className="h-10 flex-1" />
              <span className="text-sm text-fg-muted tabular-nums">0:02 / 0:06</span>
            </Card>
          </div>
        </Demo>
      </Section>

      <Section id="feedback" title="Feedback">
        <Demo title="Alert">
          <div className="grid gap-3">
            {ALERT_TONES.map((tone) => (
              <Alert
                key={tone}
                tone={tone}
                title={`${tone[0].toUpperCase()}${tone.slice(1)} alert`}
                description="Explains what happened and what to do next."
                action={
                  tone === "danger" ? (
                    <Button size="sm" variant="secondary">
                      Retry
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </Demo>
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="Spinner">
            <div className="flex items-center gap-4 text-accent-text">
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" label="Loading tracks" />
            </div>
          </Demo>
          <Demo title="Skeleton">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </Demo>
        </div>
        <Demo title="ProgressBar (upload queue)">
          <div className="grid max-w-lg gap-5">
            <ProgressBar label="Uploading evening-session.mp3" value={68} showLabel showValue />
            <ProgressBar label="Upload size" value={3.2} max={12} showLabel showValue valueText="3.2 MB of 12 MB" />
            <ProgressBar label="Validating" showLabel />
            <ProgressBar label="Failed upload" value={70} tone="danger" size="sm" />
          </div>
        </Demo>
        <Demo title="Toast">
          <ToastDemo />
        </Demo>
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<ListMusic />}
            title="No music available yet."
            description="Upload MP3 files and assign them to a genre to make it playable."
            action={
              <Button icon={<Upload aria-hidden="true" />} size="sm">
                Upload music
              </Button>
            }
          />
          <EmptyState
            icon={<Megaphone />}
            title="No results"
            description="No tracks match these filters."
            action={
              <Button variant="secondary" size="sm">
                Clear filters
              </Button>
            }
          />
        </div>
      </Section>

      <Section id="overlays" title="Overlays">
        <div className="flex flex-wrap items-start gap-8">
          <Demo title="Dialog">
            <DialogDemo />
          </Demo>
          <Demo title="ConfirmDialog (async confirm)">
            <ConfirmDialogDemo />
          </Demo>
          <Demo title="Dialog unmounted while open (focus returns)">
            <UnmountFocusDemo />
          </Demo>
        </div>
        <Demo title="Drawer (side sheet for mobile editors)">
          <DrawerDemo />
        </Demo>
        <Demo title="Toasts while a drawer stays open (above the backdrop, operable, announced)">
          <ToastOverModalDemo />
        </Demo>
        <Demo title="DropdownMenu (↓/↑/Home/End, typeahead, Escape, Tab, outside click)">
          <DropdownMenuDemo />
        </Demo>
      </Section>

      <Section id="navigation" title="Navigation">
        <Demo title="Tabs (arrow keys, Home/End; third tab disabled)">
          <Tabs
            label="Music library views"
            items={[
              { value: "all", label: "All tracks", content: <p className="text-fg-muted">All tracks panel.</p> },
              { value: "uploads", label: "Uploads", content: <p className="text-fg-muted">Uploads panel.</p> },
              { value: "archive", label: "Archive", content: null, disabled: true },
            ]}
          />
        </Demo>
        <Demo title="SegmentedTabs (screen 07)">
          <SegmentedTabs
            label="Announcement source"
            items={[
              {
                value: "generate",
                label: "Generate voice",
                icon: <AudioLines />,
                content: <p className="text-fg-muted">Create an announcement with a generated voice.</p>,
              },
              {
                value: "upload",
                label: "Upload recording",
                icon: <CloudUpload />,
                content: <p className="text-fg-muted">Upload your own MP3 recording.</p>,
              },
            ]}
          />
        </Demo>
        <Demo title="NavTabs (aria-current on the active route)">
          <NavTabs
            label="Developer tools"
            items={[
              { href: "/dev/ui", label: "UI gallery" },
              { href: "/dev/ui/shell", label: "App shell" },
            ]}
          />
        </Demo>
        <Demo title="Breadcrumbs">
          <Breadcrumbs
            items={[{ label: "Businesses", href: "/dev/ui" }, { label: "EmeraldBar", href: "/dev/ui" }, { label: "Announcements" }]}
          />
        </Demo>
        <Demo title="Accordion (native details/summary; exclusive)">
          <Accordion
            exclusive
            items={[
              { id: "faq-music", title: "Can I change the music?", content: "Choose another genre whenever you like.", defaultOpen: true },
              {
                id: "faq-name",
                title: "Will my business name be announced?",
                content: "Your station can play approved recordings with your business name between songs.",
              },
              {
                id: "faq-equipment",
                title: "Do I need special equipment?",
                content:
                  "Use a supported browser on a device connected to your venue’s sound system and an internet connection.",
              },
            ]}
          />
        </Demo>
        <Demo title="Card (default, selected, inset)">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader actions={<Button size="sm" variant="secondary">Edit</Button>}>
                <CardTitle as="h3">Selected track</CardTitle>
                <CardDescription>Default card.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-muted">Card content goes here.</p>
              </CardContent>
              <CardFooter>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
                <Button size="sm">Save changes</Button>
              </CardFooter>
            </Card>
            <Card variant="selected" className="p-5">
              <p className="font-semibold">House</p>
              <p className="text-sm text-fg-muted">Selected card (emerald hairline).</p>
            </Card>
            <Card variant="inset" className="p-5">
              <p className="font-semibold">evening-session.mp3</p>
              <p className="text-sm text-fg-muted">Inset card (queue row).</p>
            </Card>
          </div>
        </Demo>
      </Section>

      <Section id="data" title="Data">
        <Table caption="Sample tracks (screen 05 styling)">
          <THead>
            <TR>
              <TH className="w-12">
                <VisuallyHidden>Select</VisuallyHidden>
              </TH>
              <TH>Track</TH>
              <TH>Genres</TH>
              <TH numeric>Duration</TH>
              <TH>Status</TH>
              <TH className="w-14">
                <VisuallyHidden>Actions</VisuallyHidden>
              </TH>
            </TR>
          </THead>
          <TBody>
            {SAMPLE_TRACKS.map((track, index) => (
              <TR key={track.id} selected={index === 0}>
                <TD>
                  <input
                    type="checkbox"
                    aria-label={`Select ${track.title}`}
                    defaultChecked={index === 0}
                    className="size-5 accent-accent"
                  />
                </TD>
                <TD>
                  <div className="flex min-w-64 items-center gap-3">
                    <CoverImage
                      artworkKey={track.genres[0] ?? track.id}
                      className="size-12 shrink-0 rounded-control"
                      sizes="48px"
                    />
                    <div className="grid min-w-0">
                      <span className="truncate font-semibold text-fg">{track.title}</span>
                      <span className="truncate text-fg-muted">{track.artist}</span>
                    </div>
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1.5">
                    {track.genres.length === 0 ? (
                      <span className="text-fg-subtle">No genre</span>
                    ) : (
                      track.genres.map((slug) => <GenreChip key={slug} genreKey={slug} name={genreName(slug)} />)
                    )}
                  </div>
                </TD>
                <TD numeric>{formatDuration(track.duration)}</TD>
                <TD>
                  <StatusPill tone={TRACK_STATUS_TONE[track.status]}>{track.status}</StatusPill>
                </TD>
                <TD>
                  <DropdownMenu
                    label={`Actions for ${track.title}`}
                    items={[
                      { label: "Edit details", href: "/dev/ui#data" },
                      { label: "Open library", href: "/dev/ui#data" },
                    ]}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="-mt-3 text-sm text-fg-muted">{SAMPLE_TRACKS.length} tracks</p>
        <div className="grid gap-8 md:grid-cols-2">
          <Demo title="Kbd">
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <Kbd>Space</Kbd> or <Kbd>K</Kbd> play/pause · <Kbd>M</Kbd> mute · <Kbd>N</Kbd> skip
            </p>
          </Demo>
          <Demo title="Formatting helpers">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-fg-muted">formatDuration(3725)</dt>
              <dd className="font-mono">{formatDuration(3725)}</dd>
              <dt className="text-fg-muted">formatBytes(13107200)</dt>
              <dd className="font-mono">{formatBytes(13_107_200)}</dd>
              <dt className="text-fg-muted">formatDateTime(…)</dt>
              <dd className="font-mono">{formatDateTime("2026-09-25T14:03:00Z")}</dd>
              <dt className="text-fg-muted">initials(&quot;Hotel Aurora&quot;)</dt>
              <dd className="font-mono">{initials("Hotel Aurora")}</dd>
            </dl>
          </Demo>
        </div>
      </Section>

      <Section id="shell" title="Shell">
        <p className="text-fg-muted">
          Pieces of <code className="font-mono text-fg">@/components/shell</code>. The{" "}
          <Link href="/dev/ui/shell" className="text-accent-text underline-offset-4 hover:underline">
            live app shell
          </Link>{" "}
          checks sticky bars, player overlap and safe areas at real viewport sizes.
        </p>
        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <Demo title="Sidebar (240px)">
            <div className="flex h-[40rem] w-60 flex-col rounded-card border border-border bg-sidebar">
              <SidebarBrand href="/dev/ui" eyebrow="Admin workspace" />
              <SidebarIdentity name="EmeraldBar" subtitle="EmeraldBar Radio" className="border-b border-border pt-0" />
              <SidebarNav
                label="Gallery sample navigation"
                className="pt-4"
                items={[
                  { href: "/dev/ui", label: "Music library", icon: Music },
                  { href: "/dev/ui/nothing-here", label: "Genres", icon: LayoutGrid },
                  { href: "/dev/ui/also-nothing", label: "Announcements", icon: Megaphone },
                ]}
              />
              <SidebarSection>
                <SidebarButton href="/dev/ui/help-sample" label="Help" icon={CircleHelp} />
                <SidebarButton label="Sign out (demo button)" icon={LogOut} />
              </SidebarSection>
            </div>
          </Demo>
          <div className="grid content-start gap-8">
            <Demo title="PageHeading">
              <div className="rounded-card border border-border p-6">
                <PageHeading
                  as="h2"
                  eyebrow="Your station"
                  title="EmeraldBar Radio"
                  description="Choose the sound for your space."
                  actions={
                    <Button size="lg" icon={<Plus aria-hidden="true" />}>
                      Upload music
                    </Button>
                  }
                  className="pb-0!"
                />
              </div>
            </Demo>
            <Demo title="UserMenu (desktop top-right; compact on phones)">
              <div className="flex flex-wrap items-center gap-6">
                <UserMenu
                  name="Administrator"
                  initials="A"
                  email="admin@example.com"
                  items={[
                    { label: "Settings", href: "/dev/ui#shell", icon: Settings },
                    { label: "Change password", href: "/dev/ui#shell", icon: KeyRound },
                  ]}
                />
                <UserMenu
                  compact
                  name="EmeraldBar"
                  email="manager@emeraldbar.example"
                  items={[{ label: "Account", href: "/dev/ui#shell", icon: User }]}
                />
              </div>
            </Demo>
            <Demo title="MobileTopBar + MobileTabBar (390px frame)">
              <div className="w-full max-w-[390px] overflow-hidden rounded-card border border-border">
                <div className="border-b border-border bg-sidebar">
                  <MobileTopBar
                    href="/dev/ui"
                    right={<Avatar name="EmeraldBar" initials="E" size="md" decorative />}
                  />
                </div>
                <div className="grid h-40 place-items-center bg-canvas text-sm text-fg-muted">page content</div>
                <div className="border-t border-border bg-sidebar">
                  <MobileTabBar
                    label="Gallery sample tabs"
                    items={[
                      { href: "/dev/ui", label: "Radio", icon: Radio },
                      { href: "/dev/ui/account-sample", label: "Account", icon: User },
                    ]}
                  />
                </div>
              </div>
            </Demo>
          </div>
        </div>
      </Section>
    </main>
  );
}
