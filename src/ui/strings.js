// UI copy (SPEC v3 §4). UI language = English by default; only inherently-Chinese
// CONTENT stays Chinese (gloss_cn, the user's own Chinese input, AI answers) — and
// that content is NOT here, it flows through from the data/model. Centralizing the
// chrome here makes the English sweep one place and sets up the future language
// toggle (v3 §8): swap this map, the UI follows.
//
// Card-field prefixes (intentPrefix / examplePrefix) are shared by every view that
// renders a candidate card (capture, review, retrieve, graph), so they live here
// once instead of being retyped per file.

export const UI = {
  // candidate-card field prefixes — the value that follows keeps its own language
  intentPrefix: "Intent: ",
  examplePrefix: "e.g. ",

  // capture
  enrichProvider: "Enrich provider",
  apiKeyPlaceholder: "API key (stored on-device only)",
  quickLookupPlaceholder: 'e.g. "紫苏" or "perilla"',
  qaSourcePlaceholder: 'Source line, e.g. "He got absolutely shredded this year"',
  qaQuestionPlaceholder: "Your question (optional)",
  idiomaticPlaceholder: 'Chinese intent, e.g. "我还有3组，但力竭了，组间休息会久一点"',
  idiomaticButton: "Get idiomatic",
  relatedLabel: "Already saved · same intent",

  // proper nouns (v4 §1)
  properNounToggle: "Proper noun",
  properNounHint: "a name (person / brand / company / place) — just how to say it",
  pronApproximate: "approximate — no single settled US reading",

  // detail panel / note (v3 §2b, §6)
  noteLabel: "Note",
  notePlaceholder: "Your own note — when, where, how you'd use it…",
  detailHint: "Open",

  // deep-dive
  deepDiveLabel: "Deep-dive",
  deepDiveNoKey: "Add your provider's API key in Capture first.",

  // graph typed relations
  findRelations: "Find relations",
  findRelationsNoKey: "Configure the deep-dive provider's API key first.",
  findRelationsFail: "Find relations failed",
};
