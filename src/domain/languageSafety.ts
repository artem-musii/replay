const NEGATED_LIABILITY_PHRASE =
  /\b(?:(?:does?|did|can|could|should|would|will)\s+not|cannot|without)\s+(?:determin(?:e|ing)|establish(?:ing)?|assign(?:ing)?|conclud(?:e|ing)|find(?:ing)?|show(?:ing)?)?\s*(?:fault|(?:legal\s+)?liability|responsibility|blame)(?:\s+(?:or|and)\s+(?:fault|(?:legal\s+)?liability|responsibility|blame))?\b/gi;

const NEGATED_DIRECT_LIABILITY_PHRASE =
  /\b(?:(?:is|are|was|were)\s+not\s+(?:necessarily\s+|legally\s+|solely\s+)?(?:at fault|liable|responsible|to blame|guilty|culpable|negligent|reckless)|(?:does?|did)\s+not\s+(?:bear responsibility|commit negligence|violate (?:the )?law|fail to yield|cause (?:the )?(?:collision|crash|incident)))\b/gi;

const LIABILITY_CONCLUSION =
  /\b(?:at fault|(?:is|are|was|were|appears?|seems?)\s+(?:legally\s+)?liable|(?:has|have|had|bears?|accepts?|carries?)\s+(?:legal\s+)?liability|(?:legal\s+)?liability\s+(?:rests?|lies?)\s+with|liability\s+(?:is|was)\s+(?:clear|established|proven|confirmed)|caused (?:the )?(?:collision|crash|incident)|responsible(?: for (?:the )?(?:collision|crash|incident))?|bears? responsibility|to blame|guilty|culpable|negligent|committed negligence|reckless|violated (?:the )?law|failed to yield)\b/i;

/** Detects adopted fault/liability wording while allowing explicit non-determination disclaimers. */
export function containsLiabilityConclusion(text: string): boolean {
  return LIABILITY_CONCLUSION.test(
    text.replace(NEGATED_LIABILITY_PHRASE, "").replace(NEGATED_DIRECT_LIABILITY_PHRASE, ""),
  );
}

export function evidenceBoundText(text: string): string {
  return containsLiabilityConclusion(text)
    ? "A source supplied a fault or liability allegation. It remains source-attributed and REPLAY does not adopt it as a conclusion."
    : text;
}

/**
 * Truncates to a UTF-16 code-unit limit without leaving a dangling surrogate.
 * Callers still validate untrusted text separately; this helper only makes
 * length-bounded, already XML-safe strings remain XML-serializable.
 */
export function truncateXmlSafeText(value: string, maxCodeUnits: number): string {
  if (!Number.isInteger(maxCodeUnits) || maxCodeUnits < 0) {
    throw new RangeError("The XML-safe text limit must be a non-negative integer");
  }
  if (value.length <= maxCodeUnits) return value;
  if (maxCodeUnits === 0) return "";
  let end = maxCodeUnits;
  const lastCodeUnit = value.charCodeAt(end - 1);
  const nextCodeUnit = value.charCodeAt(end);
  if (
    lastCodeUnit >= 0xd800 &&
    lastCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}
