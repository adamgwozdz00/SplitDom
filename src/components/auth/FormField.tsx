import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  hint?: ReactNode;
  /** Shown on the right of the label row, e.g. a link. */
  labelAside?: ReactNode;
  /** Shown inside the field on the right, e.g. the password toggle. */
  endContent?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  error,
  hint,
  labelAside,
  endContent,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={endContent ? "field pr-13" : "field"}
        />
        {endContent}
      </div>
      {error ? (
        <p id={errorId} className="text-danger flex items-center gap-1.5 text-[13px] font-semibold">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
