"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { AudioLines, CloudUpload, FilePlus2, RefreshCw, X } from "lucide-react";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { PageHeading } from "@/components/shell";
import { Alert, Button, Card, ConfirmDialog, SegmentedTabs, useToast } from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import type { GenerateAnnouncementRequest } from "@/lib/api/contracts";
import { recordingLabel } from "@/lib/announcements/labels";
import { announcementTextCounter, wordingProblems } from "@/lib/announcements/spoken";
import { isGenerationInProgress } from "@/lib/announcements/state";
import { getAnnouncementTemplate } from "@/lib/announcements/templates";
import { isUploadAbort, UploadError } from "@/lib/uploads/client";
import { checkUploadFile } from "@/lib/validation/limits";
import { AnnouncementAudioProvider, type AudioClip } from "./AnnouncementAudio";
import { AnnouncementSettingsCard } from "./AnnouncementSettingsCard";
import { AdminApiError } from "./api";
import { AudioPreviewCard, hasAudioPreview, type GenerationPhase } from "./AudioPreviewCard";
import { AnnouncementTextField, PlacementField, PronunciationField, TemplatePicks } from "./EditorFields";
import { buildGenerateRequest, checkSpokenLength, defaultLanguageCode, defaultModelId, defaultVoiceId } from "./generate-form";
import { RecordingDropzone, type UploadProgressState } from "./RecordingDropzone";
import { recordingAccessibleName, RecordingsPanel } from "./RecordingsPanel";
import { NeedsReviewBanner, TtsUnavailableCard } from "./StudioNotices";
import { asSentence, isOnAir, needsReview, summarizeAnnouncements, type AnnouncementBusiness, type AnnouncementItem } from "./rules";
import { DEFAULT_STUDIO_API, type StudioApi } from "./studio-api";
import { useGenerationWatch, useTtsOptions } from "./studio-hooks";
import {
  brandingOf,
  defaultTemplateKey,
  editorErrorsFromAction,
  editorStateFromRecording,
  editorWording,
  generateProblems,
  hasErrors,
  initialEditorState,
  isEditorDirty,
  matchingTemplateKey,
  newEditorState,
  recordingPrimaryAction,
  spokenWordingEdited,
  storedLanguageFor,
  templateText,
  wordingSaveFields,
  type EditorErrors,
  type EditorState,
  type RecordingActionKey,
  type StudioActionState,
  type WordingValues,
} from "./studio-model";
import { runRecordingUpload } from "./upload-flow";
import { VenueSelect, type VenueOption } from "./VenueSelect";
import { VoiceFields, VoiceFieldsSkeleton } from "./VoiceFields";

/** Server Actions the page binds (src/app/admin/announcements/actions.ts). */
export interface AnnouncementStudioActions {
  /** Bound to the venue: announcementEveryNTracks, announcementVolumePercent. */
  updateSettings: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Bound to the venue: mode, templateKey, customText, placement, language, spokenText. Returns the new id. */
  createDraft: (formData: FormData) => Promise<StudioActionState>;
  /** text, spokenText (optional), placement, language. */
  updateWording: (announcementId: string, formData: FormData) => Promise<ActionState>;
  approve: (announcementId: string, version: string | null) => Promise<ActionState>;
  activate: (announcementId: string, version: string | null) => Promise<ActionState>;
  deactivate: (announcementId: string) => Promise<ActionState>;
  /** Returns the copy's id. */
  duplicate: (announcementId: string) => Promise<StudioActionState>;
  remove: (announcementId: string) => Promise<ActionState>;
  markFailed: (announcementId: string) => Promise<ActionState>;
}

export interface AnnouncementStudioProps {
  business: AnnouncementBusiness;
  /** The venue's recordings, oldest first. */
  announcements: AnnouncementItem[];
  /** Every venue, for the selector. */
  venues: readonly VenueOption[];
  /** Server clock (epoch ms) at render. */
  serverNow: number;
  /** Voice most recently used for this venue. */
  suggestedVoiceId: string | null;
  /** The server has a text-to-speech key (the options request can still report it as unusable). */
  ttsConfigured: boolean;
  /** Recording to open in the editor (e.g. `?announcement=` deep link). */
  initialDraftId?: string | null;
  actions: AnnouncementStudioActions;
  /** Browser calls (provider options, generation, previews, uploads); fixtures in the dev preview. */
  api?: StudioApi;
  /** Where choosing another venue navigates (default: this page with `?business=<id>`). */
  venueHref?: (venueId: string) => string;
}

function defaultVenueHref(venueId: string): string {
  return `/admin/announcements?business=${encodeURIComponent(venueId)}`;
}

type Tab = "generate" | "upload";

type ConfirmState =
  | { kind: "delete"; item: AnnouncementItem }
  | { kind: "venue"; venueId: string }
  | { kind: "load"; item: AnnouncementItem; mode: "edit" | "copy"; viaDuplicate: boolean }
  | { kind: "reset" }
  | { kind: "replace"; file: File };

interface ApprovedNotice {
  label: string;
  message: string | null;
  /** On-air recording the approved one was meant to replace (still on air). */
  replacedId: string | null;
}

const ACTION_COPY: Partial<Record<RecordingActionKey, { done: string; failed: string }>> = {
  approve: { done: "Approved", failed: "Could not approve" },
  reapprove: { done: "Approved again", failed: "Could not approve" },
  activate: { done: "Activated", failed: "Could not activate" },
  deactivate: { done: "Deactivated", failed: "Could not deactivate" },
  markFailed: { done: "Marked as failed", failed: "Could not update" },
};

const CONNECTION_PROBLEM = "Check your connection and try again.";

function clipFor(api: StudioApi, item: AnnouncementItem): AudioClip {
  return { key: `announcement:${item.id}:${item.updatedAt}`, load: () => api.previewUrl(item.id) };
}

/**
 * The announcements studio (screen 07): create a recording with the AI voice or upload one, listen
 * to it, approve it explicitly, and manage the venue's recordings and announcement settings.
 */
export function AnnouncementStudio(props: AnnouncementStudioProps) {
  return (
    <AnnouncementAudioProvider>
      <StudioContent {...props} />
    </AnnouncementAudioProvider>
  );
}

function StudioContent({
  business,
  announcements,
  venues,
  serverNow,
  suggestedVoiceId,
  ttsConfigured,
  initialDraftId = null,
  actions,
  api = DEFAULT_STUDIO_API,
  venueHref = defaultVenueHref,
}: AnnouncementStudioProps) {
  const router = useRouter();
  const toast = useToast();
  const refresh = useCallback(() => router.refresh(), [router]);
  // Results that depend on fresh server data are committed together with it (no flicker).
  const [, startRefresh] = useTransition();
  const now = useGenerationWatch(serverNow, announcements, refresh);
  const tts = useTtsOptions(ttsConfigured, api);

  const [editor, setEditor] = useState<EditorState>(() => initialEditorState(business, announcements, initialDraftId));
  const [tab, setTab] = useState<Tab>(() => {
    const initial = initialDraftId ? announcements.find((item) => item.id === initialDraftId) : undefined;
    return !ttsConfigured || initial?.source === "upload" ? "upload" : "generate";
  });
  const [phase, setPhase] = useState<GenerationPhase>({ kind: "idle" });
  const [errors, setErrors] = useState<EditorErrors>({});
  const [upload, setUpload] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<ApprovedNotice | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [venueSelectKey, setVenueSelectKey] = useState(0);

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const settingsDirtyRef = useRef(false);
  const textRefs = useRef<Record<Tab, HTMLTextAreaElement | null>>({ generate: null, upload: null });
  const noticeRef = useRef<HTMLDivElement>(null);
  const recordingsHeadingRef = useRef<HTMLHeadingElement>(null);

  // --- Derived state -----------------------------------------------------------------------------
  const options = tts.state.status === "ready" && tts.state.options.configured ? tts.state.options : null;
  const ttsUnavailable = !ttsConfigured || (tts.state.status === "ready" && !tts.state.options.configured);
  const ttsReason = tts.state.status === "ready" && !tts.state.options.configured ? tts.state.options.reason : null;

  const boundItem = editor.draftId ? (announcements.find((item) => item.id === editor.draftId) ?? null) : null;
  // A recording that went on air (e.g. approved from the list) is no longer edited in place.
  const editingItem = boundItem && !isOnAir(boundItem, business) ? boundItem : null;
  const replacing = editor.replacesId ? (announcements.find((item) => item.id === editor.replacesId) ?? null) : null;

  const voiceId = options ? defaultVoiceId(options.voices, [editor.voiceId, editingItem?.voiceId, suggestedVoiceId]) : "";
  const voice = options?.voices.find((candidate) => candidate.id === voiceId) ?? null;
  const modelId = options ? defaultModelId(options.models, editor.modelId, options.defaultModelId) : "";
  const model = options?.models.find((candidate) => candidate.id === modelId) ?? null;
  const languageCode = model
    ? (editor.languageByModel[model.id] ?? defaultLanguageCode(model, [editor.preferredLanguage, business.language]))
    : "";

  const wording = editorWording(editor, business);
  const counter = announcementTextCounter(editor.text, brandingOf(business));
  const activeTemplate = matchingTemplateKey(editor.text, business);
  const editorDirty = isEditorDirty(editor);
  const serverGenerating = editingItem !== null && isGenerationInProgress(editingItem, now);
  const generationBusy = phase.kind === "saving" || phase.kind === "generating" || serverGenerating;
  const busy = generationBusy || upload !== null || approving;
  const showPreview = hasAudioPreview(editingItem, phase, now);
  const summary = summarizeAnnouncements(announcements, business, now);
  const reviewReasons = [
    ...new Set(
      announcements
        .filter((item) => needsReview(item, business))
        .map((item) => asSentence(item.reviewReason ?? "The venue's branding changed after approval.")),
    ),
  ].slice(0, 3);
  const spokenLength = wording.ok ? checkSpokenLength(wording.spoken, model) : null;

  // Unsaved wording: every admin link (the sidebar too) and closing the tab ask first. The settings
  // card guards its own unsaved fields the same way.
  useUnsavedChangesGuard(editorDirty, { message: "Your announcement text hasn’t been saved." });

  // Closing or reloading the tab would interrupt a running upload or generation.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (busyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const reportSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirtyRef.current = dirty;
  }, []);

  // --- Editor helpers ----------------------------------------------------------------------------
  function focusText(target: Tab) {
    window.requestAnimationFrame(() => textRefs.current[target]?.focus());
  }

  function clearFeedback() {
    setErrors({});
    setUploadError(null);
    setPhase({ kind: "idle" });
  }

  function updateText(text: string) {
    setEditor((current) => ({ ...current, text, spokenOverride: null }));
    setErrors((current) => ({ ...current, text: undefined }));
  }

  function updatePronunciation(pronunciation: string) {
    setEditor((current) => ({ ...current, pronunciation, spokenOverride: null }));
    setErrors((current) => ({ ...current, pronunciation: undefined }));
  }

  function pickTemplate(templateKey: string) {
    const template = getAnnouncementTemplate(templateKey);
    const text = templateText(templateKey, business);
    if (!template || text === null) return;
    const previous = editor;
    setEditor((current) => ({ ...current, text, placement: template.defaultPlacement, spokenOverride: null }));
    setErrors((current) => ({ ...current, text: undefined }));
    const typed = previous.text.trim();
    if (typed && typed !== text && matchingTemplateKey(previous.text, business) === null) {
      toast.info("Text replaced", {
        description: `The “${template.label}” template replaced your text.`,
        action: {
          label: "Undo",
          onClick: () =>
            setEditor((current) => ({ ...current, text: previous.text, placement: previous.placement, spokenOverride: previous.spokenOverride })),
        },
      });
    }
  }

  function loadIntoEditor(item: AnnouncementItem, mode: "edit" | "copy", copyId?: string) {
    const next = editorStateFromRecording(item, business, mode);
    setEditor(copyId ? { ...next, draftId: copyId, replacesId: isOnAir(item, business) ? item.id : null } : next);
    clearFeedback();
    setNotice(null);
    const target: Tab = item.source === "upload" || ttsUnavailable ? "upload" : "generate";
    setTab(target);
    focusText(target);
  }

  function resetEditor() {
    setEditor(newEditorState(business, defaultTemplateKey(announcements, business)));
    clearFeedback();
    focusText(tab);
  }

  function requestLoad(item: AnnouncementItem, mode: "edit" | "copy") {
    if (editorDirty && item.id !== editor.draftId) {
      setConfirm({ kind: "load", item, mode, viaDuplicate: false });
      return;
    }
    loadIntoEditor(item, mode);
  }

  function requestReset() {
    if (editorDirty) {
      setConfirm({ kind: "reset" });
      return;
    }
    resetEditor();
  }

  function reportSaveProblem(purpose: "generate" | "upload", message: string) {
    if (purpose === "generate") setPhase({ kind: "error", message });
    else setUploadError(message);
  }

  function applyActionFailure(result: ActionState, purpose: "generate" | "upload") {
    setErrors(editorErrorsFromAction(result.fieldErrors));
    reportSaveProblem(purpose, result.message ?? "The wording could not be saved.");
  }

  /** The wording the editor saves with its audio (null while the text is not valid). */
  function wordingValues(purpose: "generate" | "upload"): WordingValues | null {
    if (!wording.ok) return null;
    const language =
      purpose === "generate" ? storedLanguageFor(languageCode, editor.preferredLanguage) : (editingItem?.language ?? editor.preferredLanguage);
    return { text: wording.text, spokenText: wording.spokenText, placement: editor.placement, language };
  }

  function saveBaseline() {
    setEditor((current) => ({ ...current, baseline: { text: current.text, placement: current.placement, pronunciation: current.pronunciation } }));
  }

  /**
   * Saves the editor's wording to a recording (null when it already has it). The spoken wording is
   * only sent with `includeSpoken`; otherwise the stored one stays. Throws on a connection failure.
   */
  async function saveWording(item: AnnouncementItem, values: WordingValues, includeSpoken: boolean): Promise<ActionState | null> {
    const fields = wordingSaveFields(item, values, includeSpoken);
    if (!fields) return null;
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    const result = await actions.updateWording(item.id, formData);
    if (result.ok) saveBaseline();
    return result;
  }

  /** Creates the draft a new announcement's audio belongs to; null when that failed (reported). */
  async function createDraft(purpose: "generate" | "upload", values: WordingValues): Promise<string | null> {
    try {
      const formData = new FormData();
      const templateKey = matchingTemplateKey(editor.text, business);
      if (templateKey) {
        formData.set("mode", "template");
        formData.set("templateKey", templateKey);
      } else {
        formData.set("mode", "custom");
        formData.set("customText", values.text);
      }
      formData.set("placement", values.placement);
      formData.set("language", values.language);
      // The full spoken wording (identical to the text ⇒ stored as "speak the text").
      formData.set("spokenText", purpose === "generate" && wording.ok ? wording.spoken : "");
      const result = await actions.createDraft(formData);
      if (!result.ok || !result.announcementId) {
        applyActionFailure(result, purpose);
        return null;
      }
      const id = result.announcementId;
      setEditor((current) => ({
        ...current,
        draftId: id,
        baseline: { text: current.text, placement: current.placement, pronunciation: current.pronunciation },
      }));
      return id;
    } catch {
      reportSaveProblem(purpose, `The wording could not be saved. ${CONNECTION_PROBLEM}`);
      return null;
    }
  }

  /** Generation reads the stored wording, so it is saved first (the draft is created on first use). */
  async function ensureDraftForGeneration(): Promise<string | null> {
    const values = wordingValues("generate");
    if (!values) return null;
    if (!editingItem) return createDraft("generate", values);
    try {
      const result = await saveWording(editingItem, values, true);
      if (result && !result.ok) {
        applyActionFailure(result, "generate");
        return null;
      }
      return editingItem.id;
    } catch {
      reportSaveProblem("generate", `The wording could not be saved. ${CONNECTION_PROBLEM}`);
      return null;
    }
  }

  /** One generation request (the lock, reuse and on-air rules are enforced by the route). */
  async function runGeneration(announcementId: string, request: GenerateAnnouncementRequest) {
    setPhase({ kind: "generating" });
    try {
      const result = await api.generate(announcementId, request);
      if (!result.reused) toast.success("Audio generated", { description: "Listen to it, then approve it to put it on air." });
      // The preview keeps showing "Generating…" until the new audio has arrived with the page data.
      startRefresh(() => {
        setPhase(result.reused ? { kind: "reused" } : { kind: "idle" });
        setEditor((current) => ({ ...current, voiceId: request.voiceId, modelId: request.modelId }));
        router.refresh();
      });
    } catch (error) {
      if (error instanceof AdminApiError) {
        const fields: EditorErrors = {};
        if (error.fields.voiceId) fields.voiceId = error.fields.voiceId;
        if (error.fields.modelId) fields.modelId = error.fields.modelId;
        if (error.fields.languageCode) fields.languageCode = error.fields.languageCode;
        setErrors(fields);
      }
      setPhase({
        kind: "error",
        message: error instanceof AdminApiError ? error.message : "Generating the audio failed unexpectedly. Try again.",
      });
      // The route may have recorded the failure (last_error), or the lock may still be running.
      refresh();
    }
  }

  async function generate(force: boolean) {
    if (busyRef.current || !options) return;
    const problems = generateProblems({ wording, pronunciation: editor.pronunciation, voice, model, languageCode });
    if (hasErrors(problems)) {
      setErrors(problems);
      setPhase({ kind: "idle" });
      if (problems.text) focusText("generate");
      return;
    }
    if (!voice || !model) return;
    busyRef.current = true;
    setErrors({});
    setNotice(null);
    setPhase({ kind: "saving" });
    try {
      const id = await ensureDraftForGeneration();
      if (!id) return;
      await runGeneration(id, buildGenerateRequest({ voice, model, languageCode, force }));
    } finally {
      busyRef.current = false;
    }
  }

  /** Row "Retry": generate the stored wording again with the editor's voice and model. */
  async function retryRecording(item: AnnouncementItem) {
    loadIntoEditor(item, "edit");
    if (busyRef.current) return;
    if (!options) {
      setPhase({ kind: "error", message: "The voices could not be loaded yet. Wait a moment, then press Retry." });
      return;
    }
    const retryVoiceId = defaultVoiceId(options.voices, [editor.voiceId, item.voiceId, suggestedVoiceId]);
    const retryVoice = options.voices.find((candidate) => candidate.id === retryVoiceId) ?? null;
    const retryModelId = defaultModelId(options.models, item.modelId ?? editor.modelId, options.defaultModelId);
    const retryModel = options.models.find((candidate) => candidate.id === retryModelId) ?? null;
    const retryLanguage = retryModel ? defaultLanguageCode(retryModel, [item.language, business.language]) : "";
    const spoken = (item.spokenText ?? item.text).trim();
    const problems = generateProblems({
      wording: { ok: true, text: item.text, spoken, spokenText: item.spokenText },
      pronunciation: "",
      voice: retryVoice,
      model: retryModel,
      languageCode: retryLanguage,
    });
    if (hasErrors(problems) || !retryVoice || !retryModel) {
      setErrors(problems);
      return;
    }
    busyRef.current = true;
    try {
      await runGeneration(item.id, buildGenerateRequest({ voice: retryVoice, model: retryModel, languageCode: retryLanguage, force: false }));
    } finally {
      busyRef.current = false;
    }
  }

  // --- Upload ------------------------------------------------------------------------------------
  function chooseFile(file: File) {
    if (busyRef.current) return;
    setUploadError(null);
    const check = checkUploadFile("announcement", { name: file.name, size: file.size, type: file.type });
    if (!check.ok) {
      setUploadError(check.message);
      return;
    }
    const problems = wordingProblems(wording);
    if (problems.text) {
      setErrors({ text: problems.text });
      setUploadError("Enter the announcement text first: it describes what the recording says.");
      focusText(tab);
      return;
    }
    if (editingItem?.hasAudio && editingItem.approvedAt) {
      setConfirm({ kind: "replace", file });
      return;
    }
    void uploadRecording(file);
  }

  /**
   * Uploads a recording (runRecordingUpload): an existing recording keeps its wording and audio until
   * the file has passed the server's checks; wording edits are saved afterwards. The spoken wording is
   * only sent when the admin edited the text or the pronunciation, so a stored respelling survives.
   */
  async function uploadRecording(file: File) {
    if (busyRef.current) return;
    const values = wordingValues("upload");
    if (!values) return;
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const target = editingItem;
    const includeSpoken = spokenWordingEdited(editor);
    setUploadError(null);
    setNotice(null);
    setPhase({ kind: "idle" });
    setUpload({ name: file.name, phase: "signing", fraction: 0 });
    try {
      const outcome = await runRecordingUpload({
        existingId: target?.id ?? null,
        createDraft: () => createDraft("upload", values),
        upload: (announcementId) =>
          api.uploadRecording({
            announcementId,
            file,
            signal: controller.signal,
            onPhase: (next) => setUpload((current) => (current ? { ...current, phase: next } : current)),
            onProgress: (fraction) => setUpload((current) => (current ? { ...current, fraction } : current)),
          }),
        saveWording: async () => {
          if (!target) return null;
          try {
            return await saveWording(target, values, includeSpoken);
          } catch {
            return { ok: false, message: CONNECTION_PROBLEM, fieldErrors: {} };
          }
        },
      });
      if (outcome.kind === "not-started") {
        setUpload(null);
        return;
      }
      if (outcome.wording && !outcome.wording.ok) {
        // The recording is attached; only the wording edits are missing, and the editor still has them.
        setErrors(editorErrorsFromAction(outcome.wording.fieldErrors));
        setUploadError(`${file.name} was uploaded, but the new wording could not be saved: ${outcome.wording.message ?? "please try again."}`);
      } else {
        toast.success("Recording uploaded", { description: `${file.name} was checked. Listen to it, then approve it to put it on air.` });
      }
      // The progress stays visible until the uploaded audio has arrived with the page data.
      startRefresh(() => {
        setUpload(null);
        router.refresh();
      });
    } catch (error) {
      setUpload(null);
      if (!isUploadAbort(error)) {
        setUploadError(error instanceof UploadError ? error.message : "The upload failed. Please try again.");
        refresh();
      }
    } finally {
      abortRef.current = null;
      busyRef.current = false;
    }
  }

  // --- Approve (the editor's recording) ------------------------------------------------------------
  async function approveEditing() {
    const item = editingItem;
    if (!item || busyRef.current) return;
    const primary = recordingPrimaryAction(item, business, now);
    if (primary !== "approve" && primary !== "reapprove" && primary !== "activate") return;
    busyRef.current = true;
    setApproving(true);
    try {
      const result = await (primary === "activate" ? actions.activate : actions.approve)(item.id, item.updatedAt);
      if (!result.ok) {
        toast.error(primary === "activate" ? "Could not activate" : "Could not approve", { description: result.message ?? undefined });
        refresh();
        return;
      }
      const replaced = replacing && replacing.id !== item.id && isOnAir(replacing, business) ? replacing : null;
      const nowOnAir = announcements.map((entry) =>
        entry.id === item.id ? { ...entry, status: "active" as const, needsReview: false, brandingVersion: business.brandingVersion } : entry,
      );
      setNotice({ label: recordingLabel(item.placement), message: result.message, replacedId: replaced?.id ?? null });
      setEditor(newEditorState(business, defaultTemplateKey(nowOnAir, business)));
      setErrors({});
      setPhase({ kind: "idle" });
      window.requestAnimationFrame(() => noticeRef.current?.focus());
    } catch {
      toast.error("Could not approve", { description: CONNECTION_PROBLEM });
    } finally {
      busyRef.current = false;
      setApproving(false);
    }
  }

  // --- Row actions -----------------------------------------------------------------------------------
  async function runRowAction(item: AnnouncementItem, key: RecordingActionKey, call: () => Promise<ActionState>) {
    const copy = ACTION_COPY[key] ?? { done: "Done", failed: "Could not update" };
    setPendingKey(`${item.id}:${key}`);
    try {
      const result = await call();
      if (result.ok) {
        toast.success(copy.done, { description: result.message ?? undefined });
        if (notice?.replacedId === item.id && key === "deactivate") setNotice({ ...notice, replacedId: null });
        // The recording open in the editor went on air: start a fresh announcement.
        if ((key === "approve" || key === "reapprove" || key === "activate") && item.id === editor.draftId) {
          setEditor(newEditorState(business, defaultTemplateKey(announcements, business)));
          clearFeedback();
        }
      } else {
        toast.error(copy.failed, { description: result.message ?? undefined });
        refresh();
      }
    } catch {
      toast.error(copy.failed, { description: CONNECTION_PROBLEM });
    } finally {
      setPendingKey(null);
    }
  }

  async function duplicateRecording(item: AnnouncementItem) {
    setPendingKey(`${item.id}:duplicate`);
    try {
      const result = await actions.duplicate(item.id);
      if (!result.ok || !result.announcementId) {
        toast.error("Could not duplicate", { description: result.message ?? undefined });
        refresh();
        return;
      }
      toast.success("New version created", {
        description: isOnAir(item, business)
          ? "It opens in the editor. The current recording keeps playing until you approve the new one."
          : "It opens in the editor as a draft.",
      });
      loadIntoEditor(item, "copy", result.announcementId);
    } catch {
      toast.error("Could not duplicate", { description: CONNECTION_PROBLEM });
    } finally {
      setPendingKey(null);
    }
  }

  function handleRowAction(item: AnnouncementItem, key: RecordingActionKey) {
    switch (key) {
      case "approve":
      case "reapprove":
        void runRowAction(item, key, () => actions.approve(item.id, item.updatedAt));
        return;
      case "activate":
        void runRowAction(item, key, () => actions.activate(item.id, item.updatedAt));
        return;
      case "deactivate":
        void runRowAction(item, key, () => actions.deactivate(item.id));
        return;
      case "markFailed":
        void runRowAction(item, key, () => actions.markFailed(item.id));
        return;
      case "duplicate":
        if (editorDirty) {
          setConfirm({ kind: "load", item, mode: "copy", viaDuplicate: true });
          return;
        }
        void duplicateRecording(item);
        return;
      case "editWording":
      case "continue":
        requestLoad(item, isOnAir(item, business) ? "copy" : "edit");
        return;
      case "retry":
        // Never throw away text the admin is writing: open the recording first, then Retry there.
        if (editorDirty && item.id !== editor.draftId) {
          setConfirm({ kind: "load", item, mode: "edit", viaDuplicate: false });
          return;
        }
        void retryRecording(item);
        return;
      case "delete":
        setConfirmError(null);
        setConfirm({ kind: "delete", item });
        return;
    }
  }

  // --- Confirmations ---------------------------------------------------------------------------------
  async function confirmAction() {
    const current = confirm;
    if (!current) return;
    switch (current.kind) {
      case "delete": {
        setConfirmError(null);
        try {
          const result = await actions.remove(current.item.id);
          if (!result.ok) {
            setConfirmError(result.message ?? "The recording could not be deleted.");
            refresh();
            return;
          }
          toast.success("Recording deleted");
          setConfirm(null);
          const deletedId = current.item.id;
          setEditor((state) =>
            state.draftId === deletedId || state.replacesId === deletedId
              ? { ...state, draftId: state.draftId === deletedId ? null : state.draftId, replacesId: state.replacesId === deletedId ? null : state.replacesId }
              : state,
          );
          window.requestAnimationFrame(() => recordingsHeadingRef.current?.focus());
        } catch {
          setConfirmError(`The recording could not be deleted. ${CONNECTION_PROBLEM}`);
        }
        return;
      }
      case "venue":
        setConfirm(null);
        router.push(venueHref(current.venueId) as Route);
        return;
      case "load":
        setConfirm(null);
        if (current.viaDuplicate) void duplicateRecording(current.item);
        else loadIntoEditor(current.item, current.mode);
        return;
      case "reset":
        setConfirm(null);
        resetEditor();
        return;
      case "replace":
        setConfirm(null);
        void uploadRecording(current.file);
        return;
    }
  }

  function cancelConfirm() {
    if (confirm?.kind === "venue") setVenueSelectKey((key) => key + 1);
    setConfirm(null);
    setConfirmError(null);
  }

  function requestVenue(venueId: string) {
    if (editorDirty || settingsDirtyRef.current || busyRef.current) {
      setConfirm({ kind: "venue", venueId });
      return;
    }
    router.push(venueHref(venueId) as Route);
  }

  // --- Rendering -------------------------------------------------------------------------------------
  const previewCard = (mode: Tab) => (
    <AudioPreviewCard
      item={editingItem}
      business={business}
      now={now}
      phase={phase}
      mode={mode}
      clip={editingItem ? clipFor(api, editingItem) : null}
      approving={approving}
      onApprove={() => void approveEditing()}
      canRegenerate={options !== null}
      onRegenerate={() => void generate(true)}
      onRetry={() => void generate(false)}
      busy={upload !== null}
    />
  );

  const editingBar = (editingItem || editor.replacesId) && (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control border border-border bg-control px-3 py-2 text-sm">
      <p className="min-w-0 text-fg-muted text-pretty">
        {editingItem ? (
          <>
            Editing <span className="font-medium text-fg">{recordingAccessibleName(editingItem)}</span>
          </>
        ) : (
          <>
            New version of <span className="font-medium text-fg">{replacing ? recordingAccessibleName(replacing) : "a recording"}</span>. The
            current one keeps playing until you approve this one.
          </>
        )}
      </p>
      <Button variant="ghost" size="sm" icon={<FilePlus2 aria-hidden="true" />} onClick={requestReset} disabled={busy}>
        New announcement
      </Button>
    </div>
  );

  const wordingFields = (target: Tab) => (
    <>
      <TemplatePicks activeKey={activeTemplate} onPick={pickTemplate} disabled={busy} />
      <AnnouncementTextField
        value={editor.text}
        onChange={updateText}
        counter={counter}
        error={errors.text}
        hint={target === "upload" ? "Describe what the recording says, so you can recognise it later." : undefined}
        disabled={busy}
        textareaRef={(element) => {
          textRefs.current[target] = element;
        }}
      />
      <PlacementField
        value={editor.placement}
        onChange={(placement) => setEditor((current) => ({ ...current, placement }))}
        everyNTracks={business.everyNTracks}
        disabled={busy}
      />
    </>
  );

  const dropzone = (
    <RecordingDropzone progress={upload} error={uploadError} onFile={chooseFile} onCancel={() => abortRef.current?.abort()} disabled={busy} />
  );

  const generatePanel = ttsUnavailable ? (
    <TtsUnavailableCard reason={ttsReason} onUploadInstead={() => setTab("upload")} />
  ) : (
    <div className="grid grid-cols-1 gap-4">
      <Card className="grid grid-cols-1 gap-5 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 className="section-title font-bold text-fg">Create an announcement</h2>
          <p className="text-sm text-fg-muted">Write what you&apos;d like your venue&apos;s voice to say.</p>
        </div>
        {editingBar}
        {wordingFields("generate")}
        <PronunciationField
          value={editor.pronunciation}
          onChange={updatePronunciation}
          venueName={business.name}
          spokenAs={wording.ok ? wording.spoken : null}
          overridden={editor.spokenOverride !== null}
          onRebuild={() => setEditor((current) => ({ ...current, spokenOverride: null }))}
          error={errors.pronunciation}
          disabled={busy}
        />
        {tts.state.status === "loading" && (
          <div role="status" aria-label="Loading voices and models">
            <VoiceFieldsSkeleton />
          </div>
        )}
        {tts.state.status === "error" && (
          <Alert
            tone="danger"
            title="Voices and models could not be loaded"
            description={`${tts.state.message} Uploading a recording still works.`}
            action={
              <Button variant="secondary" size="sm" icon={<RefreshCw aria-hidden="true" />} onClick={() => tts.reload(false)}>
                Try again
              </Button>
            }
          />
        )}
        {options && (options.models.length === 0 || options.voices.length === 0) && (
          <Alert
            tone="warning"
            title={options.models.length === 0 ? "No text-to-speech models are available" : "No voices are available"}
            description="The voice account returned no usable models or voices. Check the account, then reload. Uploading a recording still works."
            action={
              <Button variant="secondary" size="sm" icon={<RefreshCw aria-hidden="true" />} onClick={() => tts.reload(true)}>
                Reload
              </Button>
            }
          />
        )}
        {options && options.models.length > 0 && options.voices.length > 0 && (
          <VoiceFields
            options={options}
            voice={voice}
            model={model}
            languageCode={languageCode}
            preferredLanguage={editor.preferredLanguage}
            onVoiceChange={(next) => {
              setEditor((current) => ({ ...current, voiceId: next || null }));
              setErrors((current) => ({ ...current, voiceId: undefined }));
            }}
            onModelChange={(next) => {
              setEditor((current) => ({ ...current, modelId: next || null }));
              setErrors((current) => ({ ...current, modelId: undefined, languageCode: undefined, pronunciation: undefined }));
            }}
            onLanguageChange={(next) => {
              if (!model) return;
              setEditor((current) => ({ ...current, languageByModel: { ...current.languageByModel, [model.id]: next } }));
              setErrors((current) => ({ ...current, languageCode: undefined }));
            }}
            onReload={() => tts.reload(true)}
            errors={errors}
            disabled={busy}
          />
        )}
        <div className="grid gap-2">
          <Button
            size="lg"
            fullWidth
            icon={<AudioLines aria-hidden="true" />}
            onClick={() => void generate(false)}
            loading={generationBusy}
            loadingText={phase.kind === "saving" ? "Saving…" : "Generating…"}
            disabled={options === null || upload !== null || approving}
          >
            Generate preview
          </Button>
          {spokenLength && spokenLength.count > 0 && (
            <p className="text-center text-sm text-fg-muted">
              {spokenLength.count.toLocaleString("en")} characters are spoken
              {spokenLength.max !== null ? ` (up to ${spokenLength.max.toLocaleString("en")} for this model)` : ""}. Nothing plays until you
              approve it.
            </p>
          )}
        </div>
      </Card>

      {showPreview && previewCard("generate")}

      <Card className="grid grid-cols-1 gap-3 p-5 sm:p-6">
        <div className="grid gap-1">
          <h3 className="text-base font-semibold text-fg">Upload your own recording</h3>
          <p className="text-sm text-fg-muted">Alternatively, upload a pre-recorded announcement (MP3). It is saved with the text and placement above.</p>
        </div>
        {dropzone}
      </Card>
    </div>
  );

  const uploadPanel = (
    <div className="grid grid-cols-1 gap-4">
      <Card className="grid grid-cols-1 gap-5 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 className="section-title font-bold text-fg">Upload your own recording</h2>
          <p className="text-sm text-fg-muted">Upload a pre-recorded announcement (MP3), listen to it, then approve it.</p>
        </div>
        {editingBar}
        {wordingFields("upload")}
        {dropzone}
      </Card>
      {showPreview && previewCard("upload")}
    </div>
  );

  const confirmCopy = (() => {
    switch (confirm?.kind) {
      case "delete":
        return {
          title: "Delete this recording?",
          description: `${recordingAccessibleName(confirm.item)} and its audio are removed permanently.${
            isOnAir(confirm.item, business) ? " It stops playing at the venue." : ""
          }`,
          confirmLabel: "Delete recording",
          tone: "danger" as const,
        };
      case "venue":
        return {
          title: "Leave without saving?",
          description: "You have unsaved changes to the announcement or its settings. They are lost if you switch venues.",
          confirmLabel: "Discard and switch",
          tone: "danger" as const,
        };
      case "load":
      case "reset":
        return {
          title: "Discard the text you are writing?",
          description: "Your unsaved announcement text is replaced.",
          confirmLabel: "Discard text",
          tone: "danger" as const,
        };
      case "replace":
        return {
          title: "Replace the approved recording?",
          description: "The new MP3 replaces this recording's approved audio. It must be approved again before it plays.",
          confirmLabel: "Upload and replace",
          tone: "primary" as const,
        };
      default:
        return null;
    }
  })();

  return (
    <>
      <PageHeading
        breadcrumbs={[
          { label: "Businesses", href: "/admin/businesses" as Route },
          { label: business.name, href: `/admin/businesses/${business.id}` as Route },
          { label: "Announcements" },
        ]}
        title={business.stationName}
        description="Your music. Their name."
        actions={<VenueSelect key={venueSelectKey} venues={venues} currentId={business.id} onSelect={requestVenue} />}
      />

      <div className="grid gap-6">
        <NeedsReviewBanner count={summary.needsReview} reasons={reviewReasons} />
        {!business.isActive && (
          <Alert
            tone="info"
            title="This venue is inactive"
            description="You can prepare and approve recordings now. Nothing plays until the venue is activated on its business page."
          />
        )}

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(21rem,1fr)]">
          <section
            aria-label="Create a recording"
            className="grid min-w-0 grid-cols-1 gap-4 rounded-card sm:border sm:border-border sm:bg-surface/40 sm:p-3"
          >
            {notice && (
              <div ref={noticeRef} tabIndex={-1} className="outline-none">
                <Alert
                  tone="success"
                  title={`${notice.label} is approved`}
                  description={
                    notice.replacedId
                      ? `${notice.message ?? ""} The previous version is still on air too — deactivate it so only the new one plays.`.trim()
                      : (notice.message ?? undefined)
                  }
                  action={
                    <>
                      {notice.replacedId && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={pendingKey === `${notice.replacedId}:deactivate`}
                          onClick={() => {
                            const previous = announcements.find((item) => item.id === notice.replacedId);
                            if (previous) void runRowAction(previous, "deactivate", () => actions.deactivate(previous.id));
                          }}
                        >
                          Deactivate previous version
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" icon={<X aria-hidden="true" />} onClick={() => setNotice(null)}>
                        Dismiss
                      </Button>
                    </>
                  }
                />
              </div>
            )}
            <SegmentedTabs
              label="How to create the recording"
              value={tab}
              onValueChange={(next) => setTab(next === "upload" ? "upload" : "generate")}
              // Full-width halves on phones (tighter padding so both labels fit at 320px); natural width above.
              listClassName="w-full sm:w-auto [&>*]:flex-1 [&>*]:px-2! sm:[&>*]:flex-none sm:[&>*]:px-4!"
              panelClassName="pt-3"
              items={[
                { value: "generate", label: "Generate voice", icon: <AudioLines />, content: generatePanel },
                { value: "upload", label: "Upload recording", icon: <CloudUpload />, content: uploadPanel },
              ]}
            />
          </section>

          <div className="grid min-w-0 grid-cols-1 gap-6">
            <AnnouncementSettingsCard
              everyNTracks={business.everyNTracks}
              volume={business.volume}
              action={actions.updateSettings}
              onDirtyChange={reportSettingsDirty}
            />
            <RecordingsPanel
              business={business}
              items={announcements}
              now={now}
              editingId={editingItem?.id ?? null}
              pendingKey={pendingKey}
              onAction={handleRowAction}
              clipFor={(item) => clipFor(api, item)}
              headingRef={recordingsHeadingRef}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null && confirmCopy !== null}
        onCancel={cancelConfirm}
        onConfirm={confirmAction}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        tone={confirmCopy?.tone}
      >
        {confirmError && <Alert tone="danger" description={confirmError} />}
      </ConfirmDialog>
    </>
  );
}

