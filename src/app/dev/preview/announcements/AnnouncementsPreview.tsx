"use client";

import { useState } from "react";
import { AnnouncementStudio, type AnnouncementStudioActions } from "@/components/admin/announcements/AnnouncementStudio";
import type { StudioApi } from "@/components/admin/announcements/studio-api";
import type { StudioActionState } from "@/components/admin/announcements/studio-model";
import type { AnnouncementItem } from "@/components/admin/announcements/rules";
import {
  DEMO_AUDIO,
  FIXTURE_BUSINESS,
  FIXTURE_NOW,
  FIXTURE_VENUES,
  fixtureRecordings,
  fixtureTtsOptions,
  READY_ID,
  type PreviewScenario,
  type PreviewTts,
} from "./fixtures";
import { UploadError } from "@/lib/uploads/client";

const PREVIEW_MESSAGE = "Preview only: nothing was saved.";

function success(extra: Partial<StudioActionState> = {}): StudioActionState {
  return { ok: true, message: PREVIEW_MESSAGE, fieldErrors: {}, ...extra };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(handle);
      reject(new UploadError("aborted", "Upload cancelled."));
    });
  });
}

/** No-op Server Actions: each answers like a successful save. */
function createPreviewActions(): AnnouncementStudioActions {
  return {
    updateSettings: async () => success({ message: "Playback settings saved. (Preview only: nothing was saved.)" }),
    createDraft: async () => success({ announcementId: READY_ID }),
    updateWording: async () => success(),
    approve: async () => success({ message: "Approved. It is on air now. (Preview only: nothing was saved.)" }),
    activate: async () => success(),
    deactivate: async () => success(),
    duplicate: async () => success({ announcementId: READY_ID }),
    remove: async () => success(),
    markFailed: async () => success(),
  };
}

/** Provider options, generation, previews and uploads without a server. */
function createPreviewApi(tts: PreviewTts, recordings: readonly AnnouncementItem[]): StudioApi {
  return {
    async loadTtsOptions() {
      await wait(400);
      return fixtureTtsOptions(tts);
    },
    async generate() {
      await wait(1500);
      const ready = recordings.find((item) => item.id === READY_ID) ?? recordings[0];
      if (!ready) throw new Error("No fixture recording to return.");
      return { announcement: ready, reused: false };
    },
    async previewUrl(announcementId) {
      await wait(150);
      const item = recordings.find((candidate) => candidate.id === announcementId);
      const url = item?.placement === "welcome" ? DEMO_AUDIO.welcome : item?.placement === "both" ? DEMO_AUDIO.other : DEMO_AUDIO.station;
      return { url, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() };
    },
    async uploadRecording({ signal, onPhase, onProgress }) {
      onPhase("signing");
      await wait(300, signal);
      onPhase("uploading");
      for (let step = 1; step <= 10; step++) {
        await wait(120, signal);
        onProgress(step / 10);
      }
      onPhase("validating");
      await wait(500);
    },
  };
}

export interface AnnouncementsPreviewProps {
  tts: PreviewTts;
  scenario: PreviewScenario;
}

/** The real studio with EmeraldBar fixtures, no-op actions and a fake browser API. */
export function AnnouncementsPreview({ tts, scenario }: AnnouncementsPreviewProps) {
  const [recordings] = useState(() => fixtureRecordings(scenario));
  const [actions] = useState(createPreviewActions);
  const [api] = useState(() => createPreviewApi(tts, recordings));
  return (
    <AnnouncementStudio
      business={FIXTURE_BUSINESS}
      announcements={recordings}
      venues={FIXTURE_VENUES}
      serverNow={FIXTURE_NOW}
      suggestedVoiceId="fixture-voice-warm"
      ttsConfigured={tts !== "off"}
      initialDraftId={scenario === "default" ? READY_ID : null}
      actions={actions}
      api={api}
      venueHref={(venueId) => `/dev/preview/announcements?tts=${tts}&scenario=${scenario}&venue=${encodeURIComponent(venueId)}`}
    />
  );
}
