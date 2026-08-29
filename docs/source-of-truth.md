# REPLAY source of truth

External-source register last verified: **2026-08-27** (Europe/Madrid); the OpenAI Site Tools page and current release evidence were reconciled on **2026-08-29**. This file records external facts, resulting REPLAY decisions, and the current implementation caveats that materially affect those decisions. Detailed verification status remains in `IMPLEMENTATION_STATUS.md` and `docs/testing.md`.

## Authority order

When sources conflict, use this order:

1. The dated [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/) for the API shape.
2. Current [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp) for Chrome behavior, origin-trial details, and browser-specific guidance.
3. [OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp) for ChatGPT/Codex availability and behavior.
4. The [official Devpost rules](https://webmcp.devpost.com/rules) and [challenge page](https://webmcp.devpost.com/) for eligibility, deliverables, dates, and judging.
5. Current OpenAI model documentation for generated assets.

The WebMCP document is a **Draft Community Group Report dated 2026-08-26**, not a W3C Standard or Standards Track document. Feature detection and a fully functional non-WebMCP path are therefore required.

## Current WebMCP API decisions

### Imperative registration

The current registration surface is `document.modelContext.registerTool(...)`:

```ts
const registration = new AbortController();

if (typeof document !== "undefined" && typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool(
    {
      name: "get_case_summary",
      description: "Read a compact summary of the open REPLAY case.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: async (_input, { signal }) => {
        signal.throwIfAborted();
        return readCaseSummary();
      },
    },
    { signal: registration.signal },
  );
}

// Unregister when the page or relevant component lifecycle ends.
registration.abort();
```

Do not use older examples centered on `navigator.modelContext.provideContext(...)` or `navigator.modelContext.unregisterTool(...)`.

Current implications:

- A registration `AbortSignal` unregisters that tool when aborted.
- The `execute(input, { signal })` callback receives a separate cancellation signal for that invocation. The current registry/adapter checks it before adapter work, staging, persistence, and staged commit. Dexie does not consume this signal, so cancellation while a primary save is pending waits for that save's outcome.
- Chrome documents that, as of Chrome 153, unregistering a tool does not cancel an already in-flight execution. REPLAY must therefore handle invocation cancellation and lifecycle cleanup separately.
- A WebMCP mutation is reduced on an isolated complete engine copy, compare-and-swap saved, then committed/notified only while the live baseline still matches. Cancellation before primary persistence begins changes neither live nor durable state or audit. If cancellation or a live conflict follows a resolved save, the adapter performs an explicit compensating save before settling; failed compensation returns/audits `PERSISTENCE_FAILED`. This is reconciliation across two operations, not one physical Dexie/engine/browser-paint transaction. The ordinary human UI still commits live before its queued save and uses pause/retry/recovery on failure.
- `document.modelContext.getTools()` and `executeTool()` are useful for the debug/evaluation surface where supported; they are not needed for normal application behavior.

### Tool annotations

The 2026-08-26 draft defines these optional hints, both defaulting to `false`:

```ts
annotations: {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}
```

- `readOnlyHint: true` means the tool does not mutate state. It is a hint, not an authorization mechanism.
- `untrustedContentHint: true` means the output contains data the registering site considers untrusted. Use it for user statements, notes, filenames, evidence metadata, imported content, and hypothesis text.
- Tool definitions, annotations, and returned data are themselves untrusted from an agent/client perspective. Application authorization and validation remain mandatory.

### Declarative forms

Chrome’s Declarative API derives a tool from an ordinary visible HTML form:

```html
<form
  toolname="finalize_factual_report"
  tooldescription="Prepare the reviewed factual report for manual human finalization."
>
  <label for="reviewer-note">Review note</label>
  <textarea
    id="reviewer-note"
    name="reviewerNote"
    toolparamdescription="A non-sensitive note for the human reviewer."
  ></textarea>
  <button type="submit">Finalize factual report</button>
</form>
```

REPLAY's implemented form uses `toolname="finalize_factual_report"`, includes `tooldescription`, and omits `toolautosubmit`. In a compatible declarative client, its `toolactivated` listener marks the review prepared and opens the visible review; `toolcancel` clears the prepared state. A person must review the fingerprint-bound material, complete four acknowledgements—including every labelled unconfirmed or hypothesis statement—continue to a second confirmation, and click the final control. The reducer independently rejects agent/WebMCP finalization. Browser-native active-state styling and event behavior still require verification in a current compatible browser.

### Registration strategy

- Keep a stable base set while a case workspace is open.
- Register scene tools only while a scene exists.
- Register fact/evidence/question tools while factual workspace data is available.
- Register hypothesis tools, including report-preview construction, only after a baseline branch exists.
- Register the report-note tool only after a preview exists. Declarative `finalize_factual_report` is owned by the visible report form rather than the imperative registry.
- Prefer static registration; change the set only at meaningful application-state boundaries.
- Use narrow, non-overlapping schemas. Do not expose a generic command executor.
- Reuse the same validated domain commands as the human UI.
- Do not expose a Site Tool for human completeness attestations. An agent may surface completeness issues, but only a visible human UI command may record or withdraw reviewed no-evidence, actor-damage, or uncertainty outcomes.
- Return compact results after a changed WebMCP command has been staged, compare-and-swap saved, and committed/notified. A rejected primary save leaves the live engine untouched; post-save cancellation/live conflict is compensated when possible. Actual browser paint is not transactionally coupled to the tool promise and remains a live-browser verification point.

### Origin and permissions boundary

Chrome gates WebMCP behind origin isolation and the `tools` Permissions Policy:

- Deploy over HTTPS.
- Do not set `document.domain` or `Origin-Agent-Cluster: ?0`; either makes the document ineligible.
- Send `Permissions-Policy: tools=(self)` (the policy defaults to `self`, but REPLAY sets it explicitly).
- Keep tools in the top-level, same-origin application. REPLAY has no need for cross-origin frames, `exposedTo`, or `getTools({ fromOrigins })`.
- Do not render code that touches `document.modelContext` during server rendering; register after client hydration.

Chrome lists the origin trial from Chrome 149 and the local flag `chrome://flags/#enable-webmcp-testing`. WebMCP is still evolving, so the manual UI must remain complete when the API is absent.

## OpenAI Site Tools facts

The live [Site Tools page](https://learn.chatgpt.com/docs/webmcp), rechecked 2026-08-28, says:

- Site Tools are ChatGPT’s implementation of the proposed WebMCP standard.
- ChatGPT Work and Codex can discover tools from the page open in the desktop app’s built-in browser; human and agent share the same live page and signed-in session.
- The current built-in browser discovers top-level imperative JavaScript tools. It does not expose declarative HTML form tools as Site Tools or discover tools inside iframes. ChatGPT Work and Codex may still interact with forms using ordinary browser capabilities, but those interactions are not WebMCP tool calls.
- Tools belong to their originating page and may disappear after navigation or page closure.
- GPT-5.6 Sol and GPT-5.6 Terra support Site Tools; GPT-5.6 Luna currently has WebMCP disabled.
- Site Tools are not currently available in Enterprise or Edu workspaces, and rollout/page availability still applies.
- Each call receives browser safety review, remains tied to its originating page and registration, and does not make the site or result trustworthy.
- OpenAI recommends narrow inputs, explicit side effects, existing app authentication/authorization/validation, enough output to verify a result, and preserving the ordinary UI as fallback.

REPLAY consequently treats ChatGPT/Codex testing as a compatibility target, not an availability guarantee. Its declarative `finalize_factual_report` form remains a standards/Chrome-compatible human gate; OpenAI Site Tools flows use the imperative preview tool and manual report UI rather than claiming that form is tool-discoverable. Any ordinary browser interaction is a separate capability and must not be presented as a declarative/WebMCP call or as authorization to operate human claim-confirmation, completeness-attestation, proposal-decision, or finalization controls.

## Current release-evidence boundary

Payload-origin commit `b252fbde9551d0a1d2c41a1282ced66dc8ae1b20` passed GitHub Actions run `33274844653` with **460/460 Vitest tests across 37 files**, **230 Playwright project runs: 221 passed, 9 intentional skips, and 0 failed**, and **12/12 configured-base focused runs**. The live `release-evidence.json` names the latest clean wrapper commit; documentation/test-only wrappers remain the same application payload when the endpoint still reports **46 public payload files / 5,297,092 bytes** and manifest SHA-256 `22c26f2b61944986272a28d7568fd1421b96b62d37e07dec60fd34895f2aa9c9`. These are clean CI, artifact-publication, and exact live-payload verification results; they do not by themselves prove a live product journey or model behavior.

The fresh guide/scene/path browser smoke, 18-tool Codex discovery, and cache-busted Lighthouse 100/100/100/100 audit were recorded against superseded seed-v3 commit `00688d8a51fb783dbf147e08ece60470b8877544`. They remain historical evidence for that exact artifact and are not attributed to the current `b252fbde` release, a supported-model execution trace, or declarative-form verification.

Therefore the repository still does not claim a current supported-model pass rate, broad current-client compatibility, native declarative activation/cancel, cross-browser/screen-reader conformance, broad downloaded-export fidelity, or production response-policy deployment. The exact 5,297,092-byte `586c81a3...` release payload passed the automated 12/12 matrix; deterministic tests prove one-actor complete start-to-final proposal semantics and preview-only geometry until human acceptance. A separate local stress run proved reliable exact-impact continuation across 50/50 repeated checks and 20/20 mixed critical journeys. A cache-busted current-public operator smoke confirmed both one-click continuation paths and visibly inspected the published single-change/full-path proposal schema plus separate impact semantics with no console error or failed dynamic request. The ordinary browser lacked `document.modelContext`, so this is product/contract evidence rather than native invocation. Operator-directed bridge traces and Lighthouse measurements remain historical to `cd88755b`. A finalized PDF downloaded by the current automated journey was parsed and rendered across all four pages without clipping or broken glyphs. None of this establishes supported-model choice, captures **Recently used/Sources**, exercises a current live mutation/lifecycle, or proves broad cross-client behavior. GitHub Pages ignores `_headers` and shares its origin; a dedicated header-capable origin remains necessary for response-policy claims. The public YouTube deliverable is also outstanding.

## Chrome engineering guidance adopted by REPLAY

From Chrome’s best-practice, security, and eval guidance:

- One tool should perform one clear function; overlapping tools reduce selection accuracy.
- Names and descriptions should distinguish starting a process from completing an action.
- Validate strictly in code even when the JSON Schema is descriptive.
- Update the visible interface before reporting success.
- Set `untrustedContentHint` on externally sourced or user-generated outputs and `readOnlyHint` on non-mutating tools.
- Keep names, descriptions, parameters, and outputs concise. Chrome’s current guidance suggests about 30 characters for names, 500 for tool descriptions, 150 per parameter description, and 1.5K per individual output.
- Use deterministic tests for tool logic, registration lifecycle, state effects, and outputs; use probabilistic evals for intent understanding, tool choice, arguments, ordering, and complete journeys.
- Eval datasets should include both direct and ambiguous intents and should present the complete tool set available in the evaluated state.

## Challenge requirements and judging

The [challenge page](https://webmcp.devpost.com/) and [official rules](https://webmcp.devpost.com/rules) were retrieved 2026-08-27. The rules govern over plugin-generated summaries.

### Dates

- Submission period: **2026-08-25 11:00 PT through 2026-09-03 13:00 PT**.
- Judging: **2026-09-04 10:00 PT through 2026-09-21 17:00 PT**.
- Winners: on or around **2026-09-23 14:00 PT**.

### Project and submission checklist

- Build a WebMCP-powered web app in which humans and agents interact, collaborate, and create together.
- The project must run consistently on its declared platform and match the video/text description.
- A pre-existing project must be meaningfully extended with WebMCP during the submission period and document that new work.
- Provide a working live URL accessible in ChatGPT’s in-app browser or WebMCP-enabled Chrome.
- Provide an English text description explaining fit for WebMCP, UX improvement, newly possible human-agent collaboration, and the WebMCP implementation.
- Provide a **public YouTube demo under three minutes**, with audio, showing both the working project and how WebMCP is used.
- Provide a public GitHub, GitLab, or Bitbucket repository with all required source, assets, functional instructions, and a visible open-source license.
- Use only third-party SDKs, APIs, data, trademarks, music, and other material for which the entrant has the necessary rights.
- Keep the project available free of charge and without testing restrictions through the end of judging; provide credentials in testing instructions if access is private.

Stage one is a pass/fail viability and required-API fit check. Stage two uses four **equally weighted** criteria:

1. **WebMCP Leverage** — thorough, skillful, working, non-trivial use.
2. **Execution** — a complete, coherent, runnable product rather than a proof of concept.
3. **Potential Impact** — a credible, specific problem and audience addressed by what is demonstrated.
4. **Creativity & Ambition** — novelty and differentiation.

Tie-breaking compares the criteria in listed order, so WebMCP Leverage is the first tie-breaker.

## Image-generation provenance

The [GPT Image 2 model page](https://developers.openai.com/api/docs/models/gpt-image-2), retrieved 2026-08-27, identifies `gpt-image-2` as OpenAI’s current state-of-the-art image generation and editing model with text input plus image input/output. The dated snapshot listed is `gpt-image-2-2026-04-21`. The [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) documents current generation/editing use.

Those pages are background research, not proof of which model generated REPLAY’s assets. REPLAY used Codex's built-in image-generation mode, whose returned artifacts did not expose a reliable underlying model identifier. The repository therefore does not claim a specific generation model or snapshot. The runtime application does not call an image API, require an API key, or send user evidence to an image service.

## Product safety facts that must remain visible

REPLAY organizes and visualizes an account; it does not determine legal liability, establish fault, provide legal advice, perform a forensic-certified reconstruction, calculate evidentiary collision physics, assess truthfulness, or replace police, legal, insurance, or professional investigation. Reports must keep confirmed observations, reported details, evidence, unresolved questions, disputes, and agent hypotheses distinct.

## Official source register

| Source                                                                                          | Source date shown          | Verified   | Used for                                                                 |
| ----------------------------------------------------------------------------------------------- | -------------------------- | ---------- | ------------------------------------------------------------------------ |
| [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)             | 2026-08-26                 | 2026-08-27 | API dictionaries, annotations, signals, declarative API, security model  |
| [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp)                           | Updated 2026-08-07         | 2026-08-27 | availability, origin isolation, permissions policy, fallback             |
| [Chrome Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)             | Updated 2026-08-20         | 2026-08-27 | registration, unregister, cancellation, discovery, cross-origin behavior |
| [Chrome Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api)           | Published 2026-05-18       | 2026-08-27 | form attributes, manual submit, events, focus styles                     |
| [Chrome best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)             | Published 2026-05-18       | 2026-08-27 | tool strategy, schemas, reliability, eval-driven development             |
| [Chrome tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)                | Updated 2026-07-01         | 2026-08-27 | prompt injection, annotations, exposure, output budgets                  |
| [Chrome WebMCP evals](https://developer.chrome.com/docs/ai/webmcp/evals)                        | Header updated 2026-05-28  | 2026-08-27 | deterministic tests, probabilistic evals, direct/ambiguous datasets      |
| [OpenAI Site Tools](https://learn.chatgpt.com/docs/webmcp)                                      | Live page                  | 2026-08-28 | ChatGPT/Codex behavior and model/workspace availability                  |
| [WebMCP Challenge](https://webmcp.devpost.com/)                                                 | Live challenge             | 2026-08-27 | requirements, deadline, judging summary                                  |
| [Official challenge rules](https://webmcp.devpost.com/rules)                                    | 2026 challenge rules       | 2026-08-27 | dates, eligibility, submission requirements, judging/tie-breaks          |
| [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) | Live API docs              | 2026-08-27 | background generation/editing guidance; not REPLAY asset provenance      |
| [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)                        | Snapshot 2026-04-21 listed | 2026-08-27 | background model reference; not proof of the built-in tool's model       |
