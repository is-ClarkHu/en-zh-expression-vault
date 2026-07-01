# Expression Vault

Your private, topic-and-intent-organized vault of English expressions — fed by
low-friction capture entries (a quick word-lookup, a Q&A box for "I don't
understand this", and an idiomatic Chinese→English box), and retrievable the
moment you next need it. Full register spectrum, street slang to academic to
technical.

You can read a word fine, yet not recall you can use it in a given situation —
and you look things up and forget them. Expression Vault makes asking AI the act
of capturing, and lets you retrieve expressions by what you want to say, not just
by how they're spelled.

Local-first and privacy-first: your vault lives in your browser; AI keys and any
sync stay under your own accounts. No ads, no account required to start, no
server we run — optional Dropbox sync uses your own account.

## Features

- **Capture** — three entries, each ending in a one-tap "Save" candidate card:
  - *Quick-lookup*: type Chinese or English → one filled card (gloss, reading, register, auto-tags).
  - *Q&A*: drop a raw line and ask → AI explains and extracts the keep-worthy expression(s), disambiguating senses (e.g. `buff` gym-sense vs game-sense).
  - *Idiomatic (Chinese→English)*: type what you mean in Chinese → several natural English renderings + extracted keyword cards.
  - *Proper nouns*: names/brands/companies/places you can't pronounce (`Subaru`, `De Bruyne`) go through the same entries — auto-detected, or forced with a "proper noun" toggle — producing a simplified, pronunciation-first card with a respelling (e.g. `duh-BROYN`) the browser speaks aloud.
- **Retrieve** — slice the single vault by **intent** (reverse-search: "describe-strong" → `buff` / `jacked` / `get shredded`), **topic**, or **register**.
- **Relations** — a card links to related expressions: synonyms (≈), antonyms (↔), and abbreviations (`biceps`↔`bis`, `session`↔`sesh`), shown as tappable links; looking up a form always returns *that* form, never a silent redirect. (Broader progression/collocation links live in the Graph, not on the card.)
- **Graph** — a 2D map of your vault: nodes placed by embedding similarity, colored by topic, linked by relation edges (incl. progression/collocation).
- **Review** — lightweight: flip cards, self-test, a wrong-item list, shuffle, and progress, with keyboard shortcuts — but no coercive spaced-repetition (no due-date queue, streaks, or mastery gates). Memory through use.
- **Pronunciation** — US-accent speech synthesis on any card, a reading toggle in Review, and for names a respelling (e.g. `duh-BROYN`) resolved by a strong model so the browser can say them.
- **Dashboard** — distributions, tag counts, growth; vault export/import and sync.

## Tech stack

- **App** — [Vite](https://vitejs.dev) + vanilla JS. Local store is IndexedDB, designed sync-friendly (stable `id` + `updated_at`). No personal data is bundled — only a tiny fictional demo vault you can load from **Settings → Sync & data → Load sample vault**.
- **Batch tool** — `tools/recluster.py`, the only periodic step: tag merge/split + auto-naming + embedding/edge refresh (see below).

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/  (static; deploy anywhere)
```

Open the app, go to **Capture**, pick a provider and paste your API key (stored
on-device only), and start saving. Keys never leave your browser.

## Deploy / self-host

This is a **static site** — `npm run build` emits `dist/`, which any static host
serves. `vite.config.js` uses a relative `base` so it works from a subpath.

- **GitHub Pages** — build and publish `dist/` (e.g. a `gh-pages` branch or a
  Pages Action). Only the app code (plus the tiny fictional demo vault) is
  served; no personal or captured data is ever bundled.
- **Netlify / Vercel / Cloudflare Pages** — point them at the repo with build
  `npm run build` and output dir `dist`.

Anyone can host their own copy. Each deployer supplies their own API keys (in the
app) and, for sync, their own Dropbox app key (below).

## Sync (cross-device)

The vault is a single file (`vault.json`). Two ways to move it between devices:

1. **Manual** — Dashboard → **Export** / **Import** (always available, no setup).
2. **Dropbox auto-sync** — connect once, then **Sync now** does a two-way
   last-write-wins merge.

### Why Dropbox (and not iCloud / Google Drive)

| Option | Auto on phone browser | Cost | Notes |
|---|---|---|---|
| Manual file | n/a | free | works everywhere; you move the file yourself |
| **Dropbox** | ✅ | free | pure-frontend PKCE → **connect once, stays connected**; no app-verification wall |
| Google Drive | ✅ | free | most universal, but SPA tokens expire hourly (recurring re-auth) and the app-data scope needs Google's verification (an "unverified app" warning until reviewed) |
| iCloud (CloudKit / native) | ✅ | **$99/yr** Apple Developer | best Apple-native feel; needs a paid account + packaging |

Dropbox wins for a no-backend web app: its PKCE flow hands the browser a
long-lived refresh token (log in once), and there's no verification gauntlet.

### Set up Dropbox

1. [Create a Dropbox app](https://www.dropbox.com/developers/apps) → **Scoped
   access** → **App folder** → name it. Your vault lands in `/Apps/<name>/`.
2. **Permissions** tab: enable `files.content.read` and `files.content.write`.
3. **Settings** tab → **Redirect URIs**: add your app's URL. The app shows the
   exact URI to paste (Dashboard → Sync) — e.g. `http://localhost:5173/` for dev
   or your Pages URL for production.
4. Copy the **App key** → Dashboard → Sync → paste → **Connect Dropbox**.

The app key is not a secret in the PKCE public-client flow, so it's safe in
local settings. Your vault data stays in your own Dropbox app folder.

## Tag reclustering (`tools/recluster.py`)

Live AI tagging keeps grouping instant. Periodically, run the batch tool to keep
the tag *set* healthy and to fill the embedding + edge layer the Graph needs:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Round-trip: Dashboard → Export → recluster → Import
python tools/recluster.py --vault vault.json
python tools/recluster.py --vault vault.json --dry-run            # preview only
python tools/recluster.py --vault vault.json --no-embed --no-name # offline
```

It embeds expressions (OpenAI `text-embedding-3-small`, incremental), merges
near-duplicate tags, splits overloaded ones (HDBSCAN), auto-names changed tags
(DeepSeek), and rebuilds similarity edges. Keys come from a local `.env` (see
`.env.example`); every API step has an off-switch.

## Privacy

Your vault lives in your browser (IndexedDB). AI calls go directly from your
browser to the provider you choose, with your own key. Sync, if enabled, goes to
your own Dropbox. There is no server operated by this project, and no captured
corpus is ever committed to the repo.

## License

MIT — see [LICENSE](LICENSE). Code and `recluster.py` are public; never publish a
captured corpus (copyright + privacy).
