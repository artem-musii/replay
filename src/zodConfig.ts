import { z } from "zod";

// REPLAY ships with a strict script-src policy. Skip Zod's optional Function()
// capability probe and use its CSP-compatible parser path everywhere.
z.config({ jitless: true });
