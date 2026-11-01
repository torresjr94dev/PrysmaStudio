import { useId, useState } from "react";
import type { Field, Values } from "../tools/registry.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  fields: Field[];
  values: Values;
  onChange: (values: Values) => void;
  disabled: boolean;
}

function decimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? (text.split(".")[1]?.length ?? 0) : 0;
}

function FieldControl({ field, values, onChange, disabled }: { field: Field; values: Values; onChange: (values: Values) => void; disabled: boolean }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const value = values[field.key];
  const text = typeof value === "string" ? value : "";
  const set = (next: string | string[]) => onChange({ ...values, [field.key]: next });
  const hintId = field.hint ? `${id}-hint` : undefined;
  const hint = field.hint ? (
    <p id={hintId} className="field-hint">
      {field.hint}
    </p>
  ) : null;

  switch (field.type) {
    case "choice":
      return (
        <fieldset className="field" disabled={disabled} aria-describedby={hintId}>
          <legend>{field.label}</legend>
          <div className={field.layout === "cards" ? "choice-cards" : "segmented"} role="radiogroup">
            {field.options.map((option) => (
              <label key={option.value} className={field.layout === "cards" ? "choice-card" : "segment"}>
                <input type="radio" name={id} value={option.value} checked={text === option.value} onChange={() => set(option.value)} />
                <span className="choice-label">{option.label}</span>
                {field.layout === "cards" && option.description && <span className="choice-description">{option.description}</span>}
              </label>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    case "toggles": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset className="field" disabled={disabled}>
          <legend>{field.label}</legend>
          <div className="toggles">
            {field.options.map((option) => (
              <label key={option.value} className="toggle">
                <span>{option.label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={selected.includes(option.value)}
                  onChange={(event) => set(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))}
                />
                <span className="toggle-track" aria-hidden="true" />
              </label>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    }
    case "select":
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <select id={id} value={text} disabled={disabled} onChange={(event) => set(event.target.value)} aria-describedby={hintId}>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {hint}
        </div>
      );
    case "text":
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="text"
            value={text}
            placeholder={field.placeholder}
            required={field.required}
            disabled={disabled}
            maxLength={500}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={hintId}
            onChange={(event) => set(event.target.value)}
          />
          {hint}
        </div>
      );
    case "password":
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <div className="input-group">
            <input
              id={id}
              type={reveal ? "text" : "password"}
              value={text}
              required={field.required}
              disabled={disabled}
              maxLength={127}
              autoComplete={field.autoComplete}
              spellCheck={false}
              aria-describedby={hintId}
              onChange={(event) => set(event.target.value)}
            />
            <button
              type="button"
              className="input-addon"
              aria-label={reveal ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={reveal}
              disabled={disabled}
              onClick={() => setReveal((current) => !current)}
            >
              <Icon name={reveal ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>
          {hint}
        </div>
      );
    case "number": {
      const current = Number(text);
      const places = decimals(field.step);
      const bump = (direction: 1 | -1) => {
        const base = Number.isFinite(current) ? current : field.min;
        const next = Math.min(field.max, Math.max(field.min, base + direction * field.step));
        set(next.toFixed(places));
      };
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <div className="input-group is-stepper">
            <button type="button" className="input-addon" aria-label="Disminuir" disabled={disabled || current <= field.min} onClick={() => bump(-1)}>
              <Icon name="minus" size={16} />
            </button>
            <input
              id={id}
              type="number"
              inputMode="decimal"
              value={text}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={disabled}
              aria-describedby={hintId}
              onChange={(event) => set(event.target.value)}
            />
            {field.unit && <span className="input-unit">{field.unit}</span>}
            <button type="button" className="input-addon" aria-label="Aumentar" disabled={disabled || current >= field.max} onClick={() => bump(1)}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          {hint}
        </div>
      );
    }
  }
}

export function OptionsForm({ fields, values, onChange, disabled }: Props) {
  const visible = fields.filter((field) => !field.showIf || field.showIf(values));
  if (visible.length === 0) return null;
  return (
    <div className="options">
      {visible.map((field) => (
        <FieldControl key={field.key} field={field} values={values} onChange={onChange} disabled={disabled} />
      ))}
    </div>
  );
}
