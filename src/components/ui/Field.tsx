import { Children, cloneElement, useId, type AriaAttributes, type ReactElement, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Label } from "./Label";

/** Props that <Field> injects into its control. Input, Textarea, Select, Switch and Slider accept them. */
export interface FieldControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
}

export interface FieldProps {
  label: ReactNode;
  /** Exactly one control element. */
  children: ReactElement<FieldControlProps>;
  /** Helper text under the control, linked with aria-describedby. */
  hint?: ReactNode;
  /** Validation message(s), e.g. `state.fieldErrors?.name` from a server action. */
  error?: string | readonly string[] | null;
  /** Marks the label and sets `required` on the control (unless the control sets it itself). */
  required?: boolean;
  optional?: boolean;
  /** Control id; defaults to the control's own id, then a generated one. */
  id?: string;
  /** Keep the label for assistive technology only. */
  hideLabel?: boolean;
  /** Content aligned to the right of the label, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode;
  className?: string;
}

function normalizeErrors(error: FieldProps["error"]): string[] {
  if (!error) return [];
  const list: readonly string[] = typeof error === "string" ? [error] : error;
  return list.filter((message) => message.trim().length > 0);
}

/**
 * Label + control + hint + error, with the accessibility wiring done for you: the label points
 * at the control, the hint and error are referenced by aria-describedby, and aria-invalid is set
 * while there is an error. Works in Server and Client Components.
 *
 * ```tsx
 * <Field label="Station name" hint="Shown on the player" error={state.fieldErrors?.stationName} required>
 *   <Input name="stationName" defaultValue={state.values?.stationName} />
 * </Field>
 * ```
 */
export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  optional = false,
  id,
  hideLabel = false,
  labelAside,
  className,
}: FieldProps) {
  const generatedId = useId();
  const control = Children.only(children);
  const controlId = id ?? control.props.id ?? `${generatedId}control`;
  const errors = normalizeErrors(error);
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = errors.length > 0 ? `${controlId}-error` : undefined;
  const describedBy = [control.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <div className={cn("flex items-baseline justify-between gap-3", hideLabel && !labelAside && "contents")}>
        <Label
          htmlFor={controlId}
          required={required}
          optional={optional}
          className={hideLabel ? "sr-only" : undefined}
        >
          {label}
        </Label>
        {labelAside}
      </div>
      {cloneElement(control, {
        id: controlId,
        required: control.props.required ?? (required || undefined),
        "aria-describedby": describedBy,
        "aria-invalid": errors.length > 0 ? true : control.props["aria-invalid"],
      })}
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {errors.length > 0 && (
        <div id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="grid gap-0.5">
            {errors.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
