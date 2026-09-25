"use client";

import { RefreshCw } from "lucide-react";
import { Alert, Button, Field, Select, Skeleton } from "@/components/ui";
import type { TtsModelOption, TtsOptionsResponse, TtsVoiceOption } from "@/lib/api/contracts";
import { describeModelLanguageSupport, languageDisplayName, normalizeLanguageCode } from "@/lib/tts/models";
import { ClipPlayButton } from "./AnnouncementAudio";
import { groupVoices, voiceOptionLabel } from "./generate-form";
import type { EditorErrors } from "./studio-model";

export type ConfiguredTtsOptions = Extract<TtsOptionsResponse, { configured: true }>;

export interface VoiceFieldsProps {
  options: ConfiguredTtsOptions;
  voice: TtsVoiceOption | null;
  model: TtsModelOption | null;
  /** Effective language code ("" ⇒ none chosen). */
  languageCode: string;
  /** Language the announcement is written in (the recording's or the venue's). */
  preferredLanguage: string;
  onVoiceChange: (voiceId: string) => void;
  onModelChange: (modelId: string) => void;
  onLanguageChange: (languageCode: string) => void;
  onReload: () => void;
  errors: EditorErrors;
  disabled?: boolean;
}

function languageName(code: string): string {
  const normalized = normalizeLanguageCode(code) ?? code;
  return languageDisplayName(normalized);
}

/** Language (only the chosen model's), Voice with a sample, and Model. */
export function VoiceFields({
  options,
  voice,
  model,
  languageCode,
  preferredLanguage,
  onVoiceChange,
  onModelChange,
  onLanguageChange,
  onReload,
  errors,
  disabled = false,
}: VoiceFieldsProps) {
  const support = model ? describeModelLanguageSupport(model, preferredLanguage) : null;
  const listsLanguages = model !== null && model.languages.length > 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Language"
          required={listsLanguages}
          error={errors.languageCode}
          hint={
            model && !listsLanguages
              ? `${model.name} detects the language from the text.`
              : languageCode && normalizeLanguageCode(languageCode) !== normalizeLanguageCode(preferredLanguage)
                ? `The announcement is saved as ${languageName(languageCode)}.`
                : undefined
          }
        >
          {listsLanguages && model ? (
            <Select
              value={languageCode}
              disabled={disabled}
              placeholder={languageCode === "" ? "Choose a language" : undefined}
              onChange={(event) => onLanguageChange(event.currentTarget.value)}
            >
              {model.languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select value="auto" disabled>
              <option value="auto">{languageName(preferredLanguage)}</option>
            </Select>
          )}
        </Field>

        <Field
          label="Voice"
          required
          error={errors.voiceId}
          hint={voice?.description ?? undefined}
          labelAside={
            voice?.previewUrl ? (
              <span className="-my-2 flex items-center gap-2 text-sm text-fg-muted">
                <span aria-hidden="true">Sample</span>
                <ClipPlayButton
                  size="sm"
                  label={`sample of ${voice.name}`}
                  clip={{ key: `voice:${voice.id}`, load: async () => ({ url: voice.previewUrl ?? "", expiresAt: null }) }}
                />
              </span>
            ) : undefined
          }
        >
          <Select value={voice?.id ?? ""} placeholder="Select voice" disabled={disabled} onChange={(event) => onVoiceChange(event.currentTarget.value)}>
            {groupVoices(options.voices).map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {voiceOptionLabel(item)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field
          label="Model"
          required
          error={errors.modelId}
          hint={
            model?.maxCharacters
              ? `Up to ${model.maxCharacters.toLocaleString("en")} characters per announcement. The languages depend on the model.`
              : "The languages depend on the model."
          }
        >
          <Select value={model?.id ?? ""} placeholder={model ? undefined : "Choose a model"} disabled={disabled} onChange={(event) => onModelChange(event.currentTarget.value)}>
            {options.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.id === options.defaultModelId ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end sm:pb-7">
          <Button variant="ghost" size="sm" icon={<RefreshCw aria-hidden="true" />} onClick={onReload} disabled={disabled}>
            Reload voices
          </Button>
        </div>
      </div>

      {support && support.status === "unsupported" && (
        <Alert
          tone="warning"
          title={`${model?.name ?? "This model"} does not list ${languageName(preferredLanguage)}`}
          description={`Choose a model that supports ${languageName(preferredLanguage)}, or pick another language on purpose — otherwise the voice may use the wrong language or accent.`}
        />
      )}
    </div>
  );
}

/** Placeholder with the geometry of the three selects while the options load. */
export function VoiceFieldsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {["Language", "Voice", "Model"].map((label) => (
        <div key={label} className="grid gap-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
