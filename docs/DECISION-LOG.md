# Expression Vault — Internal Decision Log

> **Internal architecture doc** — the curated record of **how** this project reached its current shape, the counterpart to the `SPEC-*` files (which say **what** to build now). This is the polished, shareable distillation; the verbose raw draft (`decision_raw_log.md`) stays local/gitignored.
>
> **Two views, by design:**
> - **Timeline** (§1) — the chronological record, **newest first**. This is the **single source of truth**.
> - **Thematic matrix** (§2) — the same decisions indexed by topic, so one thread (e.g. *sync* or *pronunciation*) can be traced across stages at a glance.
>
> **Stages → spec docs:** **v1** = `SPEC-expression-vault.md` (main blueprint, itself revised internally through its own v3); **v2.0 / v3.0 / v4.0** = the iteration docs. Dates are approximate/relative — fill exact ones as you go.

**Entry shape:** `Pain/Problem → Root cause → Decision → Why (trade-offs) → Status`.

**Status & lineage keys:**

| Key | Meaning |
|---|---|
| `Shipped` | Implemented and in the app. |
| `Decided` | Agreed; reasoning settled, but not yet built. |
| `Refined by D-xx` | Still stands, but a later decision sharpened it. |
| `[Superseded by D-xx]` | Replaced; kept for the audit trail (never deleted). |

---

## 1 · Timeline (newest first)

### v4 stage — proper nouns

#### D-18 · Pronunciation: respelling → plain TTS on a strong model + consensus *(not IPA→SSML)*
- **Pain:** plain TTS reads names wrong (`De Bruyne`; `Subaru` mis-stressed); the user wants the correct **American** reading.
- **Root cause / verification:** a 3-model test (DeepSeek / GPT-4o / Claude-Opus) showed two independent failures of the original *IPA→SSML* idea — **(A)** AI-generated **IPA** is unreliable (worst on DeepSeek), and **(B)** the app's **Web Speech API takes plain text only** — no SSML, no `<phoneme>` (that channel exists only on cloud TTS). But the same test showed strong models produce correct **respellings** (`duh-BROYN`, `SOO-buh-roo`), and that some names (`Mbappé`) simply have **no settled US reading**.
- **Decision:** drop IPA→SSML. Resolve a plain-text **respelling** → feed the existing **Web Speech TTS**; route the pronunciation scenario to a **strong model** (GPT-4o / Claude, **never DeepSeek**); use **multi-model consensus** as the trust signal — when two strong models agree it's reliable; when they diverge, give **one** reasonable West-Coast approximation + a light *"approximate"* note (no candidate-picking). Always show the respelling on the card so the user can verify by eye.
- **Why:** respelling kills both failures at once — **A** via model choice + consensus, **B** because plain text needs no SSML. Cheap (no cloud TTS), verifiable, honest. Cloud TTS / Forvo remain **future** enhancements gated on their preconditions.
- **Status:** **Shipped** (v4 §1c). Live-verified, incl. a divergence-overrides-`anglicized` fix found in a real run.
- **Supersedes:** the earlier **IPA → SSML `<phoneme>` → TTS** plan `[Superseded by D-18]` — incompatible with the Web Speech stack; recorded as *evolved-from*.

##### Table A · Pronunciation — 3-model comparison
Data from the 3-model test referenced above (and a later live consensus run). Cell = the model's respelling + verdict. `—` = that model/word wasn't separately run.

| Name (type) | DeepSeek | GPT-4o | Claude-Opus | Correct US reading | Takeaway |
|---|---|---|---|---|---|
| **De Bruyne** (obscure person) | `duh-BRY-nuh` ❌ → `duh-BROYN` (differed across runs) ⚠️ | `duh-BROYN` ✅ | `duh-BROY-nuh` ✅ | **duh-BROYN** | Strong models correct; DeepSeek wrong/unstable. |
| **Mbappé** (no settled US reading) | `uhm-BAH-pay` / `uhm-BAP-ay` | `EM-bah-pay` / `em-BOP-ay` | `em-BAP-ay` / `em-bah-PAY` | *(none — varies)* ⚠️ | Even strong models diverge → label **"approximate."** |
| **Subaru** (stress) | `soo-BAH-roo` ❌ | `SOO-bah-roo` ✅ | `SOO-buh-roo` ✅ | **SOO-buh-roo** | DeepSeek mis-stresses; strong models fix it. |
| **Szczęsny** (obscure) | `SHCHEN-snee` ⚠️ | `SHENZ-nee` ✅ | `SHENZ-nee` ✅ | ~**SHENZ-nee** | Strong models agree. |
| **Nguyen** | `win` ✅ | `win` ✅ | `win` ✅ | **win** | Settled; everyone agrees. |
| **Worcester** | `WUUS-ter` ✅ | `WUHS-tuh` ✅ | `WUUS-ter` ✅ | **WUUS-ter** | All fine; notation (rhotic/non-rhotic) varies. |
| **Chevrolet** (anglicized) | `SHEV-ruh-LAY` ✅ | —¹ | —¹ | **SHEV-ruh-LAY** | Anglicized → plain US TTS reads it. |
| **Citadel** (anglicized) | `SIT-uh-dul` ✅ | —¹ | —¹ | **SIT-uh-dul** | Anglicized → plain US TTS reads it. |
| **Ødegaard** (live run) | — | `OH-duh-guard` ✅ | `OH-duh-gard` ✅ | ~**OH-duh-gard** | Strong models agree; the `gard`/`guard` notation gap is normalized to *agree*. |

¹ Anglicized names weren't separately run on GPT-4o/Claude — that's the point: they don't need the strong-model path, plain US TTS already reads them correctly.

**What the table says, in one line:** anglicized names ride plain TTS fine · strong models get the obscure ones right · DeepSeek is the weakest link · and some names (`Mbappé`) have no single settled American reading — which the consensus mechanism reports honestly rather than faking.

#### D-17 · Proper-noun capture: same entry, manual hard-override, simplified card
- **Pain:** can't pronounce names (`Citadel`, `Subaru`, `De Bruyne`); the user wants to look them up too.
- **Decision:** same **quick-lookup / idiomatic** entries (no separate search). Twofold trigger: **AI auto-detect** + a **manual "proper noun" toggle that is a HARD override** the AI cannot overrule. New `kind: proper_noun` → a simplified, **pronunciation-first** card (no forced gloss/usage, exempt from tag-clustering); saved to the vault normally.
- **Why:** obscure names (`De Bruyne`) may be unknown to the AI, so a hard manual declaration is needed to **bypass the AI's ignorance**; a name's whole payload is "how to say it," so the full ordinary-word card is noise.
- **Status:** **Shipped** (v4 §1a/1b).

### v3 stage — redesign (UI/UX + relations + structure)

#### D-16 · Desktop width: drop blanket max-width; multi-column grid + on-demand detail
- **Pain:** on wide PC screens — huge side margins, narrow/tall cards.
- **Root cause:** a small global container `max-width` (a reading-width constraint mis-applied to card/list layouts).
- **Decision:** `max-width` only on **prose** (deep-dive text); capture/vault become a full-width **multi-column card grid**; selecting a card opens the detail panel and the grid reflows to fewer columns; narrow screens degrade to single column + bottom sheet.
- **Status:** **Shipped** (v3 §12).

#### D-15 · Abbreviations are a third relation type (not synonyms)
- **Pain:** `biceps↔bis`, `session↔sesh`, `abs` — searching one should surface the other, common form prominent.
- **Decision:** new edge type **`abbreviation`** (full↔short) with per-side `register`; searching any form → its own card + a tappable link to the other; the common form gets prominence. The card's relation-links area now carries three kinds: synonym (≈), antonym (↔), abbreviation (short/full).
- **Why:** it's "same word, different written form" with strong register info — folding it into *synonym* would blur the register signal the user cares about.
- **Status:** **Shipped** (v3 §10b).

#### D-14 · Q&A captures the usage pattern, not the literal phrase
- **Pain:** saving `"engage your core"` lost the real point — that `engage` takes a body part. A dead literal phrase doesn't generalize.
- **Decision:** for "word-usage" captures, surface **two candidate cards** — an abstract **pattern** (`engage one's [body part]`, `kind: pattern`, + example & translation) and the literal **phrase** — user picks. Pins down that a `pattern` card's *surface* is the abstract skeleton; the example holds the concrete sentence.
- **Status:** **Shipped** (v3 §11).

#### D-13 · Lookup must not redirect; relations are links, not swaps
- **Pain:** searching `"knee pit"` returned `"back of the knee"` — the query was silently replaced.
- **Decision:** lookup **always** returns the queried word's card; synonyms/antonyms are **tappable on-card links** to separate cards, never an automatic substitution.
- **Status:** **Shipped** (v3 §10a).

#### D-12 · Tags stay FLAT + multi-tag (not hierarchical)
- **Pain:** tags still sparse; related words (`plugs` / `hairline` / `hair transplant`) not grouped; multi-level categories were considered.
- **Decision:** keep **one-level topic + one-level intent**, compensated by **multi-tag**. Sparsity's real fix = reuse-first tagging + word-level reassign (see D-04) + a relatedness diagnostic ("N similar pairs sit in different tags — reassign?"), **not** hierarchy.

  | Approach | Pros | Cons | Verdict |
  |---|---|---|---|
  | Hierarchical (multi-level) | richer structure | doubles the emptiness on already-sparse data; extra cost; a tree fights cross-cutting reality (`buff` = gym **and** compliment) | **Rejected (for now)** |
  | **Flat + multi-tag** | fits the cross-cutting mesh; cheap | needs reuse-first + reassign + diagnostic to beat sparsity | **Chosen** (mechanisms in D-04) |

- **Why:** the data can't support levels yet (one level is already sparse → levels double the emptiness); revisit hierarchy only if one topic later grows huge.
- **Status:** **Shipped** (v3 §9); **refines D-04**.

#### D-11 · Deep-dive/detail moves off the card → side panel (wide) / bottom sheet (narrow)
- **Pain:** cards grow and vary in size because deep-dive content sits on them.
- **Decision:** **fixed-size cards** (content scrolls inside; flip never resizes); deep-dive in a dedicated surface — persistent **right side panel** on wide screens, **bottom sheet** on phones. jp-flashcard hotkeys ported. The range selector becomes a jp-like **class → list** structure browser (reading toggle + shuffle), replacing a giant dropdown.
- **Status:** **Shipped** (v3 §2).

#### D-10 · UI language = English by default; Chinese only for inherent content
- **Pain:** too much Chinese chrome (`"例如"`, `"原文"`, `"你的问题（可留空）"`); the user is learning English and wants immersion.
- **Decision:** all UI labels/placeholders/buttons in **English**; only inherently-Chinese **content** (`gloss_cn`, the user's Chinese input) stays Chinese. (A toggle can come later.)
- **Status:** **Shipped** (v3 §4).

#### D-09 · Vault & app-shell bundle: bounded list + note field + expandable entries; dashboard viz; en-US voice; Settings page
- **Pain (bundle):** the vault stacks infinitely; no per-card notes; entries are dead one-liners; the dashboard is bare; TTS voices are junk; config is scattered.
- **Decisions:** add archive/paging (a **bounded recent set**); add `expression.note`; clicking an entry opens full detail; dashboard gets visualizations (low priority); pick a clean **en-US (General American / West-Coast)** voice + a voice picker; add a consolidated **Settings** page (providers / voice / language / Dropbox / reassign / appearance).
- **Status:** **Shipped** (v3 §3/6/7/8) — incl. the dashboard visualizations (register distribution, per-axis tag counts, edge count, recent-growth bars).

#### D-08 · A real design pass (not another token dump); high-end minimal
- **Pain:** theme/colors look industrial/ugly; the v2 token palette wasn't enough.
- **Decision:** produce **2–3 candidate visual directions** (real mocked screens) → user picks; anchor on a high-end, calm/editorial feel; avoid the 3 AI-default looks; light + dark via semantic tokens.
- **Status:** **Shipped** (v3 §1) — the chosen direction now lives in the theme/token system.

### v2.0 stage — first real-run feedback

#### D-07 · Storage: Dropbox instead of iCloud
- **Pain:** needed cross-device sync; the user is all-Apple but wants free + simple.
- **Decision:** **Dropbox** (2 GB free), single file in an app folder, per-record `updated_at` merge, OAuth. Replaces the original iCloud plan.
- **Why:** the stance softened from "no account at all" → "one Dropbox account," buying cross-platform reach (no Apple lock-in) on a free tier. Trade-offs: an OAuth flow; not real-time collaborative (single user — fine).
- **Status:** **Shipped** (v2 §13; folded into main SPEC §7).
- **Supersedes:** the original **iCloud** sync approach `[Superseded by D-07]`.

##### Table B · Storage backend — option comparison
Reconstructs the trade-space behind the decision (iCloud was the original default; Dropbox won; Google Drive shown as the other obvious option).

| Backend | Free tier | Account / login | Cross-platform | Privacy posture | Integration complexity | Outcome |
|---|---|---|---|---|---|---|
| **iCloud** | 5 GB | Apple ID | ✗ Poor (painful on Android/Windows) | Very high | High — non-Apple sync logic is awkward | **Rejected** — Apple lock-in defeats cross-device. |
| **Google Drive** | 15 GB | Google account | ✓ Excellent | Ad-driven commercial posture | High — OAuth2 consent + WebView flow | **Rejected** — heaviest flow + weakest privacy stance. |
| **Dropbox** | 2 GB | Dropbox account | ✓ Excellent | Standard cloud-storage | Low–medium — clean SDK, fairly direct OAuth | ✅ **Chosen** — best cross-platform/effort balance; 2 GB is ample for a single JSON vault. |

**Why Dropbox wins:** the smallest free tier (2 GB) is irrelevant for a one-file text vault, while it ties Google Drive on cross-platform reach with a far simpler integration and a cleaner privacy stance than Google — and, unlike iCloud, it doesn't strand non-Apple devices.

#### D-06 · Embedding via API at save (not transformers.js); edges & layout computed live in-browser
- **Question:** compute embeddings locally (transformers.js) or via API? Realtime or precompute?
- **Decision:** see the two axes below.

  | Axis | Options | Decision | Why |
  |---|---|---|---|
  | **Where** | local (transformers.js) vs **API** | **API**, one word at a time, **at save** (stored on the card, never recomputed) | "Offline" was a wrong rationale — the app is online anyway (page load, AI lookups, sync); local embedding's real perks (cost/privacy) are weak since words already hit the AI at enrich, so API is simpler (one provider router, no model download). |
  | **When** | realtime vs precompute | **embeddings precompute once**; **edges & layout computed live in-browser** (cosine + threshold slider; capped force layout) | Split by cost & stability: embeddings are expensive + stable → precompute; edges/layout are cheap + range-dependent → compute live. No O(N²) in-browser at global scale; large graphs may be slower (accepted). |

- **Status:** **Shipped** (v2 §11).

#### D-05 · Multi-provider: store a list, pick per scenario
- **Pain:** a single provider slot; the user holds several memberships.
- **Decision:** store a **provider list** with independent **per-scenario routing** (enrich / deep-dive / reassign / embedding — and later **pronunciation**). Keys kept local + synced, never in the repo.
- **Status:** **Shipped** (v2 §12) — pronunciation routing added in D-18.

#### D-04 · One-click global reassign operates on WORDS; live tags are reuse-first drafts
- **Pain:** intents sparse; related words split into separate tags; new words tagged without regard to existing structure.
- **Decision:** **(a)** live tagging is **reuse-first** (show the AI existing tags; reuse before minting). **(b)** a one-click **reassign** re-clusters **all words** (create / merge / split, data-driven count, auto-name, preview-before-apply) using embeddings to pull near words together. Live tags = provisional; reassign = authoritative. The trigger signal is *"related words in different tags,"* **not** *"singletons exist"* (small-data singletons are fine).
- **Status:** **Shipped** (v2 §7/8); **refined by D-12** (v3 §9).

#### D-03 · Smaller v2 fixes (bundle)
- **Decisions:** add `pos`; add `example_parallel` (constraint: just "not identical"); render **full GFM Markdown incl. tables** in deep-dive; **review** re-adds jp's flip / self-test / wrong-item / progress but **no hardcore SRS**; add a **3rd entry** — Chinese intent → idiomatic English renderings + keyword cards.
- **Status:** **Shipped** (v2 §1/2/3/4/5).

### v1 stage — concept & architecture

#### D-02 · Form factor: capture = asking AI (sedimenting Q&A); two entries; AI builds the card, user taps Save
- **Insight:** when you hit an unknown expression you ask AI anyway — so make **asking *be* capturing**; the answer's by-products (reading / intent / tags) sediment into a card. Two entries: **quick-lookup** (expand vocab, no chat) + **Q&A box** (don't understand). The AI prepares a fully-filled candidate card; it enters the vault only on **Save** (human-in-the-loop).
- **Why:** kills both "can't be bothered to look up" and "can't be bothered to record"; the Save-gate keeps throwaway questions out. Entry method and data structure are **orthogonal** — every entry produces the same `expression`, so clustering/graph are unaffected by how a word came in.
- **Status:** **Shipped** (main SPEC §0; refined across v2/v3).

#### D-01 · Independent project (NOT merged into jp-flashcard)
- **Origin:** began as an idea to reuse the Japanese flashcard app's components; first framed as a module inside it.
- **Decision:** a **separate repo.** Reuse only generic UI (cards / SRS / dashboard) as **vendored** components; no product/data/runtime dependency.
- **Why:** the two diverge on every axis that matters:

  | Dimension | jp-flashcard | Expression Vault | Implication |
  |---|---|---|---|
  | Sync | local-only **by design** | cross-device | merging would force jp to abandon its design |
  | Data model | curriculum → group → list | expression + edges + tags | no overlap |
  | Privacy | public JLPT lists | real chat logs | different posture |
  | Evolution speed | stable | fast-moving | different cadence |

- **Status:** **Shipped** (separate repo in place; main SPEC §0.1/0.2).

#### D-00 · Product thesis: a topic-and-intent-organized vault of English expressions
- **Pain:** strong reading (TOEFL 110) but weak everyday usage; *"know the words but don't recall I can use them here"*; look things up and forget.
- **The missing piece:** the **reverse index** — intent (*"describe someone as strong"*) → expressions (`buff` / `get shredded` / `jacked`). Living English, Discord slang, 高考/TOEFL essays, CS/interview terms are **one skeleton**, differing only by `register` — stored together, filtered by axes, not partitioned.
- **Status:** The founding frame (main SPEC §0).

---

## 2 · Thematic matrix (cross-index)

Each row is one thread; the IDs are ordered **newest → oldest** to match the timeline. Jump to any `D-xx` above to read the full entry.

| Theme | Decisions (newest → oldest) | The thread, in one line |
|---|---|---|
| **Positioning / thesis** | D-10 · D-02 · D-00 | reverse-index vault → asking = capturing → English-immersion UI |
| **Project boundary** | D-01 | independent repo; vendor only generic UI |
| **Capture & entries** | D-17 · D-14 · D-13 · D-03 · D-02 | two entries + Save-gate → idiomatic 3rd entry → no-redirect → pattern vs literal → proper-noun + hard override |
| **Data model / card** | D-17 · D-14 · D-11 · D-09 · D-03 · D-02 | `expression` core → `pos`/`example_parallel` → `note` → fixed card → `kind: pattern` → `kind: proper_noun` |
| **Tags / clustering / reassign** | D-12 · D-04 | reuse-first + word-level reassign → flat + multi-tag (hierarchy rejected) |
| **Relations / knowledge graph** | D-15 · D-13 | synonym/antonym links → abbreviation as a 3rd relation |
| **Embeddings & graph rendering** | D-06 | embed via API at save; edges/layout live in-browser |
| **Providers / AI routing** | D-18 · D-05 | provider list + per-scenario routing → pronunciation routed to a strong model |
| **Pronunciation** | D-18 · D-17 · D-09 | en-US voice → proper-noun card → respelling + consensus *(IPA→SSML superseded)* |
| **Sync / storage** | D-07 | Dropbox *(iCloud superseded)* |
| **Review** | D-11 · D-03 | borrow jp (no coercive SRS) → hotkeys + structure browser |
| **UI / layout / design** | D-16 · D-11 · D-10 · D-09 · D-08 | design pass → responsive detail → English → Settings/dashboard → desktop grid |

**Superseded trail (kept on purpose):** **iCloud** → `[D-07]` Dropbox · **IPA→SSML `<phoneme>`** → `[D-18]` respelling + consensus.

---

## 3 · How to use / append

- **Add new decisions at the top of the timeline** with the next `D-##`, then add the ID to the relevant **thematic matrix** row(s).
- Keep each entry to **Pain → Root cause → Decision → Why → Status.** Move `Status` along as work lands (`Decided → Shipped → Refined/Superseded`).
- **When a later decision reverses an earlier one** (e.g. iCloud → Dropbox), **don't delete the old one** — mark it `[Superseded by D-xx]` and link the new ID, so the reasoning trail stays intact.
- **Reach for a table** whenever a decision weighs **multiple options on shared criteria** (see Table A, Table B, and the inline tables in D-01/D-06/D-12) — a comparison grid scans far faster than prose.
