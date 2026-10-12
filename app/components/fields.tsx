import { useEffect, useRef } from "react";

type FieldElement = HTMLElement & { value?: string; checked?: boolean };

/**
 * Polaris web components treat the `value`/`checked` attributes as *defaults* and React 18
 * doesn't wire `onChange` for custom elements, so these wrappers set the live property and
 * listen to native events through a ref.
 */
function useBinding(
  prop: "value" | "checked",
  current: string | boolean,
  onEvent: (el: FieldElement) => void,
) {
  const ref = useRef<FieldElement>(null);
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = () => handler.current(el);
    el.addEventListener("input", listener);
    el.addEventListener("change", listener);
    return () => {
      el.removeEventListener("input", listener);
      el.removeEventListener("change", listener);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || el[prop] === current) return;
    if (prop === "checked") el.checked = Boolean(current);
    else el.value = String(current);
  }, [prop, current]);

  // Polaris element refs are typed per tag; one shared element shape is enough here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ref as React.RefObject<any>;
}

interface BaseProps {
  label: string;
  details?: string;
}

export function TextField({
  label,
  details,
  value,
  placeholder,
  onChange,
}: BaseProps & { value: string; placeholder?: string; onChange: (v: string) => void }) {
  const ref = useBinding("value", value, (el) => onChange(el.value ?? ""));
  return (
    <s-text-field ref={ref} label={label} details={details} placeholder={placeholder} value={value} />
  );
}

export function NumberField({
  label,
  details,
  value,
  min,
  max,
  suffix,
  onChange,
}: BaseProps & {
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const ref = useBinding("value", String(value), (el) => {
    const n = Number(el.value);
    if (el.value !== "" && Number.isFinite(n)) onChange(n);
  });
  return (
    <s-number-field
      ref={ref}
      label={label}
      details={details}
      value={String(value)}
      min={min}
      max={max}
      suffix={suffix}
    />
  );
}

export function Checkbox({
  label,
  details,
  checked,
  onChange,
}: BaseProps & { checked: boolean; onChange: (v: boolean) => void }) {
  const ref = useBinding("checked", checked, (el) => onChange(Boolean(el.checked)));
  return <s-checkbox ref={ref} label={label} details={details} {...(checked ? { checked: true } : {})} />;
}

export function Select({
  label,
  details,
  value,
  options,
  onChange,
}: BaseProps & {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const ref = useBinding("value", value, (el) => onChange(el.value ?? ""));
  return (
    <s-select ref={ref} label={label} details={details} value={value}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}
