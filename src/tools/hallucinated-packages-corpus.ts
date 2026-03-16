/**
 * Shim re-export to give consumers a valid module specifier for the
 * space-named corpus source file.  Import from this file instead of
 * importing directly from "Hallucinated Packages Corpus from Claude.ts".
 */
export {
  CONFIRMED_MALICIOUS,
  DOCUMENTED_HALLUCINATIONS,
  SUSPICIOUS_PATTERNS,
  INCOMPLETE_NAME_MAP,
  CORPUS_STATS,
  isLikelyHallucinated,
  scanPackageList,
  type PatternCheck,
  type HallucinationCheckResult,
  type NamedHallucinationCheckResult,
} from './Hallucinated Packages Corpus from Claude.js';
