import React, { useLayoutEffect, useRef, useState } from "react";
import "./Collapse.css";

/** Retain content through the closing transition, then release its DOM and effects. */
export default function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useLayoutEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setMounted(true);
      frame = requestAnimationFrame(() => {
        element.current?.getBoundingClientRect();
        setShown(true);
      });
    } else {
      setShown(false);
      timer = setTimeout(() => setMounted(false), 260);
    }
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [open]);
  return (
    <div
      ref={(node) => {
        element.current = node;
        node?.toggleAttribute("inert", !open);
      }}
      className={`app-collapse ${shown ? "app-collapse--open" : ""}`}
      aria-hidden={!open}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === "grid-template-rows" &&
          !open
        )
          setMounted(false);
      }}
    >
      <div className="app-collapse-inner">{mounted ? children : null}</div>
    </div>
  );
}
