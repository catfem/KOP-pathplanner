import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

function fmt(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  hint?: ReactNode;
  disabled?: boolean;
}

/** Numeric input that keeps the user's text while typing and commits valid numbers. */
export function NumberField({ label, value, onChange, unit, step = 0.1, min, max, decimals = 3, hint, disabled }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(fmt(value, decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, decimals));
  }, [value, decimals]);
  const parsed = Number(text);
  const problem =
    text.trim() === '' || !Number.isFinite(parsed)
      ? 'Enter a number'
      : min !== undefined && parsed < min
        ? `Minimum is ${min}`
        : max !== undefined && parsed > max
          ? `Maximum is ${max}`
          : null;
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) return;
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    onChange(c);
  };
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`field-input${problem ? ' invalid' : ''}`}>
        <input
          id={id}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(fmt(value, decimals));
          }}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {problem && (
        <div className="field-error" id={errorId}>
          {problem}
          {text.trim() !== '' && Number.isFinite(parsed) ? '; using the closest allowed value.' : '; the last valid value is kept.'}
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

interface TextFieldProps {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  list?: string;
}

export function TextField({ label, value, onChange, hint, placeholder, list }: TextFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input id={id} type="text" value={value} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}

export function SelectField<T extends string>({ label, value, options, onChange, hint }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="field check">
      <label className={disabled ? 'disabled' : undefined}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={value === o.value ? 'active' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, actions, defaultOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`chev${open ? ' open' : ''}`} aria-hidden>
            ›
          </span>
          {title}
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function IconButton({ title, onClick, children, disabled, active, danger, className }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean; active?: boolean; danger?: boolean; className?: string }) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''}${danger ? ' danger' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Comma separated integer list (motor IDs / ports). */
export function IntListField({ label, value, onChange, hint }: { label: ReactNode; value: number[]; onChange: (v: number[]) => void; hint?: ReactNode }) {
  const id = useId();
  const [text, setText] = useState(value.join(', '));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value.join(', '));
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type="text"
          value={text}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(value.join(', '));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const nums = e.target.value
              .split(/[,\s]+/)
              .filter(Boolean)
              .map(Number);
            if (nums.length > 0 && nums.every((n) => Number.isInteger(n) && n >= 0)) onChange(nums);
          }}
        />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
