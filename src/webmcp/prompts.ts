const SITE_TOOLS_ONLY_BOUNDARY =
  "Use only this page's native Site Tools (WebMCP) for this request. Do not use computer use or browser UI controls: do not click, type, scroll, inspect screenshots, or operate the page visually. If the page's Site Tools are not available, stop and tell me that instead of using another interaction method.";

/**
 * Keeps copyable agent requests on the structured WebMCP surface. The page is
 * already open when these prompts are used, so browser or computer control is
 * neither necessary nor authorized.
 */
export function siteToolsOnlyRequest(task: string): string {
  return `${SITE_TOOLS_ONLY_BOUNDARY} With native Site Tools, ${task}`;
}

export function buildSimpleAgentReviewPrompt(question: string): string {
  return siteToolsOnlyRequest(
    `review this unresolved question: "${question}" Read the live scene, timeline, related evidence links, human statements, and full consistency results. Focus this question, then create the smallest reversible scene proposal that would help a person examine it. Keep current claims, endpoints, times, unrelated geometry, and the baseline unchanged. Explain the evidence in scope, missing support, uncertainty, contradictions, and what remains unresolved. Do not apply the proposal, answer or confirm a claim, finalize a report, or infer fault.`,
  );
}
