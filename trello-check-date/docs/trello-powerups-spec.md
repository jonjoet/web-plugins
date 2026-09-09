# Trello Power-Ups Monorepo — Build Spec

> **How to use this file.** Drop it into a fresh, empty git repo at `docs/SPEC.md`
> (or `claude_context/SPEC.md`, or rename to `CLAUDE.md` so Claude Code loads it
> automatically). Then instruct the coding CLI:
> *"Read docs/SPEC.md and implement it. Scaffold the monorepo, then build the first
> app ('Overdue Checklist Items'). Ask me before any step that requires my Trello
> account (registering the Power-Up, generating an API key, enabling it on a board)."*
>
> This spec is deliberately prescriptive about the Trello-specific mechanics,
> because model training data on Trello Power-Ups is often stale — **follow the
> "Notes for the coding agent" section over prior assumptions.**

---

## 1. Purpose

Build a **monorepo of personal, privately-hosted Trello Power-Ups** for one user
(solo Trello account, already on a paid workspace so Advanced Checklists / checklist
due dates are available). The monorepo exists so that multiple small Power-Ups can
share auth, API, UI, build, and hosting infrastructure.

The **first app** solves a concrete gap: Trello can filter *cards* by due date but
has **no native view for overdue *checklist items* across cards and boards**. This
app adds a board button that opens a panel listing every incomplete, past-due
checklist item across all of the user's boards.

## 2. Goals

- A monorepo where adding "Power-Up N+1" means writing one small view + one
  capability declaration, reusing shared auth/API/UI.
- First app fully working end-to-end, added to a board via the **Custom** tab
  (no marketplace submission).
- Static output hostable for free on GitHub Pages, one site serving many apps.
- Security posture: read-only scope, user token never committed and never leaves
  the user's browser.

## 3. Non-goals

- **Not** publishing to the public Power-Up marketplace.
- **No write access** to Trello (view-only; never mutate cards/checklists).
- **Not** multi-user / multi-tenant. One user, their own token.
- No backend server. Everything is a static client-side site. (If a future app
  needs a server, that's a separate decision — do not add one now.)
- Do not build a cross-platform "universal plugin framework." This monorepo is
  Trello-only by design; generic abstractions across other SaaS platforms are out
  of scope.

## 4. Notes for the coding agent (read before coding)

These are the facts most likely to be gotten wrong. Treat them as authoritative;
verify against the linked docs in §12 if unsure.

1. **A Power-Up is a static website.** It's an HTML page that loads
   `https://p.trellocdn.com/power-up.min.js` and calls `TrelloPowerUp.initialize({...})`
   declaring *capabilities*. Trello loads it in a sandboxed iframe. There is no
   required server.
2. **Registration is manual and private.** The user registers the connector URL at
   `https://trello.com/power-ups/admin`, then enables it on a board via the board's
   Power-Ups menu → **Custom** tab. The agent cannot do this; it must produce the
   files and tell the user exactly what to paste where.
3. **Capabilities scoped to current board.** The Power-Up client (`t.cards`, `t.lists`,
   etc.) only sees the *current* board. To read data **across all boards**, you must
   use the **Trello REST API** with a user token — the client library alone is not
   enough. This is central to this app.
4. **Two credentials, very different sensitivity.**
   - **API key**: identifies the app, grants no data access, is **safe to be public**
     (fine to commit).
   - **User token**: grants access to the entire account, is **secret**, must
     **never** be committed or hard-coded, and must only ever live in the user's
     browser. If leaked, it must be revoked.
5. **Get the token the safe way.** Initialize with the app key and use the built-in
   REST API client, which handles the OAuth popup and stores the token in the
   browser's `localStorage` — the token never touches source or hosting:
   ```js
   const t = window.TrelloPowerUp.iframe({
     appKey: TRELLO_APP_KEY,      // public, from config
     appName: "Overdue Checklist Items",
   });
   // later, from a user gesture:
   await t.getRestApi().authorize({ scope: "read", expiration: "never" });
   const token = await t.getRestApi().getToken();  // null if not yet authorized
   ```
   **Request `scope: "read"` only.** Never `read,write`.
6. **Checklist item due dates** live on checklist *items* (a.k.a. `checkItems`),
   not on the card. Relevant fields per checkItem: `name`, `state`
   (`"complete"`/`"incomplete"`), `due` (ISO datetime or null), `dueComplete`,
   `idChecklist`. **Overdue-and-incomplete** = `due != null && new Date(due) < now &&
   state === "incomplete"`.
7. **Rate limits**: 300 requests / 10s per API key, 100 / 10s per token. With many
   boards, fetch efficiently (see §7) and add light backoff; do not fire hundreds of
   parallel requests.

## 5. Repository layout

Monorepo, plain ESM, bundled per-app. Suggested (agent may refine, keep the spirit):

```
/
├─ docs/SPEC.md                 # this file
├─ package.json                 # workspace root; scripts: dev, build, lint
├─ .gitignore                   # MUST ignore config.js, node_modules, dist
├─ config.example.js            # template holding the (public) appKey
├─ config.js                    # gitignored; real appKey (public-safe, but keep repo shareable)
├─ shared/
│  ├─ auth.js                   # authorize/getToken/isAuthorized wrappers
│  ├─ trello-api.js             # REST client: boards, cards+checklists, helpers
│  ├─ ui.js                     # renderTable, empty/error/loading states
│  └─ styles.css                # shared styling for modal views
└─ apps/
   └─ overdue-checklist/
      ├─ connector.html         # registered URL; declares board-buttons capability
      ├─ connector.js
      ├─ view.html              # the fullscreen modal
      └─ view.js
```

- **Bundler**: use Vite in multi-page mode (each `*.html` is an entry) with `base`
  set so GitHub Pages sub-path URLs resolve. Keep dependencies minimal — vanilla JS
  preferred; no UI framework required for the first app.
- **Workspaces**: npm/pnpm workspaces are optional at this scale; a single
  `package.json` with `shared/` imported by relative path is acceptable. Do not add
  Nx/Turborepo.

## 6. First app — "Overdue Checklist Items"

### Behavior
1. Declares the **`board-buttons`** capability: a button (top-right of the board)
   labeled "Overdue items" with light/dark icon variants.
2. Clicking it opens **`t.modal({ fullscreen: true, url: view.html, title: "Overdue checklist items" })`**.
3. The modal:
   - On load, checks `getRestApi().getToken()`. If not authorized, shows a single
     **Authorize (read-only)** button that calls `authorize({ scope: "read" })`.
   - Once authorized, fetches all boards, then all cards + checklists across those
     boards (§7), flattens to checklist items, filters to **incomplete + past-due**.
   - Renders a **sortable table**: columns = *Item*, *Card*, *Board*, *Due*,
     *Days overdue*. Default sort: most overdue first. *Card* links to the card
     (open in Trello). Show a small count summary ("14 overdue items").
   - **Empty state**: "Nothing overdue 🎉". **Error state**: human-readable message +
     a retry button. **Loading state**: spinner/skeleton while fetching.

### Edge cases the agent must handle
- User authorized previously → skip the Authorize button, go straight to data.
- Token revoked/expired → API returns 401 → fall back to the Authorize button.
- Boards with zero checklist items, or checklist items with no due date → excluded
  silently.
- Closed/archived boards → exclude (`filter=open` when listing boards).
- Timezone: `due` is absolute (UTC ISO). Compare against `Date.now()`; display in
  the user's local time.
- Large accounts (many boards) → sequential/batched fetch with backoff, not a
  parallel flood.

## 7. Trello REST API details

Base: `https://api.trello.com/1`. Every request appends `key={appKey}&token={token}`.

Recommended fetch strategy (minimizes requests):
- **List boards**: `GET /members/me/boards?filter=open&fields=name,url`
- **Per board, cards with nested checklists** (one call per board):
  `GET /boards/{boardId}/cards?filter=open&fields=name,url&checklists=all&checklist_fields=name`
  → each returned card includes `checklists[].checkItems[]` with `name`, `state`,
  `due`, `dueComplete`.
- Flatten: for each card → each checklist → each checkItem, keep if
  `due && new Date(due) < now && state === "incomplete"`, attaching card name/url
  and board name.

(Alternative: `GET /boards/{id}/checklists` — but the cards-with-checklists call
gives card name/url alongside items in one request per board, which is cleaner.)

## 8. Security requirements (hard rules)

- **Never** commit or hard-code a user token. `.gitignore` must exclude any file
  that could hold one. The token lives only in browser `localStorage` via
  `getRestApi()`.
- Request **`scope: "read"`** only. The app must be structurally incapable of
  writing (no write endpoints in `trello-api.js`).
- The API key is public-safe and may be committed; still keep it in `config.js`
  (with `config.example.js` checked in) so the repo stays shareable.
- No third-party analytics, trackers, or external network calls except to
  `api.trello.com` and `p.trellocdn.com`.
- Include a short `SECURITY.md` (or a section in the README) telling the user how to
  review/revoke the token at `https://trello.com/u/{username}/account` → Applications.

## 9. Build & hosting

- `npm run build` → static files in `dist/`, laid out so each app has a stable URL
  path (e.g. `dist/apps/overdue-checklist/connector.html`).
- Set Vite `base` to `/{repo-name}/` so GitHub Pages sub-paths resolve. The
  registered connector URL will be
  `https://{user}.github.io/{repo}/apps/overdue-checklist/connector.html`.
- **Local dev**: Trello requires an HTTPS connector URL. Provide an `npm run dev`
  that serves locally and document using an HTTPS tunnel (e.g. ngrok) to get a
  temporary URL for the admin portal. Iterating directly against a GitHub Pages
  deploy is also fine.
- Provide a GitHub Actions workflow that builds and deploys `dist/` to Pages on push
  to `main` (optional but preferred).

## 10. Manual setup steps (for the human — agent should emit these, not perform them)

1. Register a Power-Up at `https://trello.com/power-ups/admin` (name it, pick the
   workspace, set the **connector/iframe URL** to the deployed `connector.html`).
2. In the Power-Up's **API Key** tab, generate an API key; paste it into `config.js`.
3. Enable **board-buttons** capability in the admin portal.
4. On a board → Power-Ups → **Custom** → enable this Power-Up.
5. Click the board button → **Authorize (read-only)** once.

## 11. Definition of done

- [ ] Monorepo scaffolded per §5; `build` produces deployable static output.
- [ ] Shared `auth`, `trello-api`, `ui` modules exist and are consumed by the app.
- [ ] First app: board button → fullscreen modal → authorize (read-only) →
      table of overdue incomplete checklist items across all open boards, sorted
      by most overdue, card links working.
- [ ] Loading / empty / error / unauthorized states all handled.
- [ ] No token in the repo; `.gitignore` correct; `scope:"read"` enforced; no write
      calls anywhere.
- [ ] README with the §10 manual steps and the §8 revoke instructions.
- [ ] Adding a hypothetical second app requires only a new `apps/<name>/` folder +
      capability declaration, reusing shared modules (demonstrate the seam even if
      the second app isn't built).

## 12. References

- Get started building on Trello — https://developer.atlassian.com/cloud/trello/
- Power-Up capabilities — https://developer.atlassian.com/cloud/trello/power-ups/capabilities/
- board-buttons — https://developer.atlassian.com/cloud/trello/power-ups/capabilities/board-buttons/
- Modal UI function — https://developer.atlassian.com/cloud/trello/power-ups/ui-functions/modal/
- REST API client (getRestApi / authorize) — https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/
- REST API authorization & tokens — https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/
- Power-Up security guidance — https://developer.atlassian.com/cloud/trello/guides/power-ups/security/
- REST API introduction (keys vs tokens) — https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/

## 13. Open decisions (agent may choose sensible defaults, or ask)

- Bundler: Vite (recommended) vs. zero-build static files.
- Package manager / workspaces: single root vs. pnpm workspaces.
- Icon assets for the board button (provide simple placeholder SVGs if none given).
- Whether to include the GitHub Actions deploy workflow now or leave hosting manual.
