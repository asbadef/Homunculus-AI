// Homunculus recommends; it never orders. The charter rule is enforced here as a test rather than
// as a comment, because a comment survives review and a failing test does not.

/**
 * The verbs reco/engine.py permits at the head of a recommendation. What makes a sentence an order
 * is the verb that governs the clinician, and that verb is the first word — "Review whether
 * antibiotics can be given" recommends, while "Give antibiotics" orders, though both contain the
 * same stem.
 */
const APPROVED_OPENERS = new Set([
  "consider", "review", "assess", "evaluate", "monitor",
  "değerlendirin", "inceleyin", "izleyin", "gözden",
]);

/** Whole tokens we never write in our own Turkish or English UI copy. */
const FORBIDDEN_TOKENS = new Set([
  "verin", "veriniz", "uygulayın", "uygulayınız", "başlayın", "başlatın",
  "enjekte", "reçete", "order", "orders", "administer", "prescribe", "inject", "give",
]);

/** Split on anything that is not a letter or digit, lowercased with Turkish casing rules. */
export function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("tr")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function isRecommendation(text: string): boolean {
  const [first] = tokenize(text);
  return first !== undefined && APPROVED_OPENERS.has(first);
}

/** Whole-token matching, so "veri" never trips the rule meant for "verin". */
export function findForbiddenTokens(text: string): string[] {
  return tokenize(text).filter((token) => FORBIDDEN_TOKENS.has(token));
}
