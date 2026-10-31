import { useId } from "react";
import type { Field, Values } from "../tools/registry.ts";

interface Props {
  fields: Field[];
  values: Values;
  onChange: (values: Values) => void;
}

function FieldControl({ field, values, onChange }: { field: Field; values: Values; onChange: (values: Values) => void }) {
  const id = useId();
  const value = values[field.key];
  const text = typeof value === "string" ? value : "";
  const set = (next: string | string[]) => onChange({ ...values, [field.key]: next });
  const hintId = field.hint ? `${id}-hint` : undefined;

  let control;
  switch (field.type) {
    case "select":
      control = (
        <select id={id} value={text} onChange={(event) => set(event.target.value)} aria-describedby={hintId}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "text":
      control = (
        <input
          id={id}
          type="text"
          value={text}
          placeholder={field.placeholder}
          required={field.required}
          maxLength={500}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={hintId}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case "password":
      control = (
        <input
          id={id}
          type="password"
          value={text}
          required={field.required}
          maxLength={127}
          autoComplete={field.autoComplete}
          aria-describedby={hintId}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case "number":
      control = (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={field.min}
          max={field.max}
          step={field.step}
          aria-describedby={hintId}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case "checkboxes": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset className="field">
          <legend>{field.label}</legend>
          <div className="checks">
            {field.options.map((option) => (
              <label key={option.value} className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    set(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      {control}
      {field.hint && (
        <p id={hintId} className="field-hint">
          {field.hint}
        </p>
      )}
    </div>
  );
}

export function OptionsForm({ fields, values, onChange }: Props) {
  const visible = fields.filter((field) => !field.showIf || field.showIf(values));
  if (visible.length === 0) return null;
  return (
    <div className="options">
      {visible.map((field) => (
        <FieldControl key={field.key} field={field} values={values} onChange={onChange} />
      ))}
    </div>
  );
}
