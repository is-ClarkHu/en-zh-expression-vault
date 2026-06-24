// Dropbox sync (SPEC §7 realized for the web app — no backend, no $99).
//
// Pure-frontend OAuth 2.0 PKCE with token_access_type=offline, so the browser
// gets a storable refresh token → connect once, stay connected (no recurring
// re-auth popups, unlike Google's SPA flow). App-folder scope isolates us to
// /Apps/<app>/. The whole vault is one file, vault.json (SPEC §7 single-file).
//
// The Dropbox app key (client id) is NOT a secret in the PKCE public-client
// flow, so it lives in local settings — each self-hoster registers their own
// app and pastes their key (see README → Sync). Data stays in the user's own
// Dropbox; nothing touches a server we run.

import { getSettings } from "../ai/settings.js";
import { exportVault, importVault } from "../db/index.js";

const TOKENS_KEY = "ev-dropbox-tokens"; // localStorage: {access_token, refresh_token, expires_at}
const PKCE_KEY = "ev-dropbox-pkce"; // sessionStorage: {verifier, state}
const VAULT_PATH = "/vault.json"; // relative to the app folder

const appKey = () => getSettings().dropboxAppKey || "";
export const redirectUri = () => location.origin + location.pathname;

// --- token storage -----------------------------------------------------------
function loadTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) || "null");
  } catch {
    return null;
  }
}
const saveTokens = (t) => localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
export const isConnected = () => !!loadTokens()?.refresh_token;
export const disconnect = () => localStorage.removeItem(TOKENS_KEY);

// --- PKCE helpers ------------------------------------------------------------
function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len = 64) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}

// Kick off the OAuth redirect. Returns to redirectUri() with ?code=...
export async function beginAuth() {
  if (!appKey()) throw new Error("Set your Dropbox app key first.");
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: appKey(),
    response_type: "code",
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    token_access_type: "offline", // → refresh token
    redirect_uri: redirectUri(),
    state,
  }).toString();
  location.assign(url.toString());
}

async function tokenRequest(params) {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error("Dropbox token request failed: " + (await res.text()));
  return res.json();
}

// Call once on app load. If we came back from the OAuth redirect, exchange the
// code for tokens. Returns true iff a connection was just established.
export async function completeAuthFromRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null");
  sessionStorage.removeItem(PKCE_KEY);
  history.replaceState({}, "", redirectUri()); // strip ?code= regardless
  if (!saved || saved.state !== params.get("state")) return false;

  const t = await tokenRequest({
    code,
    grant_type: "authorization_code",
    client_id: appKey(),
    redirect_uri: redirectUri(),
    code_verifier: saved.verifier,
  });
  saveTokens({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  });
  return true;
}

async function accessToken() {
  const t = loadTokens();
  if (!t) throw new Error("Not connected to Dropbox.");
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  const r = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: appKey(),
  });
  saveTokens({ ...t, access_token: r.access_token, expires_at: Date.now() + (r.expires_in - 60) * 1000 });
  return r.access_token;
}

// --- file I/O ----------------------------------------------------------------
async function download() {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": JSON.stringify({ path: VAULT_PATH }) },
  });
  if (res.status === 409) return null; // file not there yet
  if (!res.ok) throw new Error("Dropbox download failed: " + (await res.text()));
  return JSON.parse(await res.text());
}

async function upload(obj) {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "Dropbox-API-Arg": JSON.stringify({ path: VAULT_PATH, mode: "overwrite", mute: true }),
      "content-type": "application/octet-stream",
    },
    body: JSON.stringify(obj),
  });
  if (!res.ok) throw new Error("Dropbox upload failed: " + (await res.text()));
}

// Two-way sync: pull remote → merge into local (per-record last-write-wins by
// updated_at, SPEC §7) → push the merged local back. Expressions merge cleanly;
// tags/edges are coarse-merged (recluster.py regenerates them anyway).
export async function syncNow() {
  const remote = await download();
  if (remote) await importVault(remote);
  const merged = await exportVault();
  await upload(merged);
  return { expressions: merged.expressions.length, hadRemote: !!remote };
}
