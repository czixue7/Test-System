import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface Option {
  value: string;
  label: string;
  hint?: string;
}
interface Props {
  label: string;
  value: string;
  options: Option[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** A themed settings picker. Keep the menu outside the folding card's clipping area. */
export default function SettingsSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: Props) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 240,
    transform: "none",
  });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options.find((option) => option.value === value);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (index = selected) => {
    if (disabled || !options.length) return;
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const right =
        (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth);
      const wanted = Math.min(240, options.length * 52 + 12);
      const above =
        bottom - rect.bottom - 12 < wanted &&
        rect.top - top > bottom - rect.bottom;
      const maxHeight = Math.min(
        240,
        Math.max(52, above ? rect.top - top - 12 : bottom - rect.bottom - 12),
      );
      const width = Math.min(rect.width, right - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.left, right - width - 12)),
        top: above ? rect.top - 6 : rect.bottom + 6,
        width,
        maxHeight,
        transform: above ? "translateY(-100%)" : "none",
      });
    };
    place();
    menu.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!field.current?.contains(target) && !menu.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const search = useRef("");
  const lastKeyTime = useRef(0);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) show(selected);
      else
        setActive(
          (index) => (index + direction + options.length) % options.length,
        );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : options.length - 1;
      if (open) setActive(index);
      else show(index);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else show();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab" && open) {
      close(true);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      search.current =
        (now - lastKeyTime.current > 600 ? "" : search.current) +
        event.key.toLocaleLowerCase();
      lastKeyTime.current = now;
      const index = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(search.current),
      );
      if (index >= 0) {
        event.preventDefault();
        if (open) setActive(index);
        else show(index);
      }
    }
  };
  return (
    <div className="ds-select-field" ref={field}>
      <span className="ds-select-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="ds-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={disabled || !options.length}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="ds-select-value">{current?.label ?? "请选择"}</span>
        <svg
          className="ds-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="data-settings ds-select-layer" style={position}>
            <div
              ref={menu}
              className="ds-select-menu"
              id={`${id}-menu`}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={`${id}-label`}
              aria-activedescendant={`${id}-option-${active}`}
              onKeyDown={onKeyDown}
              style={{ maxHeight: position.maxHeight }}
            >
              {options.map((option, index) => (
                <div
                  role="option"
                  key={option.value}
                  id={`${id}-option-${index}`}
                  aria-selected={option.value === value}
                  className={`ds-select-option ${index === active ? "is-highlighted" : ""}`}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span className="ds-select-option-copy">
                    <span>{option.label}</span>
                    {option.hint && <small>{option.hint}</small>}
                  </span>
                  {option.value === value && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
