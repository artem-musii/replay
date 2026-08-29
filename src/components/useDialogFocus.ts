import { useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

interface DialogFocusOptions {
  active?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
  restoreFocus?: boolean;
}

let activeScrollLocks = 0;
let restoredDocumentOverflow = "";
let restoredBodyOverflow = "";

function lockBackgroundScroll(): () => void {
  if (activeScrollLocks === 0) {
    restoredDocumentOverflow = document.documentElement.style.overflow;
    restoredBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
  activeScrollLocks += 1;
  return () => {
    activeScrollLocks = Math.max(0, activeScrollLocks - 1);
    if (activeScrollLocks === 0) {
      document.documentElement.style.overflow = restoredDocumentOverflow;
      document.body.style.overflow = restoredBodyOverflow;
    }
  };
}

/**
 * Gives a modal dialog deterministic keyboard behavior without hiding any of
 * its domain-specific controls behind a generic dialog abstraction.
 */
export function useDialogFocus<T extends HTMLElement>({
  active = true,
  initialFocusRef,
  onEscape,
  restoreFocus = true,
}: DialogFocusOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);

  useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useLayoutEffect(() => {
    if (!active) return;
    const currentDialog = dialogRef.current;
    if (!currentDialog) return;
    const dialog: HTMLElement = currentDialog;

    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialTarget = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
    const unlockBackgroundScroll = lockBackgroundScroll();
    initialTarget.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const targets = focusableElements(dialog);
      if (targets.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = targets[0];
      const last = targets.at(-1);
      const current = document.activeElement;
      if (!first || !last) return;

      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      unlockBackgroundScroll();
      if (restoreFocus && invoker?.isConnected) invoker.focus();
    };
  }, [active, initialFocusRef, restoreFocus]);

  return dialogRef;
}
