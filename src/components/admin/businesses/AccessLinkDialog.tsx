"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Button, Dialog, Field, Input } from "@/components/ui";
import type { AccessLink } from "./action-types";

export interface AccessLinkDialogProps {
  /** The link to show; null closes the dialog. Once closed, the link is gone from the page. */
  link: AccessLink | null;
  onClose: () => void;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * Shows a one-time invite/reset link exactly once, with a copy button and a warning to deliver it
 * privately. The owner clears the link on close, so it cannot be shown again.
 */
export function AccessLinkDialog({ link, onClose }: AccessLinkDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Tagged with the URL so a new link never inherits the previous one's "Copied" state.
  const [copy, setCopy] = useState<{ url: string; state: CopyState } | null>(null);
  const copyState: CopyState = link && copy?.url === link.url ? copy.state : "idle";

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopy({ url, state: "copied" });
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopy({ url, state: "failed" });
    }
  }

  const isInvite = link?.type !== "recovery";
  const purpose = isInvite ? "accept the invitation and choose a password" : "choose a new password";

  return (
    <Dialog
      open={link !== null}
      onClose={onClose}
      size="lg"
      title={isInvite ? "One-time invite link" : "One-time password reset link"}
      description={link ? `For ${link.email}. This is the only time the link is shown — copy it now.` : undefined}
      footer={
        link ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
            <Button
              icon={copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              onClick={() => void copyLink(link.url)}
            >
              {copyState === "copied" ? "Copied" : "Copy link"}
            </Button>
          </>
        ) : undefined
      }
    >
      {link ? (
        <div className="grid gap-4">
          <Alert
            tone="warning"
            title="Deliver it privately"
            description={`Anyone who opens this link can ${purpose} for ${link.email}. Give it only to that person — in person or in a direct message, never in a group chat or a shared document. It works once and expires after a while (1 hour unless your Supabase settings say otherwise).`}
          />
          <Field label="Link" hint="The recipient opens it, presses Continue, and then chooses their password.">
            <Input
              ref={inputRef}
              readOnly
              value={link.url}
              onFocus={(event) => event.currentTarget.select()}
              spellCheck={false}
              className="font-mono text-sm"
            />
          </Field>
          <p aria-live="polite" className="text-sm text-fg-muted">
            {copyState === "copied"
              ? "Link copied to the clipboard."
              : copyState === "failed"
                ? "The link couldn’t be copied automatically. It is selected — press Ctrl+C (⌘C on a Mac) to copy it."
                : ""}
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}
