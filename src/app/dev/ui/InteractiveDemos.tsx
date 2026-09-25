"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Copy, Pause, Pencil, Play, Power, Save, Trash, Volume2, VolumeX } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Drawer,
  DropdownMenu,
  Field,
  FileDropzone,
  FormMessage,
  IconButton,
  Input,
  PasswordInput,
  SearchInput,
  Select,
  Slider,
  SubmitButton,
  Switch,
  Textarea,
  useToast,
  type DrawerSide,
} from "@/components/ui";
import { fileMatchesAccept, formatBytes } from "@/lib/utils";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function ToggleButtonsDemo() {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton
        variant="primary"
        size="xl"
        round
        aria-label={playing ? "Pause" : "Play"}
        icon={playing ? <Pause /> : <Play />}
        onClick={() => setPlaying((value) => !value)}
      />
      <IconButton
        size="lg"
        variant="secondary"
        aria-label="Mute"
        aria-pressed={muted}
        icon={muted ? <VolumeX /> : <Volume2 />}
        onClick={() => setMuted((value) => !value)}
      />
      <span className="text-sm text-fg-muted">
        Play/Pause changes its label; Mute keeps its label and toggles <code>aria-pressed</code> ({String(muted)}).
      </span>
    </div>
  );
}

export function LoadingButtonDemo() {
  const [saving, setSaving] = useState(false);
  return (
    <Button
      icon={<Save aria-hidden="true" />}
      loading={saving}
      loadingText="Saving…"
      onClick={async () => {
        setSaving(true);
        await wait(1500);
        setSaving(false);
      }}
    >
      Click to load
    </Button>
  );
}

export function SwitchDemo() {
  const [autoplay, setAutoplay] = useState(true);
  return (
    <div className="grid max-w-md gap-5">
      <Switch
        label="Keyboard shortcuts"
        description="Space/K play-pause, M mute, N skip."
        checked={autoplay}
        onCheckedChange={setAutoplay}
      />
      <Switch label="Uncontrolled, on by default" defaultChecked />
      <Switch label="Disabled" description="Cannot be changed." disabled />
      <div className="flex items-center gap-3">
        <Switch aria-label="Standalone switch with aria-label" />
        <span className="text-sm text-fg-muted">Standalone (named by aria-label)</span>
      </div>
    </div>
  );
}

export function SliderDemo() {
  const [volume, setVolume] = useState(80);
  return (
    <div className="grid max-w-md gap-5">
      <Slider label="Volume" value={volume} onValueChange={setVolume} formatValue={(value) => `${value}%`} />
      <Slider label="Announce every N tracks" min={1} max={12} defaultValue={4} />
      <Slider label="Announcement volume" defaultValue={70} disabled formatValue={(value) => `${value}%`} />
      <div className="flex items-center gap-3">
        <Volume2 aria-hidden="true" className="size-5 text-fg-muted" />
        <Slider label="Hidden-label volume" hideLabel showValue={false} defaultValue={40} className="flex-1" />
      </div>
    </div>
  );
}

const MP3_ACCEPT = ".mp3,audio/mpeg";
const MAX_TRACK_BYTES = 50 * 1024 * 1024;

interface PickedFile {
  name: string;
  size: number;
  problem: string | null;
}

export function DropzoneDemo() {
  const [picked, setPicked] = useState<PickedFile[]>([]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid gap-3">
        <FileDropzone
          label="Choose MP3 files"
          hint="MP3 audio"
          accept={MP3_ACCEPT}
          multiple
          maxSizeBytes={MAX_TRACK_BYTES}
          onFiles={(files) =>
            setPicked(
              files.map((file) => ({
                name: file.name,
                size: file.size,
                problem: !fileMatchesAccept(file, MP3_ACCEPT)
                  ? "Not an MP3 file"
                  : file.size > MAX_TRACK_BYTES
                    ? `Larger than ${formatBytes(MAX_TRACK_BYTES)}`
                    : null,
              })),
            )
          }
        />
        {picked.length > 0 && (
          <ul className="grid gap-2 text-sm">
            {picked.map((file, index) => (
              <li key={`${index}-${file.name}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{file.name}</span>
                {file.problem ? (
                  <Badge tone="danger">{file.problem}</Badge>
                ) : (
                  <Badge tone="success">{formatBytes(file.size)}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <FileDropzone label="Upload a logo" hint="PNG, JPEG or WebP" maxSizeBytes={2 * 1024 * 1024} disabled onFiles={() => {}} />
    </div>
  );
}

interface DemoFormState {
  ok: boolean;
  message: string;
  fieldErrors?: { stationName?: string[] };
  values?: { stationName?: string; notes?: string };
}

async function saveDemoSettings(_previous: DemoFormState, formData: FormData): Promise<DemoFormState> {
  await wait(1200);
  const stationName = String(formData.get("stationName") ?? "").trim();
  const notes = String(formData.get("notes") ?? "");
  const announcements = formData.get("announcements") === "on";
  if (!stationName) {
    return {
      ok: false,
      message: "Please fix the highlighted field.",
      fieldErrors: { stationName: ["Enter a station name."] },
      values: { stationName, notes },
    };
  }
  return {
    ok: true,
    message: `Saved “${stationName}” with announcements ${announcements ? "on" : "off"} (demo only — nothing was stored).`,
    values: { stationName, notes },
  };
}

export function FormDemo() {
  const [state, formAction] = useActionState(saveDemoSettings, { ok: false, message: "" });
  return (
    <form action={formAction} noValidate className="grid max-w-lg gap-4">
      <Field
        label="Station name"
        required
        hint="Leave it empty and save to see a field error."
        error={state.fieldErrors?.stationName}
      >
        <Input name="stationName" defaultValue={state.values?.stationName} autoComplete="off" />
      </Field>
      <Field label="Notes" optional>
        <Textarea name="notes" defaultValue={state.values?.notes} rows={3} />
      </Field>
      <Switch name="announcements" label="Play announcements" defaultChecked />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…" icon={<Save aria-hidden="true" />}>
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}

export function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => toast.success("Track uploaded", { description: "“Evening Jazz 04” is now live." })}>
        Success
      </Button>
      <Button variant="secondary" onClick={() => toast.error("Upload failed", { description: "The file is not a valid MP3." })}>
        Error
      </Button>
      <Button variant="secondary" onClick={() => toast.warning("Announcement needs review")}>
        Warning
      </Button>
      <Button variant="secondary" onClick={() => toast.info("Genre list refreshed")}>
        Info
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.show({
            title: "Genre disabled",
            description: "Stays until dismissed.",
            durationMs: null,
            action: { label: "Undo", onClick: () => toast.success("Genre re-enabled") },
          })
        }
      >
        Persistent with action
      </Button>
    </div>
  );
}

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Rename genre"
        description="Businesses see the new name the next time they open the player."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                toast.success("Genre renamed (demo)");
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Genre name">
          <Input defaultValue="Evening Jazz" />
        </Field>
      </Dialog>
    </>
  );
}

export function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function removeTrack() {
    setError(null);
    await wait(1200);
    if (simulateFailure) {
      setError("The track could not be removed: the server did not respond. Nothing was changed.");
      return;
    }
    setOpen(false);
    toast.success("Track removed (demo)");
  }

  return (
    <div className="grid gap-3">
      <Checkbox
        label="Simulate a failure"
        checked={simulateFailure}
        onChange={(event) => setSimulateFailure(event.currentTarget.checked)}
      />
      <div>
        <Button
          variant="danger"
          icon={<Trash aria-hidden="true" />}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Remove track…
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={removeTrack}
        title="Remove “Evening Jazz 04”?"
        description="It stops playing at every venue. The file is kept so it can be restored."
        confirmLabel="Remove track"
      >
        {error && <Alert tone="danger" title="Not removed" description={error} />}
      </ConfirmDialog>
    </div>
  );
}

export function SearchDemo() {
  const [query, setQuery] = useState("House");
  return (
    <div className="grid max-w-md gap-3">
      <SearchInput
        label="Search tracks or artists"
        placeholder="Search tracks or artists"
        value={query}
        onValueChange={setQuery}
      />
      <p className="text-sm text-fg-muted" aria-live="polite">
        Controlled value: <code className="font-mono text-fg">{JSON.stringify(query)}</code>
      </p>
      <SearchInput label="Search businesses" placeholder="Search businesses (uncontrolled)" defaultValue="" />
    </div>
  );
}

export function PasswordDemo() {
  return (
    <form className="grid max-w-md gap-4" onSubmit={(event) => event.preventDefault()}>
      <Field label="Password" hint="Press Enter: the password is hidden again before submitting.">
        <PasswordInput name="password" autoComplete="current-password" defaultValue="correct horse battery" />
      </Field>
      <Field label="Disabled">
        <PasswordInput disabled defaultValue="secret" />
      </Field>
    </form>
  );
}

const DRAWER_SIDES: readonly DrawerSide[] = ["right", "left", "bottom"];

export function DrawerDemo() {
  const [side, setSide] = useState<DrawerSide | null>(null);
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      {DRAWER_SIDES.map((value) => (
        <Button key={value} variant="secondary" onClick={() => setSide(value)}>
          Open {value} drawer
        </Button>
      ))}
      <Drawer
        open={side !== null}
        onClose={() => setSide(null)}
        side={side ?? "right"}
        title="Edit track"
        description="Changes are saved only when you press Save changes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSide(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setSide(null);
                toast.success("Saved (demo)");
              }}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Title">
            <Input defaultValue="Afterglow" />
          </Field>
          <Field label="Artist">
            <Input defaultValue="Frekvencija Sessions" />
          </Field>
          <Field label="Genre">
            <Select defaultValue="house">
              <option value="house">House</option>
              <option value="lounge">Lounge</option>
            </Select>
          </Field>
        </div>
      </Drawer>
    </div>
  );
}

/**
 * Regression check for toasts over modals (review finding A11Y-05). The drawer stays open while
 * toasts appear: they must paint above the backdrop, be clickable and reachable with Tab inside the
 * drawer (Undo, Dismiss), and be announced, including the toast fired as the nested confirm closes.
 */
export function ToastOverModalDemo() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  async function deactivate() {
    await wait(600);
    // Same tick: the confirm dialog closes while the drawer stays open.
    setConfirming(false);
    toast.success("Genre deactivated", { description: "Venues no longer see it. Its tracks are kept." });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open “Edit genre” drawer
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Edit genre"
        description="Results appear as toasts while this drawer stays open."
      >
        <div className="grid gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              toast.error("Could not activate the genre", { description: "The server did not respond. Nothing was changed." })
            }
          >
            Activate genre (server error)
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.show({
                title: "Genre renamed",
                description: "Stays until dismissed.",
                durationMs: null,
                action: { label: "Undo", onClick: () => toast.info("Rename undone") },
              })
            }
          >
            Rename (toast with Undo)
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Deactivate genre…
          </Button>
        </div>
        <ConfirmDialog
          open={confirming}
          onCancel={() => setConfirming(false)}
          onConfirm={deactivate}
          title="Deactivate “House”?"
          description="Venues stop seeing it. Its tracks and audio files are kept."
          confirmLabel="Deactivate"
        />
      </Drawer>
    </>
  );
}

export function DropdownMenuDemo() {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <DropdownMenu
        label="Actions for Afterglow"
        items={[
          { label: "Edit details", icon: Pencil, onSelect: () => setRenaming(true) },
          { label: "Duplicate", icon: Copy, onSelect: () => toast.info("Duplicated (demo)") },
          { label: "Disable", icon: Power, disabled: true, description: "Already disabled elsewhere" },
          { type: "separator" },
          { label: "Remove from playback", icon: Trash, tone: "danger", onSelect: () => toast.warning("Removed (demo)") },
        ]}
      />
      <DropdownMenu
        label="Sort, newest first"
        trigger={<span>Sort: newest</span>}
        triggerVariant="secondary"
        align="start"
        items={[
          { label: "Newest first", onSelect: () => toast.info("Newest first") },
          { label: "Oldest first", onSelect: () => toast.info("Oldest first") },
          { label: "Title A–Z", onSelect: () => toast.info("Title A–Z") },
        ]}
      />
      <span className="text-sm text-fg-muted">
        “Edit details” opens a dialog; closing it must return focus to the “…” button.
      </span>
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Edit details"
        footer={<Button onClick={() => setRenaming(false)}>Done</Button>}
      >
        <Field label="Title">
          <Input defaultValue="Afterglow" />
        </Field>
      </Dialog>
    </div>
  );
}

/**
 * Regression check for the Dialog focus fix: the dialog's owner unmounts it while it is open; focus
 * must still return to the button that opened it.
 */
export function UnmountFocusDemo() {
  const [mounted, setMounted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mounted) return;
    const started = Date.now();
    const handle = window.setInterval(() => {
      const left = 3 - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(handle);
        setMounted(false);
      } else {
        setSeconds(left);
      }
    }, 250);
    return () => window.clearInterval(handle);
  }, [mounted]);

  return (
    <div className="grid gap-3">
      <div>
        <Button
          ref={openerRef}
          variant="secondary"
          onClick={() => {
            setSeconds(3);
            setMounted(true);
          }}
        >
          Open, then unmount while open
        </Button>
      </div>
      {mounted && (
        <Dialog open onClose={() => setMounted(false)} title="This dialog unmounts itself">
          <p className="text-sm text-fg-muted" aria-live="polite">
            Removing it from the page in {seconds} s. Focus should land back on the button.
          </p>
        </Dialog>
      )}
    </div>
  );
}
