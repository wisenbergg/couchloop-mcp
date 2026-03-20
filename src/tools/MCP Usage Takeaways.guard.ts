import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GovernancePipeline,
  type InterventionAction,
  type SessionContext,
} from "../governance/evaluationEngine.js";
import { InterventionEngine } from "../governance/intervention.js";
import { loadConfig } from "../governance/config.js";
import {
  scanPackageList,
  CORPUS_STATS,
  type NamedHallucinationCheckResult,
} from "./hallucinated-packages-corpus.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GuardMode = "enforce" | "shadow" | "bypass";
type DomainType = "dev" | "clinical" | "auto";
type ActionType = "pass" | "modified" | "blocked";

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface GuardResult {
  action: ActionType;
  response: string;
  intervention?: {
    type: string;
    reason: string;
    confidence: number;
    original_response?: string;
  };
  domain_detected: "dev" | "clinical" | "unknown";
  evaluation_id: string;
  elapsed_ms: number;
  mode: GuardMode;
  corpus_version: string;
  detector_results?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain detection signals
// ─────────────────────────────────────────────────────────────────────────────

const DEV_SIGNALS = [
  /\b(npm|yarn|pnpm|pip|cargo|gem)\s+install\b/i,
  /\b(import|require|from)\s+['"][^'"]+['"]/i,
  /\b(function|class|const|let|var|async|await|interface|type)\b/,
  /\b(error|exception|stack\s*trace|undefined|null|NaN)\b/i,
  /\b(git|commit|branch|merge|pull\s*request|PR)\b/i,
  /\b(API|endpoint|REST|GraphQL|webhook|SDK)\b/i,
  /\b(docker|kubernetes|CI\/CD|pipeline|deploy)\b/i,
  /\b(typescript|javascript|python|rust|golang|node\.?js)\b/i,
];

const CLINICAL_SIGNALS = [
  /\b(suicid|self.harm|self.injur|overdose|end\s+my\s+life|want\s+to\s+die)\b/i,
  /\b(depressed|depression|anxiety|anxious|panic|dissociat)\b/i,
  /\b(therapist|psychiatrist|medication|diagnosis|disorder|mental\s+health)\b/i,
  /\b(trauma|PTSD|abuse|grief|loss|overwhelmed|hopeless)\b/i,
  /\b(cutting|burning|starving|purging|binge)\b/i,
  /\b(crisis|hotline|emergency|911|hospital)\b/i,
];

function detectDomain(
  conversation: ConversationTurn[],
  responseDraft: string
): "dev" | "clinical" | "unknown" {
  const fullText = [
    ...conversation.map((t) => t.content),
    responseDraft,
  ].join(" ");

  // Clinical takes priority — safety first
  const clinicalScore = CLINICAL_SIGNALS.filter((s) => s.test(fullText)).length;
  if (clinicalScore >= 1) return "clinical";

  const devScore = DEV_SIGNALS.filter((s) => s.test(fullText)).length;
  if (devScore >= 2) return "dev";

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Package extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractPackageNames(text: string): string[] {
  const names: string[] = [];

  // npm/yarn/pnpm install commands
  const installPattern =
    /(?:npm|yarn|pnpm)\s+(?:install|add|i)\s+((?:@?[\w][\w.-]*\/[\w.-]+|[\w][\w.-]*)(?:\s+(?:@?[\w][\w.-]*\/[\w.-]+|[\w][\w.-]*))*)/g;
  let match;
  while ((match = installPattern.exec(text)) !== null) {
    const pkgs = match[1]
      .split(/\s+/)
      .map((p) => p.replace(/^-+.*$/, "").trim()) // drop flags
      .filter((p) => p && !p.startsWith("-") && !p.startsWith("@") || p.startsWith("@"));
    names.push(...pkgs.filter(Boolean));
  }

  // import/require statements
  const importPattern =
    /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*)['"](@?[\w][\w.-]*(?:\/[\w.-]+)?)['"]/g;
  while ((match = importPattern.exec(text)) !== null) {
    // Only flag third-party (not relative paths)
    if (!match[1].startsWith(".") && !match[1].startsWith("/")) {
      names.push(match[1]);
    }
  }

  return [...new Set(names)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Crisis signal detection (fast pre-check before full pipeline)
// ─────────────────────────────────────────────────────────────────────────────

function hasCrisisSignals(turns: ConversationTurn[]): boolean {
  const recentUserTurns = turns
    .filter((t) => t.role === "user")
    .slice(-5)
    .map((t) => t.content)
    .join(" ");

  return CLINICAL_SIGNALS.some((s) => s.test(recentUserTurns));
}

// ─────────────────────────────────────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────────────────────────────────────

function generateEvaluationId(): string {
  return `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerGuardTool(server: McpServer): void {
  server.tool(
    "guard",
    [
      "Silent conversation governance layer. Call this on every response before delivering it to the user.",
      "",
      "Evaluates the draft response against hallucination, inconsistency, tone drift,",
      "and unsafe reasoning detectors. Intervenes silently when thresholds are crossed.",
      "",
      "Actions:",
      "  pass     — response is clean, deliver as-is",
      "  modified — response was corrected, deliver the returned response instead",
      "  blocked  — response was unsafe, deliver the returned safe fallback",
      "",
      "Modes:",
      "  enforce (default) — evaluate and apply interventions",
      "  shadow            — evaluate and log only, always pass original through",
      "  bypass            — skip evaluation entirely",
      "",
      `Corpus: ${CORPUS_STATS.confirmedMalicious} confirmed malicious, ${CORPUS_STATS.documentedHallucinations} documented hallucinations, ${CORPUS_STATS.incompleteNameMappings} name mappings, ${CORPUS_STATS.suspiciousPatterns} pattern rules. Last updated ${CORPUS_STATS.lastUpdated}.`,
    ].join("\n"),
    {
      response: z
        .string()
        .describe("The draft response about to be delivered to the user"),
      conversation: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        )
        .optional()
        .default([])
        .describe("Recent conversation history (last 5-10 turns recommended)"),
      domain: z
        .enum(["dev", "clinical", "auto"])
        .optional()
        .default("auto")
        .describe(
          "Governance domain. 'auto' detects from conversation context. Clinical always takes priority."
        ),
      session_id: z
        .string()
        .optional()
        .describe("Session identifier for audit trail continuity"),
      mode: z
        .enum(["enforce", "shadow", "bypass"])
        .optional()
        .default("enforce")
        .describe(
          "enforce=apply interventions, shadow=log-only, bypass=skip evaluation"
        ),
    },
    async ({
      response,
      conversation = [],
      domain = "auto",
      session_id,
      mode = "enforce",
    }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const startTime = Date.now();
      const evaluationId = generateEvaluationId();

      // ── bypass mode ──────────────────────────────────────────────────────
      if (mode === "bypass") {
        const result: GuardResult = {
          action: "pass",
          response,
          domain_detected: "unknown",
          evaluation_id: evaluationId,
          elapsed_ms: Date.now() - startTime,
          mode: "bypass",
          corpus_version: CORPUS_STATS.lastUpdated,
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      try {
        // ── domain detection ─────────────────────────────────────────────
        const domainDetected: "dev" | "clinical" | "unknown" =
          domain === "auto"
            ? detectDomain(conversation, response)
            : domain;

        const config = await loadConfig();
        let action: ActionType = "pass";
        let finalResponse = response;
        let intervention: GuardResult["intervention"] | undefined;
        let detectorResults: Record<string, unknown> = {};

        // ── dev path ─────────────────────────────────────────────────────
        if (domainDetected === "dev" || domainDetected === "unknown") {
          // Fast corpus check first — no API call needed
          const packageNamesInResponse = extractPackageNames(response);
          const flaggedPackages: NamedHallucinationCheckResult[] = scanPackageList(packageNamesInResponse);

          if (flaggedPackages.length > 0) {
            const topFlag = flaggedPackages[0];
            const alternatives = flaggedPackages
              .filter((f) => f.suggestedAlternative)
              .map((f) => `${f.name} → ${f.suggestedAlternative}`)
              .join(", ");

            detectorResults.hallucination = {
              flagged: true,
              alternatives_summary: alternatives || null,
              packages: flaggedPackages.map((f) => ({
                name: f.name,
                confidence: f.confidence,
                reason: f.reason,
                source: f.source,
                alternative: f.suggestedAlternative,
              })),
            };

            if (mode === "enforce") {
              // Build corrected response
              let correctedResponse = response;
              for (const flag of flaggedPackages) {
                if (flag.suggestedAlternative) {
                  // Replace the package name in install commands and imports
                  const installRegex = new RegExp(
                    `((?:npm|yarn|pnpm)\\s+(?:install|add|i)\\s+[^\\n]*?)\\b${escapeRegex(flag.name)}\\b`,
                    "gi"
                  );
                  correctedResponse = correctedResponse.replace(
                    installRegex,
                    (m, prefix) =>
                      `${prefix}${flag.suggestedAlternative} /* ⚠ was: ${flag.name} */`
                  );
                }
              }

              const wasModified = correctedResponse !== response;
              action = topFlag.source === "confirmed_malicious" ? "blocked" : wasModified ? "modified" : "pass";

              if (action !== "pass") {
                finalResponse =
                  action === "blocked"
                    ? buildBlockedFallback(topFlag.reason, topFlag.suggestedAlternative)
                    : correctedResponse;

                intervention = {
                  type:
                    action === "blocked"
                      ? "package_hallucination_blocked"
                      : "package_hallucination_corrected",
                  reason: topFlag.reason,
                  confidence: topFlag.confidence === "high" ? 0.95 : topFlag.confidence === "medium" ? 0.7 : 0.45,
                  original_response: response,
                };
              }
            }
          }

          // Full pipeline for dev (hallucination + inconsistency only — tone/unsafe disabled for dev)
          if (action === "pass" && domainDetected === "dev") {
            try {
              const sessionCtx: SessionContext = {
                sessionId: session_id ?? evaluationId,
                domain: "dev",
                conversationHistory: conversation,
              };

              const pipelineResult = await GovernancePipeline.evaluate(
                response,
                sessionCtx,
                {
                  enabledDetectors: ["hallucination", "inconsistency"],
                }
              );

              detectorResults = {
                ...detectorResults,
                pipeline: pipelineResult.detectorResults,
              };

              if (pipelineResult.requiresIntervention && mode === "enforce") {
                const interventionResult = await InterventionEngine.intervene(
                  response,
                  pipelineResult,
                  sessionCtx
                );

                if (interventionResult.action !== "approve") {
                  action =
                    interventionResult.action === "block" ? "blocked" : "modified";
                  finalResponse = interventionResult.modifiedResponse ?? response;
                  intervention = {
                    type: `pipeline_${interventionResult.action}`,
                    reason: interventionResult.reason ?? "Governance pipeline intervention",
                    confidence: interventionResult.confidence ?? 0.8,
                    original_response: response,
                  };
                }
              }
            } catch {
              // Pipeline failure — fail open, don't block user
            }
          }
        }

        // ── clinical path ────────────────────────────────────────────────
        if (domainDetected === "clinical") {
          const crisisDetected = hasCrisisSignals(conversation);

          detectorResults.crisis_pre_check = {
            flagged: crisisDetected,
            turns_analyzed: Math.min(conversation.filter((t) => t.role === "user").length, 5),
          };

          try {
            const sessionCtx: SessionContext = {
              sessionId: session_id ?? evaluationId,
              domain: "clinical",
              conversationHistory: conversation,
              crisisSignalsDetected: crisisDetected,
            };

            const pipelineResult = await GovernancePipeline.evaluate(
              response,
              sessionCtx,
              {
                enabledDetectors: [
                  "hallucination",
                  "inconsistency",
                  "toneDrift",
                  "unsafeReasoning",
                ],
              }
            );

            detectorResults = {
              ...detectorResults,
              pipeline: pipelineResult.detectorResults,
            };

            if (pipelineResult.requiresIntervention && mode === "enforce") {
              const interventionResult = await InterventionEngine.intervene(
                response,
                pipelineResult,
                sessionCtx
              );

              if (interventionResult.action !== "approve") {
                action =
                  interventionResult.action === "block" ? "blocked" : "modified";
                finalResponse = interventionResult.modifiedResponse ?? response;
                intervention = {
                  type: `clinical_${interventionResult.action}`,
                  reason: interventionResult.reason ?? "Clinical governance intervention",
                  confidence: interventionResult.confidence ?? 0.85,
                  original_response: response,
                };
              }
            }
          } catch {
            // Pipeline failure — fail open
          }
        }

        // ── shadow mode override ─────────────────────────────────────────
        // Evaluated, logged, but always passes original through
        if (mode === "shadow") {
          action = "pass";
          finalResponse = response;
        }

        const result: GuardResult = {
          action,
          response: finalResponse,
          ...(intervention ? { intervention } : {}),
          domain_detected: domainDetected,
          evaluation_id: evaluationId,
          elapsed_ms: Date.now() - startTime,
          mode,
          corpus_version: CORPUS_STATS.lastUpdated,
          detector_results: detectorResults,
        };

        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        // Top-level failure — always fail open
        const result: GuardResult = {
          action: "pass",
          response,
          domain_detected: "unknown",
          evaluation_id: evaluationId,
          elapsed_ms: Date.now() - startTime,
          mode,
          corpus_version: CORPUS_STATS.lastUpdated,
          detector_results: {
            error: err instanceof Error ? err.message : "Unknown governance error",
            fail_open: true,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBlockedFallback(reason: string, alternative?: string): string {
  const parts = [
    "⚠️ I can't recommend that package — it has been flagged as a confirmed malicious or hallucinated package name.",
    reason,
  ];
  if (alternative) {
    parts.push(`The package you may be looking for is: **${alternative}**`);
  }
  parts.push("Please verify any package name before installing.");
  return parts.join("\n\n");
}

// Named export for primary-tools.ts registration
export const guardTool = registerGuardTool;
