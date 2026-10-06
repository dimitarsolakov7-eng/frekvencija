"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { Route } from "next";
import Link from "next/link";
import { Building2, Inbox, Mail, Phone } from "lucide-react";
import { useConfirmDiscard, useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  FormMessage,
  StatusPill,
  Textarea,
  useToast,
} from "@/components/ui";
import type { AccessRequestCounts, AccessRequestItem } from "@/lib/data/admin/access-requests";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { AccessRequestFilter } from "@/lib/validation/access-requests";
import {
  isNotesDirty,
  markNotesSaved,
  newNotesDraft,
  notesNeedRebase,
  orphanedStatusProblems,
  rebaseNotesDraft,
  requestCardKey,
  setNotesValue,
  STATUS_CHANGE_DISCARD_LABEL,
  statusChangeDiscardMessage,
  statusChangeLeavesList,
  statusProblemOf,
  statusProblemsForFilter,
  takeSavedNotes,
  unsavedNotesMessage,
  withStatusProblem,
  type NotesDraft,
  type StatusProblem,
  type StatusProblems,
  type StatusProblemState,
} from "./access-request-cards";
import {
  ACCESS_REQUEST_STATUS_LABELS,
  ACCESS_REQUEST_STATUS_ORDER,
  ACCESS_REQUEST_STATUS_TONES,
  accessRequestActions,
  createFromRequestHref,
  isOpenAccessRequestStatus,
  type AccessRequestStatus,
} from "./access-request-rules";
import { IDLE_STATE, type AccessRequestActions, type AccessRequestNotesState } from "./action-types";
import { businessTypeLabel, lastFormString } from "./business-form";
import { useFocusAfterFailure, useRestoreFocusAfterPending } from "./form-focus";

export interface AccessRequestsViewProps {
  requests: readonly AccessRequestItem[];
  counts: AccessRequestCounts | null;
  filter: AccessRequestFilter;
  truncated: boolean;
  /** "/admin/businesses" (the add form is `${basePath}/new?fromRequest=<id>`). */
  basePath: string;
  /** This page, for the filter links. */
  requestsPath: string;
  actions: AccessRequestActions;
  /**
   * Failed status changes to start with, by request id (the development preview's conflict view
   * shows them; normally none). Ids not in `requests` are shown above the list.
   */
  initialProblems?: StatusProblems;
}

const MAX_NOTES = 2000;
const numberFormat = new Intl.NumberFormat("en-US");

function filterHref(requestsPath: string, filter: AccessRequestFilter): Route {
  return (filter === "all" ? requestsPath : `${requestsPath}?status=${filter}`) as Route;
}

function StatusFilter({ requestsPath, filter, counts }: { requestsPath: string; filter: AccessRequestFilter; counts: AccessRequestCounts | null }) {
  const options: { value: AccessRequestFilter; label: string; count: number | null }[] = [
    { value: "all", label: "All", count: counts?.all ?? null },
    ...ACCESS_REQUEST_STATUS_ORDER.map((status) => ({
      value: status,
      label: ACCESS_REQUEST_STATUS_LABELS[status],
      count: counts ? counts[status] : null,
    })),
  ];
  return (
    <nav aria-label="Filter requests by status">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const current = option.value === filter;
          return (
            <li key={option.value}>
              <Link
                href={filterHref(requestsPath, option.value)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                  current
                    ? "border-accent/45 bg-accent/15 text-fg"
                    : "border-border bg-control text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {option.label}
                {option.count !== null && <span className="text-xs tabular-nums text-fg-muted">{numberFormat.format(option.count)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Private notes on a request. The card stays mounted (keyed by the request id), so the "Notes saved."
 * message stays in its polite live region (A11Y-08) and nothing typed is thrown away when the list
 * refreshes. The field shows the card's notes draft: untouched notes follow newer saved ones (another
 * admin's save), typed notes are kept. Submitted from onSubmit, so React does not reset the form.
 */
function NotesForm({
  request,
  draft,
  onDraftChange,
  saveNotes,
}: {
  request: AccessRequestItem;
  draft: NotesDraft;
  onDraftChange: Dispatch<SetStateAction<NotesDraft>>;
  saveNotes: AccessRequestActions["saveAccessRequestNotes"];
}) {
  const [state, formAction, pending] = useActionState(async (previous: AccessRequestNotesState, formData: FormData) => {
    const submitted = lastFormString(formData, "adminNotes");
    const result = await saveNotes(previous, formData);
    if (result.ok) onDraftChange((current) => markNotesSaved(current, submitted));
    return result;
  }, { ...IDLE_STATE } as AccessRequestNotesState);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useFocusAfterFailure(state, formRef, messageRef);
  useRestoreFocusAfterPending(pending, submitRef);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  function takeSaved() {
    onDraftChange(takeSavedNotes);
    // The notice (and its button) goes away: continue in the field.
    fieldRef.current?.focus();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-busy={pending || undefined} className="grid gap-2">
      <input type="hidden" name="requestId" value={request.id} />
      {/* A polite live region that is always present, so the notice is announced when it appears. */}
      <div aria-live="polite" className={draft.changedElsewhere ? undefined : "sr-only"}>
        {draft.changedElsewhere && (
          <Alert
            role="none"
            tone="warning"
            title="Notes changed elsewhere while you were editing"
            description="Someone saved other notes on this request since you started typing. Your text is kept: saving replaces theirs."
            action={
              <Button variant="secondary" size="sm" onClick={takeSaved}>
                Use the saved notes
              </Button>
            }
          />
        )}
      </div>
      <Field
        id={`${id}notes`}
        label="Notes"
        hint={`Private to admins. ${numberFormat.format(draft.value.length)} / ${numberFormat.format(MAX_NOTES)}`}
        error={state.fieldErrors.adminNotes}
        optional
      >
        <Textarea
          ref={fieldRef}
          name="adminNotes"
          rows={2}
          maxLength={MAX_NOTES}
          value={draft.value}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onDraftChange((current) => setNotesValue(current, value));
          }}
          placeholder="e.g. Called on Monday, wants a demo."
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={submitRef} type="submit" variant="secondary" size="sm" loading={pending} loadingText="Saving…">
          Save notes
        </Button>
        <div ref={messageRef} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}

/**
 * One request. Keyed by the request id only (requestCardKey), so it stays mounted across the refresh
 * after each save. Its failed status change comes from the list (`problem`), never from state of its
 * own: the refresh can take the card out of the list, and the list still shows the problem then.
 */
function RequestCard({
  request,
  basePath,
  actions,
  problem,
  onProblem,
  leavesList,
}: {
  request: AccessRequestItem;
  basePath: string;
  actions: AccessRequestActions;
  /** Why the last status change of this request failed, or null. */
  problem: string | null;
  onProblem: (requestId: string, problem: StatusProblem | null) => void;
  /** A status change takes the request out of this (filtered) list. */
  leavesList: boolean;
}) {
  const toast = useToast();
  const confirmDiscard = useConfirmDiscard();
  const [pending, startStatusChange] = useTransition();
  const [running, setRunning] = useState<AccessRequestStatus | null>(null);
  const [settled, setSettled] = useState(0);
  const [notes, setNotes] = useState(() => newNotesDraft(request.adminNotes));
  // Newer saved notes (the list was refreshed): merge them in without losing what the admin typed.
  if (notesNeedRebase(notes, request.adminNotes)) setNotes(rebaseNotesDraft(notes, request.adminNotes));
  const notesDirty = isNotesDirty(notes);
  useUnsavedChangesGuard(notesDirty, { message: unsavedNotesMessage(request.businessName) });
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const open = isOpenAccessRequestStatus(request.status);

  // The status buttons are disabled while a change runs, which drops focus: bring it back to the
  // problem when there is one, else to the card's heading.
  useEffect(() => {
    if (settled === 0) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (problem ? problemRef.current : headingRef.current)?.focus();
  }, [settled, problem]);

  async function change(status: AccessRequestStatus) {
    if (pending) return;
    // The card is about to leave this list, and the notes typed on it with it.
    if (
      leavesList &&
      notesDirty &&
      !(await confirmDiscard({
        message: statusChangeDiscardMessage(request.businessName),
        confirmLabel: STATUS_CHANGE_DISCARD_LABEL,
      }))
    ) {
      return;
    }
    onProblem(request.id, null);
    setRunning(status);
    startStatusChange(async () => {
      const result = await actions.updateAccessRequestStatus(request.id, request.status, status);
      setRunning(null);
      if (result.ok) {
        toast.success(ACCESS_REQUEST_STATUS_LABELS[status], { description: result.message ?? undefined });
      } else {
        onProblem(request.id, {
          businessName: request.businessName,
          message: result.message ?? "The request could not be updated. Please try again.",
        });
      }
      setSettled((count) => count + 1);
    });
  }

  return (
    <li>
      <article aria-labelledby={headingId}>
      <Card className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg focus:outline-none">
              {request.businessName}
            </h2>
            <p className="text-sm text-fg-muted">
              {businessTypeLabel(request.businessType)} · Received <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time>
            </p>
          </div>
          <StatusPill tone={ACCESS_REQUEST_STATUS_TONES[request.status]} label={ACCESS_REQUEST_STATUS_LABELS[request.status]} />
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div className="grid gap-0.5">
            <dt className="text-fg-muted">Contact</dt>
            <dd className="font-medium break-words text-fg">{request.contactName}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-fg-muted">Email</dt>
            <dd className="min-w-0">
              <a href={`mailto:${request.email}`} className="inline-flex max-w-full items-center gap-1.5 rounded-sm break-all text-accent-text underline-offset-4 hover:underline">
                <Mail aria-hidden="true" className="size-4 shrink-0" />
                {request.email}
              </a>
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-fg-muted">Phone</dt>
            <dd>
              {request.phone ? (
                <a href={`tel:${request.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 rounded-sm text-accent-text underline-offset-4 hover:underline">
                  <Phone aria-hidden="true" className="size-4 shrink-0" />
                  {request.phone}
                </a>
              ) : (
                <span className="text-fg-subtle">Not given</span>
              )}
            </dd>
          </div>
          <div className="grid gap-0.5 sm:col-span-3">
            <dt className="text-fg-muted">Message</dt>
            <dd className={cn("whitespace-pre-line text-pretty", request.message ? "text-fg" : "text-fg-subtle")}>
              {request.message ?? "No message."}
            </dd>
          </div>
        </dl>

        <NotesForm request={request} draft={notes} onDraftChange={setNotes} saveNotes={actions.saveAccessRequestNotes} />

        {/* Always present, so a failed status change (e.g. someone else changed it first) is announced. */}
        <div
          ref={problemRef}
          tabIndex={-1}
          aria-live="polite"
          aria-atomic="true"
          className={cn("focus:outline-none", !problem && "sr-only")}
        >
          {problem && <Alert role="none" tone="danger" title="The status was not changed" description={problem} />}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {open && (
            <ButtonLink href={createFromRequestHref(basePath, request.id) as Route} size="sm" icon={<Building2 aria-hidden="true" />}>
              Create business from request
            </ButtonLink>
          )}
          {accessRequestActions(request.status).map((option) => (
            <Button
              key={option.status}
              size="sm"
              variant={option.emphasis === "quiet" ? "ghost" : "secondary"}
              loading={running === option.status}
              disabled={pending}
              onClick={() => void change(option.status)}
            >
              {option.label}
            </Button>
          ))}
          {request.handledAt && (
            <p className="w-full text-xs text-fg-subtle sm:ml-auto sm:w-auto">
              Last handled {formatDateTime(request.handledAt)}
              {request.handledByEmail ? ` by ${request.handledByEmail}` : ""}
            </p>
          )}
        </div>
      </Card>
      </article>
    </li>
  );
}

/**
 * /admin/businesses/requests: access requests from the public form, newest first, filterable by
 * status, each as a labelled card with its contact details, message, private notes and status
 * actions. Nothing is approved automatically; "Create business from request" opens a prefilled
 * add form, and creating the business marks the request approved.
 */
export function AccessRequestsView({
  requests,
  counts,
  filter,
  truncated,
  basePath,
  requestsPath,
  actions,
  initialProblems,
}: AccessRequestsViewProps) {
  // Status-change failures live here, not in the cards: when the refresh after a conflict moves the
  // request out of the current filter, its card is gone but the message is still shown (REQ-01).
  const [problemState, setProblemState] = useState<StatusProblemState>(() => ({ filter, problems: initialProblems ?? {} }));
  // Another filter is another list: earlier problems belong to the list they happened in.
  const current = statusProblemsForFilter(problemState, filter);
  if (current !== problemState) setProblemState(current);
  const problems = current.problems;
  const orphaned = orphanedStatusProblems(problems, requests);
  const orphanRef = useRef<HTMLDivElement>(null);
  const orphanCount = orphaned.length;
  const leavesList = statusChangeLeavesList(filter);

  const reportProblem = useCallback((requestId: string, problem: StatusProblem | null) => {
    setProblemState((state) => {
      const next = withStatusProblem(state.problems, requestId, problem);
      return next === state.problems ? state : { ...state, problems: next };
    });
  }, []);

  // The card whose change failed left the list, taking focus with it: continue at its message.
  useEffect(() => {
    if (orphanCount === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) orphanRef.current?.focus();
  }, [orphanCount]);

  return (
    <div className="grid gap-5">
      <StatusFilter requestsPath={requestsPath} filter={filter} counts={counts} />
      {counts === null && <Alert tone="info" description="The per-status totals couldn’t be counted right now; the list itself is complete." />}

      <div
        ref={orphanRef}
        tabIndex={-1}
        aria-live="polite"
        className={cn("focus:outline-none", orphaned.length > 0 ? "grid gap-3" : "sr-only")}
      >
        {orphaned.map(([requestId, problem]) => (
          <Alert
            key={requestId}
            role="none"
            tone="danger"
            title={`The request from ${problem.businessName} was not changed`}
            description={`${problem.message} It is no longer in this list.`}
            action={
              <Button variant="ghost" size="sm" onClick={() => reportProblem(requestId, null)}>
                Dismiss
              </Button>
            }
          />
        ))}
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={filter === "all" ? "No access requests yet" : `No ${ACCESS_REQUEST_STATUS_LABELS[filter].toLowerCase()} requests`}
          description={
            filter === "all"
              ? "Requests sent from the public “Request access” form appear here, newest first."
              : "Requests move between statuses as you handle them."
          }
          action={
            filter === "all" ? undefined : (
              <ButtonLink href={filterHref(requestsPath, "all")} variant="secondary">
                Show all requests
              </ButtonLink>
            )
          }
        />
      ) : (
        <ul aria-label="Access requests" className="grid gap-4">
          {requests.map((request) => (
            // Keyed by id only: a refresh (new updatedAt) must not re-mount the card and drop its messages.
            <RequestCard
              key={requestCardKey(request)}
              request={request}
              basePath={basePath}
              actions={actions}
              problem={statusProblemOf(problems, request.id)}
              onProblem={reportProblem}
              leavesList={leavesList}
            />
          ))}
        </ul>
      )}
      {truncated && <p className="text-sm text-fg-muted">Only the newest {numberFormat.format(requests.length)} requests are shown. Filter by status to see older ones.</p>}
    </div>
  );
}
