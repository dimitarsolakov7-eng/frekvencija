"use client";

import { useState, type ReactNode } from "react";
import { Field, Input, Select } from "@/components/ui";
import {
  BUSINESS_FIELD_MAX_LENGTH,
  COMMON_ANNOUNCEMENT_LANGUAGES,
  isCommonLanguage,
  languageLabel,
  OTHER_LANGUAGE_VALUE,
} from "./business-form";

export interface LanguageFieldProps {
  /** Submitted field name. */
  name?: string;
  /** Uncontrolled: the starting code, e.g. "en" or "pt-BR". */
  defaultValue?: string;
  /** Controlled: the current code ("" while "Other language…" is chosen and nothing is typed yet). */
  value?: string;
  /** Controlled: called with the new code. */
  onValueChange?: (code: string) => void;
  error?: string | null;
  /** Helper text under the select; null hides it (e.g. in a two-column row). */
  hint?: ReactNode | null;
}

/**
 * Announcement language: a select of common languages plus "Other language…", which reveals a text
 * input for any code. Exactly one control carries `name` at a time, so the form submits one value.
 * Uncontrolled with `defaultValue`, or controlled with `value` + `onValueChange`.
 */
export function LanguageField(props: LanguageFieldProps) {
  return props.value !== undefined ? <ControlledLanguageField {...props} value={props.value} /> : <UncontrolledLanguageField {...props} />;
}

function LanguageControls({
  name,
  error,
  hint,
  isOther,
  select,
  other,
}: {
  name: string;
  error?: string | null;
  hint?: ReactNode | null;
  isOther: boolean;
  select: { value?: string; defaultValue?: string; onChange: (value: string) => void };
  other: { value?: string; defaultValue?: string; onChange?: (value: string) => void };
}) {
  return (
    <div className="grid content-start gap-3">
      <Field label="Announcement language" hint={hint ?? undefined} error={isOther ? null : error} required>
        <Select
          name={isOther ? undefined : name}
          value={select.value}
          defaultValue={select.defaultValue}
          onChange={(event) => select.onChange(event.currentTarget.value)}
        >
          {COMMON_ANNOUNCEMENT_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {languageLabel(option.code)}
            </option>
          ))}
          <option value={OTHER_LANGUAGE_VALUE}>Other language…</option>
        </Select>
      </Field>
      {isOther && (
        <Field label="Language code" hint={"A language code such as “pt-BR”, “sr-Latn” or “fi”."} error={error} required>
          <Input
            name={name}
            value={other.value}
            defaultValue={other.defaultValue}
            onChange={other.onChange ? (event) => other.onChange?.(event.currentTarget.value) : undefined}
            maxLength={BUSINESS_FIELD_MAX_LENGTH.announcementLanguage}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8})?"
            title="A language code such as pt-BR"
          />
        </Field>
      )}
    </div>
  );
}

function UncontrolledLanguageField({ name = "announcementLanguage", defaultValue = "", error, hint = "The language announcements are written and spoken in." }: LanguageFieldProps) {
  const initial = defaultValue.trim() || "en";
  const initialIsCommon = isCommonLanguage(initial);
  const [choice, setChoice] = useState(initialIsCommon ? initial : OTHER_LANGUAGE_VALUE);
  return (
    <LanguageControls
      name={name}
      error={error}
      hint={hint}
      isOther={choice === OTHER_LANGUAGE_VALUE}
      select={{ defaultValue: initialIsCommon ? initial : OTHER_LANGUAGE_VALUE, onChange: setChoice }}
      other={{ defaultValue: initialIsCommon ? "" : initial }}
    />
  );
}

function ControlledLanguageField({
  name = "announcementLanguage",
  value,
  onValueChange,
  error,
  hint = "The language announcements are written and spoken in.",
}: LanguageFieldProps & { value: string }) {
  // "Other language…" stays open while the admin types, even when the typed code is a common one.
  const [otherChosen, setOtherChosen] = useState(!isCommonLanguage(value));
  // The last value this field reported: any other value was set from outside (e.g. newer saved data).
  const [ownValue, setOwnValue] = useState(value);
  if (value !== ownValue) {
    setOwnValue(value);
    setOtherChosen(!isCommonLanguage(value));
  }
  const isOther = otherChosen || !isCommonLanguage(value);

  function report(next: string) {
    setOwnValue(next);
    onValueChange?.(next);
  }

  return (
    <LanguageControls
      name={name}
      error={error}
      hint={hint}
      isOther={isOther}
      select={{
        value: isOther ? OTHER_LANGUAGE_VALUE : value,
        onChange: (next) => {
          if (next === OTHER_LANGUAGE_VALUE) {
            setOtherChosen(true);
            report(isCommonLanguage(value) ? "" : value);
          } else {
            setOtherChosen(false);
            report(next);
          }
        },
      }}
      other={{ value, onChange: report }}
    />
  );
}
