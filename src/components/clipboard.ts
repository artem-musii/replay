export async function copyTextToClipboard(text: string): Promise<void> {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back to a local selection when the Clipboard API is unavailable or denied.
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  input.remove();
  previousFocus?.focus();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}
