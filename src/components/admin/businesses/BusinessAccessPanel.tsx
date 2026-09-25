"use client";

import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Link2, Mail, Send, UserMinus, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  DropdownMenu,
  Field,
  FormMessage,
  Input,
  StatusPill,
  useToast,
  type ButtonProps,
  type DropdownMenuItem,
} from "@/components/ui";
import type { BusinessMember } from "@/lib/data/admin/businesses";
import { formatDateTime } from "@/lib/utils/format";
import { AccessLinkDialog } from "./AccessLinkDialog";
import { IDLE_STATE, type AccessLink, type BusinessDetailActions, type MemberAccessState } from "./action-types";
import type { BusinessStatusView } from "./business-status";

export interface BusinessAccessPanelProps {
  businessId: string;
  businessName: string;
  contactEmail: string | null;
  status: BusinessStatusView;
  members: readonly BusinessMember[];
  /** Why sign-in statuses are missing, or null. */
  statusNote: string | null;
  /** Why invitations cannot be sent at all (e.g. no secret key), or null. */
  invitesUnavailableReason: string | null;
  actions: Pick<BusinessDetailActions, "inviteMember" | "sendMemberAccess" | "removeMember">;
}

const INITIAL_INVITE_STATE: MemberAccessState = { ...IDLE_STATE, link: null };

type Delivery = "email" | "link";

function DeliveryButton({ delivery, disabled, children, ...props }: { delivery: Delivery } & Omit<ButtonProps, "type" | "name" | "value">) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("delivery") === delivery;
  return (
    <Button {...props} type="submit" name="delivery" value={delivery} disabled={disabled || pending} loading={mine}>
      {children}
    </Button>
  );
}

function InviteForm({
  businessId,
  contactEmail,
  hasMembers,
  onLink,
  disabled,
  inviteMember,
}: {
  businessId: string;
  contactEmail: string | null;
  hasMembers: boolean;
  onLink: (link: AccessLink) => void;
  disabled: boolean;
  inviteMember: BusinessDetailActions["inviteMember"];
}) {
  const [state, formAction] = useActionState(async (previous: MemberAccessState, formData: FormData) => {
    const result = await inviteMember(previous, formData);
    if (result.link) onLink(result.link);
    // The link lives only in the dialog; it is not kept in the form state.
    return { ...result, link: null };
  }, INITIAL_INVITE_STATE);

  const defaultEmail = state.ok ? "" : (state.values?.email ?? (hasMembers ? "" : (contactEmail ?? "")));

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="businessId" value={businessId} />
      <div key={state.nonce ?? 0}>
        <Field
          label="Invite by email address"
          hint="They choose their own password from the invitation. The business’s contact email is filled in when nobody has been invited yet."
          error={state.fieldErrors.email}
        >
          <Input
            type="email"
            name="email"
            required
            disabled={disabled}
            defaultValue={defaultEmail}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            placeholder="manager@venue.example"
          />
        </Field>
      </div>
      <div className="grid gap-2 @sm:grid-cols-2">
        <DeliveryButton delivery="email" disabled={disabled} icon={<Send aria-hidden="true" />}>
          Send invitation
        </DeliveryButton>
        <DeliveryButton delivery="link" variant="secondary" disabled={disabled} icon={<Link2 aria-hidden="true" />}>
          Create invite link
        </DeliveryButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

interface AccessLabels {
  email: string;
  link: string;
  emailIcon: ReactNode;
  successTitle: string;
}

function accessLabels(member: BusinessMember): AccessLabels | null {
  switch (member.status.access) {
    case "invite":
      return { email: "Resend invitation", link: "Create invite link", emailIcon: <Mail />, successTitle: "Invitation sent" };
    case "recovery":
      return { email: "Send password reset", link: "Create reset link", emailIcon: <KeyRound />, successTitle: "Password reset sent" };
    case null:
      // Status unknown: the server decides between invitation and reset. Blocked accounts get nothing.
      return member.status.kind === "unknown"
        ? { email: "Send access email", link: "Create access link", emailIcon: <Mail />, successTitle: "Email sent" }
        : null;
  }
}

function MemberRow({
  member,
  businessId,
  accessDisabled,
  onLink,
  onRemove,
  sendMemberAccess,
}: {
  member: BusinessMember;
  businessId: string;
  accessDisabled: boolean;
  onLink: (link: AccessLink) => void;
  onRemove: (member: BusinessMember) => void;
  sendMemberAccess: BusinessDetailActions["sendMemberAccess"];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const labels = accessLabels(member);

  function send(delivery: Delivery) {
    startTransition(async () => {
      const result = await sendMemberAccess(businessId, member.userId, delivery);
      if (result.link) onLink(result.link);
      else if (result.ok) toast.success(labels?.successTitle ?? "Done", { description: result.message ?? undefined });
      else toast.error(`Couldn’t help ${member.email} sign in`, { description: result.message ?? undefined });
    });
  }

  const items: DropdownMenuItem[] = [];
  if (labels) {
    items.push(
      { key: "email", label: labels.email, icon: labels.emailIcon, disabled: accessDisabled || pending, onSelect: () => send("email") },
      {
        key: "link",
        label: labels.link,
        icon: <Link2 />,
        description: "Shown once; deliver it privately",
        disabled: accessDisabled || pending,
        onSelect: () => send("link"),
      },
      { type: "separator", key: "separator" },
    );
  }
  items.push({ key: "remove", label: "Remove from venue…", icon: <UserMinus />, tone: "danger", onSelect: () => onRemove(member) });

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" aria-busy={pending || undefined}>
      <Avatar name={member.email} initials={member.email.slice(0, 1).toUpperCase()} tone="neutral" size="md" decorative />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-medium break-all text-fg">{member.email}</p>
        {member.fullName && <p className="text-sm text-fg-muted">{member.fullName}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <StatusPill tone={member.status.tone} label={member.status.label} size="sm" />
          {member.status.detail && <span>{member.status.detail}</span>}
        </div>
        <p className="text-xs text-fg-subtle">Added {formatDateTime(member.addedAt, { dateOnly: true })}</p>
      </div>
      <DropdownMenu label={`Access actions for ${member.email}`} items={items} className="shrink-0" />
    </li>
  );
}

/**
 * The Access tab (screen 06): who can sign in to play the venue's radio. Invite by email or with a
 * one-time link, resend invitations, send password resets (the server picks invitation vs reset
 * from the account's real state) and remove accounts from the venue. Admins never see passwords.
 */
export function BusinessAccessPanel({
  businessId,
  businessName,
  contactEmail,
  status,
  members,
  statusNote,
  invitesUnavailableReason,
  actions,
}: BusinessAccessPanelProps) {
  const toast = useToast();
  const [link, setLink] = useState<AccessLink | null>(null);
  const [removing, setRemoving] = useState<BusinessMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const headingId = useId();
  const invitesDisabled = invitesUnavailableReason !== null;

  async function confirmRemove(member: BusinessMember) {
    const result = await actions.removeMember(businessId, member.userId);
    if (result.ok) {
      setRemoving(null);
      setRemoveError(null);
      toast.success("Removed from the venue", { description: result.message ?? undefined });
    } else {
      setRemoveError(result.message ?? "The account could not be removed. Please try again.");
    }
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-5">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="text-lg font-semibold text-fg">
            Staff accounts
          </h3>
          <StatusPill tone={status.tone} label={status.label} size="sm" />
        </div>
        <p className="text-sm text-fg-muted">
          People who sign in to play {businessName}’s radio. Each account belongs to one venue; passwords are chosen by
          the business and never shown here. {status.detail}
        </p>
      </div>

      {invitesUnavailableReason && <Alert tone="warning" title="Invitations are unavailable" description={invitesUnavailableReason} />}
      {statusNote && !invitesDisabled && <Alert tone="info" description={statusNote} />}

      {members.length === 0 ? (
        <div className="flex items-start gap-3 rounded-control border border-dashed border-border-strong p-4 text-sm text-fg-muted">
          <Users aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>No staff account yet. Invite the venue’s contact so they can sign in and start the radio.</p>
        </div>
      ) : (
        <ul aria-label={`Staff accounts of ${businessName}`} className="divide-y divide-border">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              businessId={businessId}
              accessDisabled={invitesDisabled}
              onLink={setLink}
              onRemove={(target) => {
                setRemoveError(null);
                setRemoving(target);
              }}
              sendMemberAccess={actions.sendMemberAccess}
            />
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-border pt-5">
        <h4 className="text-base font-semibold text-fg">{members.length === 0 ? "Invite the contact" : "Invite someone else"}</h4>
        <InviteForm
          businessId={businessId}
          contactEmail={contactEmail}
          hasMembers={members.length > 0}
          onLink={setLink}
          disabled={invitesDisabled}
          inviteMember={actions.inviteMember}
        />
        <p className="text-xs text-fg-muted">
          Supabase’s built-in email service only reaches your Supabase team and sends about 2 emails an hour. Without
          custom SMTP, create an invite link and deliver it privately.
        </p>
      </div>

      <AccessLinkDialog link={link} onClose={() => setLink(null)} />
      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => (removing ? confirmRemove(removing) : undefined)}
        title={removing ? `Remove ${removing.email}?` : ""}
        description={`They can no longer play ${businessName}’s radio. Their account is not deleted: you can invite them to this or another venue later.`}
        confirmLabel="Remove"
      >
        {removeError ? <Alert tone="danger" description={removeError} /> : null}
      </ConfirmDialog>
    </section>
  );
}
