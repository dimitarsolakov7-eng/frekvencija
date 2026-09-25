"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createToastLayer, type ToastLayer } from "./internal/toast-layer";

export type ToastTone = "neutral" | "success" | "error" | "warning" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /**
   * Auto-dismiss delay in ms (paused while hovered or focused). `null` keeps the toast until the
   * user dismisses it. Defaults: 5 s, errors 8 s.
   */
  durationMs?: number | null;
  /** One follow-up action, e.g. { label: "Undo", onClick }. Clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
}

type ToastShortcutOptions = Omit<ToastOptions, "title" | "tone">;

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show(options: ToastOptions): string;
  success(title: string, options?: ToastShortcutOptions): string;
  error(title: string, options?: ToastShortcutOptions): string;
  warning(title: string, options?: ToastShortcutOptions): string;
  info(title: string, options?: ToastShortcutOptions): string;
  dismiss(id: string): void;
}

interface ToastRecord extends Omit<ToastOptions, "durationMs"> {
  id: string;
  tone: ToastTone;
  durationMs: number | null;
}

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATION_MS = 5000;
const ERROR_DURATION_MS = 8000;

const ToastContext = createContext<ToastApi | null>(null);

const TONES: Record<ToastTone, { icon: LucideIcon; iconColor: string }> = {
  neutral: { icon: Info, iconColor: "text-fg-muted" },
  info: { icon: Info, iconColor: "text-info" },
  success: { icon: CircleCheck, iconColor: "text-success" },
  warning: { icon: TriangleAlert, iconColor: "text-warning" },
  error: { icon: CircleAlert, iconColor: "text-danger" },
};

/** What a screen reader announces for a toast: the title, then the description. */
export function toastAnnouncement({ title, description }: Pick<ToastOptions, "title" | "description">): string {
  const head = title.trim();
  const tail = description?.trim() ?? "";
  if (!tail) return head;
  if (!head) return tail;
  return /[.!?…:]$/.test(head) ? `${head} ${tail}` : `${head}. ${tail}`;
}

const subscribeToNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * The provider's toast layer (see internal/toast-layer.ts), created on the client only and attached
 * to the document while the provider is mounted. The portal target stays null on the server and
 * during hydration, because a portal cannot be hydrated.
 */
function useToastLayer(): { layer: ToastLayer | null; portalTarget: HTMLElement | null } {
  const hydrated = useSyncExternalStore(subscribeToNothing, clientSnapshot, serverSnapshot);
  const [layer] = useState<ToastLayer | null>(() => (typeof document === "undefined" ? null : createToastLayer()));
  useLayoutEffect(() => layer?.attach(), [layer]);
  return { layer, portalTarget: hydrated && layer ? layer.container : null };
}

/**
 * Hosts transient notifications for the whole app (mounted once in the root layout).
 *
 * The list renders into a layer outside the page: while a modal <Dialog>/<Drawer> is open it moves
 * inside the topmost one (everything else is inert) and, with the Popover API, sits in the top layer
 * above it and its backdrop, so toasts stay visible, operable and in the accessibility tree. Each
 * toast is announced through the layer's polite live region shortly after it appears.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(0);
  const { layer, portalTarget } = useToastLayer();

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      nextIdRef.current += 1;
      const id = `toast-${nextIdRef.current}`;
      const tone = options.tone ?? "neutral";
      const durationMs =
        options.durationMs === undefined ? (tone === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS) : options.durationMs;
      setToasts((current) => [...current, { ...options, id, tone, durationMs }].slice(-MAX_VISIBLE_TOASTS));
      layer?.announce(toastAnnouncement(options));
      return id;
    },
    [layer],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, options) => show({ ...options, title, tone: "success" }),
      error: (title, options) => show({ ...options, title, tone: "error" }),
      warning: (title, options) => show({ ...options, title, tone: "warning" }),
      info: (title, options) => show({ ...options, title, tone: "info" }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {portalTarget &&
        createPortal(
          // Not a live region itself: the layer announces each toast once (see toastAnnouncement).
          <section
            aria-label="Notifications"
            className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:justify-end"
          >
            <ol className="flex w-full max-w-sm flex-col gap-2">
              {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
              ))}
            </ol>
          </section>,
          portalTarget,
        )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remainingMsRef = useRef(toast.durationMs);
  const { icon: ToneIcon, iconColor } = TONES[toast.tone];

  useEffect(() => {
    const remaining = remainingMsRef.current;
    if (remaining === null || paused) return;
    const startedAt = Date.now();
    const handle = window.setTimeout(() => onDismiss(toast.id), remaining);
    return () => {
      window.clearTimeout(handle);
      remainingMsRef.current = Math.max(0, remaining - (Date.now() - startedAt));
    };
  }, [paused, toast.id, onDismiss]);

  function handleBlur(event: FocusEvent<HTMLLIElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
  }

  return (
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={handleBlur}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-card border border-border bg-surface-2 p-4",
        "text-sm shadow-overlay motion-safe:animate-toast-in",
      )}
    >
      <ToneIcon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", iconColor)} />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-medium text-fg">{toast.title}</p>
        {toast.description && <p className="text-fg-muted text-pretty">{toast.description}</p>}
        {toast.action && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              className="rounded-control text-sm font-medium text-accent-text underline-offset-4 hover:underline"
            >
              {toast.action.label}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

/** Access the app-wide toast API. Must be used below <ToastProvider> (mounted in the root layout). */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() must be used inside <ToastProvider> (see src/app/layout.tsx).");
  return api;
}
