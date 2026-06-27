// On-demand deep-dive (SPEC §4.6) — a later tap on a saved expression that asks
// the AI a focused follow-up. Reuses the same provider layer; the answer is
// appended to the card's qa_log (db.appendQaLog) so it sticks. Answers are in
// Chinese, matching the Q&A entry.

import { callText } from "./provider.js";

const PROMPTS = {
  synonyms: (e) =>
    `列出英语表达 "${e.surface}"（${e.gloss_cn || ""}）的几个近义表达，每个标注语域和细微差别。用中文回答，简洁。`,
  register: (e) =>
    `英语表达 "${e.surface}" 属于「${e.register || "?"}」语域。解释为什么，以及什么场合该用、什么场合别用。用中文，简洁。`,
  contrast: (e) =>
    `英语表达 "${e.surface}" 和它最接近的近义词有什么区别？给 1-2 个对比例句。用中文，简洁。`,
  culture: (e) =>
    `英语表达 "${e.surface}" 有什么文化背景或使用注意（地域、人群、语气、冒犯风险）？用中文，简洁。`,
};

// Labels are UI chrome (English, v3 §4); the PROMPTS above stay Chinese because
// the deep-dive ANSWER is Chinese content (matching gloss_cn / the Q&A entry).
export const DEEP_DIVE_KINDS = [
  { id: "synonyms", label: "Synonyms" },
  { id: "register", label: "Register" },
  { id: "contrast", label: "Contrast" },
  { id: "culture", label: "Culture" },
];

export async function deepDive(expr, kind) {
  const build = PROMPTS[kind];
  if (!build) throw new Error(`unknown deep-dive kind: ${kind}`);
  return callText(build(expr), { maxTokens: 700, scenario: "deepdive" });
}
