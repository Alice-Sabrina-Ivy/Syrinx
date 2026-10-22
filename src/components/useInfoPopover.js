// useInfoPopover.js — open / close behaviour shared by the small "i"
// explainers (CueStrip's InfoToggle, SteadinessReadout).
//
// Closes on an outside tap, on Escape (focus goes back to the "i" button)
// and when keyboard focus leaves the toggle + its card; only one explainer
// is open at a time — opening one closes the other (2026-10-19 review S-4a:
// the fixed card stayed open over controls Tab had moved on to, and two
// could be open at once). The card gets tabIndex -1 so a tap on its text
// keeps focus inside instead of counting as focus leaving.

import { useCallback, useEffect, useId, useRef, useState } from "react";

let closeOpen = null; // the open explainer's close function, if any

export function useInfoPopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const tipId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    if (closeOpen && closeOpen !== close) closeOpen();
    closeOpen = close;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (wrapRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      if (closeOpen === close) closeOpen = null;
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // React's onBlur bubbles (focusout): close when focus moves outside the
  // wrapper. relatedTarget is null when focus goes nowhere (window blur,
  // a tap on a non-focusable area — the outside-tap handler covers that).
  const onBlur = useCallback((e) => {
    if (e.relatedTarget && wrapRef.current && !wrapRef.current.contains(e.relatedTarget)) setOpen(false);
  }, []);

  return { open, toggle: () => setOpen((o) => !o), wrapRef, buttonRef, tipId, onBlur };
}
