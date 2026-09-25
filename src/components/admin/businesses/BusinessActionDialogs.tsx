"use client";

import { createContext, useCallback, useContext, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { Eye, KeyRound, Megaphone, Power, PowerOff, Trash2 } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  useToast,
  type DropdownMenuItem,
} from "@/components/ui";
import type { BusinessDirectoryActions } from "./action-types";
import { useGuardedNavigation } from "./unsaved-changes";

/** The venue a row or detail menu acts on. */
export interface BusinessActionTarget {
  id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  memberEmails: readonly string[];
}

type OpenDialog =
  | { kind: "status"; target: BusinessActionTarget }
  | { kind: "reset"; target: BusinessActionTarget }
  | { kind: "delete"; target: BusinessActionTarget };

interface BusinessActionsApi {
  basePath: string;
  announcementsPath: string;
  /** Why invitations and resets can't be sent at all (no secret key), or null. */
  accessUnavailableReason: string | null;
  open: (dialog: OpenDialog) => void;
  detailHref: (id: string) => string;
  announcementsHref: (id: string) => string;
}

const BusinessActionsContext = createContext<BusinessActionsApi | null>(null);

function useBusinessActionsApi(): BusinessActionsApi {
  const api = useContext(BusinessActionsContext);
  if (!api) throw new Error("Business menus must be rendered inside <BusinessActionsProvider>.");
  return api;
}

/** The id in `${basePath}/<id>` (or "new"), from the current URL. */
export function selectedSegment(pathname: string | null, basePath: string): string | null {
  if (!pathname || !pathname.startsWith(`${basePath}/`)) return null;
  const segment = pathname.slice(basePath.length + 1).split("/")[0];
  return segment ? decodeURIComponent(segment) : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface BusinessActionsProviderProps {
  actions: BusinessDirectoryActions;
  /** "/admin/businesses" (or the preview route). */
  basePath: string;
  /** "/admin/announcements" — the venue is passed as ?business=<id>. */
  announcementsPath: string;
  accessUnavailableReason: string | null;
  children: ReactNode;
}

/**
 * Owns the confirmation dialogs behind the business menus (list rows and the detail panel):
 * activate/deactivate, send password reset and delete. Opening one from a DropdownMenu returns
 * focus to its "…" button when the dialog closes.
 */
export function BusinessActionsProvider({
  actions,
  basePath,
  announcementsPath,
  accessUnavailableReason,
  children,
}: BusinessActionsProviderProps) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, startDelete] = useTransition();
  const deleteFormId = useId();

  const open = useCallback((next: OpenDialog) => {
    setError(null);
    setTyped("");
    setDialog(next);
  }, []);

  const api = useMemo<BusinessActionsApi>(
    () => ({
      basePath,
      announcementsPath,
      accessUnavailableReason,
      open,
      detailHref: (id) => `${basePath}/${id}`,
      announcementsHref: (id) => `${announcementsPath}?business=${encodeURIComponent(id)}`,
    }),
    [basePath, announcementsPath, accessUnavailableReason, open],
  );

  function close() {
    if (deleting) return;
    setDialog(null);
  }

  async function confirmStatus(target: BusinessActionTarget) {
    const result = await actions.setBusinessActive(target.id, !target.isActive);
    if (result.ok) {
      setDialog(null);
      toast.success(target.isActive ? `${target.name} deactivated` : `${target.name} activated`, {
        description: result.message ?? undefined,
      });
    } else {
      setError(result.message ?? "The venue’s status could not be changed. Please try again.");
    }
  }

  async function confirmReset(target: BusinessActionTarget) {
    const result = await actions.sendBusinessPasswordReset(target.id);
    if (result.ok) {
      setDialog(null);
      toast.success("Password reset sent", { description: result.message ?? undefined });
    } else {
      setError(result.message ?? "The password reset could not be sent. Please try again.");
    }
  }

  function confirmDelete(target: BusinessActionTarget) {
    const matches = typed.trim().length > 0 && typed.trim() === target.name.trim();
    if (!matches || deleting) return;
    setError(null);
    startDelete(async () => {
      const result = await actions.deleteBusiness(target.id, typed);
      if (result.ok) {
        setDialog(null);
        toast.success(`${target.name} deleted`, { description: result.message ?? undefined });
        // The open venue is gone, with any unsaved edits to it: nothing to confirm before leaving.
        if (selectedSegment(pathname, basePath) === target.id) router.replace(basePath as Route);
      } else {
        setError(result.message ?? "The business could not be deleted. Please try again.");
      }
    });
  }

  const target = dialog?.target;
  const deleteMatches = target ? typed.trim().length > 0 && typed.trim() === target.name.trim() : false;

  return (
    <BusinessActionsContext.Provider value={api}>
      {children}

      <ConfirmDialog
        open={dialog?.kind === "status"}
        onCancel={close}
        onConfirm={() => (target ? confirmStatus(target) : undefined)}
        tone={target?.isActive ? "danger" : "primary"}
        confirmLabel={target?.isActive ? "Deactivate" : "Activate"}
        title={target ? (target.isActive ? `Deactivate ${target.name}?` : `Activate ${target.name}?`) : ""}
        description={
          target?.isActive
            ? "Players at the venue stop when the current song ends: new songs, announcements and media links are refused. Staff can still sign in and see that the venue is not active. Nothing is deleted, and you can activate it again at any time."
            : "Its staff can then start the radio with its genres and approved announcements."
        }
      >
        {error ? <Alert tone="danger" description={error} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "reset"}
        onCancel={close}
        onConfirm={() => (target ? confirmReset(target) : undefined)}
        tone="primary"
        confirmLabel="Send password reset"
        title={target ? `Send a password reset for ${target.name}?` : ""}
        description="Each staff account gets an email to choose a new password; an account that hasn’t accepted its invitation gets the invitation again. Passwords are managed securely by the business: you never see or set them."
      >
        <div className="grid gap-3">
          {target && target.memberEmails.length > 0 && (
            <div className="grid gap-1 text-sm">
              <p className="text-fg-muted">{target.memberEmails.length === 1 ? "Recipient" : "Recipients"}</p>
              <ul className="grid gap-0.5">
                {target.memberEmails.map((email) => (
                  <li key={email} className="font-medium break-all text-fg">
                    {email}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error ? <Alert tone="danger" description={error} /> : null}
        </div>
      </ConfirmDialog>

      <Dialog
        open={dialog?.kind === "delete"}
        onClose={close}
        dismissible={!deleting}
        title={target ? `Delete ${target.name}?` : ""}
        description="This permanently deletes the business and cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={deleteFormId}
              variant="danger"
              disabled={!deleteMatches}
              loading={deleting}
              icon={<Trash2 aria-hidden="true" />}
            >
              Delete business
            </Button>
          </>
        }
      >
        {target && (
          <form
            id={deleteFormId}
            onSubmit={(event) => {
              event.preventDefault();
              confirmDelete(target);
            }}
            className="grid gap-4"
          >
            <ul className="grid list-disc gap-1 pl-5 text-sm text-fg-muted">
              <li>
                {target.memberCount > 0
                  ? `Its players stop and its staff lose access. Their ${plural(target.memberCount, "account is", "accounts are")} kept, without a venue.`
                  : "Its players stop. It has no staff accounts."}
              </li>
              <li>Its announcements are deleted, with their audio files.</li>
              <li>Its logo, genre access and playback settings are deleted.</li>
            </ul>
            <Field label={`Type “${target.name}” to confirm`}>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.currentTarget.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={deleting}
              />
            </Field>
            {error && <Alert tone="danger" title="The business was not deleted" description={error} />}
          </form>
        )}
      </Dialog>
    </BusinessActionsContext.Provider>
  );
}

/**
 * The "…" menu items for a venue: Open, Manage announcements, Activate/Deactivate, Send password
 * reset, Delete. `includeOpen` is false inside the detail panel (the venue is already open).
 */
export function useBusinessMenuItems(target: BusinessActionTarget, options: { includeOpen?: boolean } = {}): DropdownMenuItem[] {
  const api = useBusinessActionsApi();
  const navigation = useGuardedNavigation();
  const resetDisabledReason =
    api.accessUnavailableReason ?? (target.memberCount === 0 ? "No staff account yet" : null);

  const items: DropdownMenuItem[] = [];
  if (options.includeOpen !== false) {
    items.push({ key: "open", label: "Open", icon: <Eye />, onSelect: () => void navigation.navigate(api.detailHref(target.id)) });
  }
  items.push(
    {
      key: "announcements",
      label: "Manage announcements",
      icon: <Megaphone />,
      onSelect: () => void navigation.navigate(api.announcementsHref(target.id)),
    },
    { type: "separator", key: "separator-1" },
    target.isActive
      ? { key: "status", label: "Deactivate", icon: <PowerOff />, onSelect: () => api.open({ kind: "status", target }) }
      : { key: "status", label: "Activate", icon: <Power />, onSelect: () => api.open({ kind: "status", target }) },
    {
      key: "reset",
      label: "Send password reset",
      icon: <KeyRound />,
      disabled: resetDisabledReason !== null,
      description: resetDisabledReason !== null ? resetDisabledReason : undefined,
      onSelect: () => api.open({ kind: "reset", target }),
    },
    { type: "separator", key: "separator-2" },
    { key: "delete", label: "Delete…", icon: <Trash2 />, tone: "danger", onSelect: () => api.open({ kind: "delete", target }) },
  );
  return items;
}

/** Opens the password-reset confirmation for a venue (the detail panel's "Send password reset" button). */
export function useBusinessDialogs() {
  const api = useBusinessActionsApi();
  return {
    openPasswordReset: (target: BusinessActionTarget) => api.open({ kind: "reset", target }),
    accessUnavailableReason: api.accessUnavailableReason,
    announcementsHref: api.announcementsHref,
    detailHref: api.detailHref,
    basePath: api.basePath,
  };
}

