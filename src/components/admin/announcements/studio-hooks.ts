"use client";

import { useEffect, useRef, useState } from "react";
import type { TtsOptionsResponse } from "@/lib/api/contracts";
import { GENERATION_LOCK_MS, isGenerationInProgress } from "@/lib/announcements/state";
import { AdminApiError } from "./api";
import type { AnnouncementItem } from "./rules";
import type { StudioApi } from "./studio-api";

/** Refresh cadence while a recording is generating, and the refresh budget per generation. */
export const POLL_INTERVAL_MS = 3000;
export const MAX_POLL_REFRESHES = Math.ceil((GENERATION_LOCK_MS + 30_000) / POLL_INTERVAL_MS);

/**
 * Server-aligned clock (server time at render + time elapsed on this device), and a bounded refresh
 * loop while any recording is generating on the server, so a finished, failed or stalled generation
 * always shows up without a stuck spinner — even after a reload or from another tab.
 */
export function useGenerationWatch(serverNow: number, items: readonly AnnouncementItem[], refresh: () => void): number {
  const serverNowRef = useRef(serverNow);
  const receivedAtRef = useRef<number | null>(null);
  const [clock, setClock] = useState<{ base: number; offset: number } | null>(null);
  useEffect(() => {
    serverNowRef.current = serverNow;
    receivedAtRef.current = Date.now();
  }, [serverNow]);
  const now = clock && clock.base === serverNow ? serverNow + clock.offset : serverNow;

  const signature = items
    .filter((item) => isGenerationInProgress(item, now))
    .map((item) => `${item.id}@${item.generationStartedAt ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!signature) return;
    let refreshes = 0;
    const handle = window.setInterval(() => {
      const receivedAt = receivedAtRef.current;
      if (receivedAt !== null) setClock({ base: serverNowRef.current, offset: Date.now() - receivedAt });
      if (document.visibilityState !== "visible") return;
      refreshes += 1;
      if (refreshes > MAX_POLL_REFRESHES) {
        window.clearInterval(handle);
        return;
      }
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [signature, refresh]);

  return now;
}

export type TtsOptionsState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; options: TtsOptionsResponse };

function optionsErrorMessage(error: unknown): string {
  return error instanceof AdminApiError ? error.message : "The voices and models could not be loaded. Try again.";
}

/** Voices and models from GET /api/admin/tts/options; not requested when TTS is not configured. */
export function useTtsOptions(enabled: boolean, api: StudioApi): { state: TtsOptionsState; reload: (refresh: boolean) => void } {
  const [state, setState] = useState<TtsOptionsState>(enabled ? { status: "loading" } : { status: "off" });
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const request = ++requestRef.current;
    api.loadTtsOptions({ signal: controller.signal }).then(
      (options) => {
        if (request === requestRef.current) setState({ status: "ready", options });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && request === requestRef.current) setState({ status: "error", message: optionsErrorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [enabled, api]);

  function reload(refresh: boolean) {
    if (!enabled) return;
    const request = ++requestRef.current;
    setState({ status: "loading" });
    api.loadTtsOptions({ refresh }).then(
      (options) => {
        if (request === requestRef.current) setState({ status: "ready", options });
      },
      (error: unknown) => {
        if (request === requestRef.current) setState({ status: "error", message: optionsErrorMessage(error) });
      },
    );
  }

  return { state, reload };
}
