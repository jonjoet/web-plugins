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

The user-directed v0.2.0 scope extends that view with all-active and dated-active
display modes. Overdue only remains the default. This milestone precedes paging
work and does not establish collection completeness.

## 2. Goals

- A monorepo where adding "Power-Up N+1" means writing one small view + one
  capability declaration, reusing shared auth/API/UI.
- First app fully working end-to-end, added to a board via the **Custom** tab
  (no marketplace submission).
- Static output hostable for free on GitHub Pages, one site serving many apps.
- Security posture: read-only scope, user token absent from source, builds,
  hosting, and logs. Trello's SDK manages the token in private plugin data.

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
   `https://trello.com/apps/admin`, then enables it on a board via the board's
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
     **never** be committed or hard-coded. Only pass it to Trello and its SDK-managed
     private storage. If leaked, it must be revoked.
5. **Get the token the safe way.** Initialize with the app key and use the built-in
   REST API client, which handles consent and stores the token in private plugin
   data — the token never touches source or hosting. Prepare the client before
   enabling the authorization button:
   ```js
   const t = window.TrelloPowerUp.iframe({
     appKey: TRELLO_APP_KEY,      // public, from config
     appName: "Overdue Checklist Items",
   });
   const client = await t.getRestApi();
   // Later, directly from the authorization button's click handler:
   await client.authorize({ scope: "read", expiration: "never" });
   const token = await client.getToken();  // null if not yet authorized
   ```
   **Request `scope: "read"` only.** Never `read,write`.
   Configure the HTTPS hosting origin in the API key's allowed origins. Verify
   authorization and persistence on reopening under ordinary browser settings;
   the SDK documents Chrome storage partitioning issues. Do not require disabling
   browser security flags or treat mocked consent as live acceptance.
6. **Checklist item due dates** live on checklist *items* (a.k.a. `checkItems`),
   not on the card. Relevant fields per checkItem: `name`, `state`
   (`"complete"`/`"incomplete"`), `due` (ISO datetime or null),
   `idChecklist`. **Overdue-and-incomplete** = `due != null && new Date(due) < now &&
   state === "incomplete"`.
7. **Rate limits**: 300 requests / 10s per API key, 100 / 10s per token. With many
   boards, fetch efficiently (see §7); start at most five requests per second and
   use three retries with exponential backoff and jitter for 429/network/5xx.
   Member routes also have a separate limit of 100 requests per 900 seconds.

## 5. Repository layout

The Git root is `web-plugins/`; the application layout below is relative to
`trello-check-date/`. Use one npm package, plain ESM, bundled per-app. The root
`.gitignore` excludes configuration, dependencies, and build output; CI lives in
the Git root's `.github/workflows/`.

```
/
├─ docs/trello-powerups-spec.md  # this file
├─ package.json                 # scripts: dev, build, preview, lint, test
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
   - Once authorized, lists open boards. **Scan all boards** reads cards and
     checklists across them (§7); **Scan selected board** reads only the chosen
     board. Both retain active checklist items. The **Show** selector offers
     **All active items**, **With a due date**, and **Overdue only** (default).
     All active includes undated, upcoming and overdue incomplete items; dated
     includes upcoming and overdue; overdue requires due strictly before scan start.
     Every mode excludes completed items and archived boards, lists and cards.
     Switching modes filters in memory without new API requests or advancing time.
   - Renders a **sortable table**: columns = *Item*, *Card*, *Board*, *Due*,
     *Days overdue*. Default sort in every mode: due ascending, most overdue first,
     then soonest upcoming, with undated items last. Mode changes reset this sort.
     Undated Due and non-overdue Days overdue cells show a dash. Blank numeric
     cells remain last in either sort direction. *Card* shows its plain name
     followed by **Open here** and **Open in new tab** controls. The former uses
     the persistent connector to close the modal before calling `t.navigate({ url })`,
     including cards on another board. A random per-modal BroadcastChannel carries
     only the card URL, validated by sender and receiver; no persistent storage or
     token transfer. The latter control uses a link with `noopener noreferrer`.
     Failures before closure show a sanitized row-level message; failures after
     closure use a Trello alert with guidance to reopen and use the new-tab option.
     Headings, captions and counts reflect the display mode.
   - **Empty state**, only after a complete scan: "Nothing overdue 🎉". **Error state**: human-readable message +
     a retry button. **Loading state**: spinner/skeleton while fetching.

### Edge cases the agent must handle
- User authorized previously → skip the Authorize button, go straight to data.
- Token revoked/expired → API returns 401 → fall back to the Authorize button.
- Boards with zero checklist items contribute no rows. Incomplete items without
  due dates appear only in All active items; completed items never appear.
- Closed/archived boards, lists, and cards → exclude. A card can remain open
  inside an archived list; inspect list `closed` state using card `idList`.
- Timezone: `due` is absolute (UTC ISO). Compare against `Date.now()`; display in
  the user's local time.
- Large accounts (many boards) → sequential/batched fetch with backoff, not a
  parallel flood.
- Freeze one `now` per scan; due exactly at `now` is not overdue. Days overdue
  counts completed elapsed 24-hour periods (`<1` for less than a day), not calendar
  boundaries. Sort numerically; break equal due dates by board/card/item ID.
- Include all assignees; parent-card due date and completion do not affect items.
- Malformed data and missing collections must fail visibly. Partial scans report
  rows found and boards not checked, never an account-wide total or empty success.
  A board-list failure is global; a board 403 is local. A token 401 cancels the
  scan and clears authorization; an invalid app key requires setup repair.
- Refresh cancels the previous scan; close cancels requests; stale responses
  cannot overwrite newer results. Cache board listings in memory with a full-refresh
  option. Show progress and finish time. Render names as text and validate external
  links as Trello HTTPS URLs with `noopener noreferrer`.

## 7. Trello REST API details

Base: `https://api.trello.com/1`. Every request appends `key={appKey}&token={token}`.

Selected nested item projection, with endpoint completeness still pending:
- **List boards**: `GET /members/me/boards?filter=open&fields=name,url,closed`
- **Per board, cards with nested checklists**:
  `GET /boards/{boardId}/cards?filter=open&fields=name,url,idList,idBoard,closed&checklists=all&checklist_fields=name`
  The user's single-board live report on 2026-09-10 compared the original
  `fields=name,url` query with and without `checklist_fields=name`. Both returned
  matching counts and valid `checkItems`, including non-null due dates. Retain
  the name projection; it did not omit items in that observation. Required item
  fields are `id`, `name`, `state`, and `due`. Missing arrays must fail, not become
  empty arrays. Card archive/join metadata was checked separately; the combined
  projection above was subsequently exercised by the user's v0.1.0 selected-board
  scan, reported working well. This does not establish exhaustive live acceptance.
- Flatten: for each active card → each checklist → each checkItem, validate and
  retain `state === "incomplete"`, attaching card name/url and board name. Keep
  null due dates as null and freeze elapsed time at scan start. The view filters
  by mode: all rows; non-null due; or non-null due strictly before scan start.

Both candidate strategies read `GET /boards/{id}/lists?filter=all&fields=closed`.
Missing list references or invalid archive states make the board incomplete.
The fallback is `GET /boards/{id}/checklists?checkItems=all&checkItem_fields=name,state,due`
joined to open-card metadata. These parameters explicitly select the documented
item defaults; pinning them does not establish live fallback shape verification. Resolve
each missing `idCard` with a bounded GET retaining `idBoard`, `idList`, and `closed`;
exclude only a positively archived card/list. Missing open cards, moved cards,
failed lookups, and unresolved lists make the result incomplete.

The nested item projection is selected, but pagination order/cursor and exhaustion
remain **pending**. No one-request-per-board guarantee is made. Verify multiple
pages and repeated cursors before claiming completeness, then update this section
with the observed contract. The single-board report had resolved list references
but no open cards in archived lists; archive exclusion is not live-verified by
that run. Fallback join misses were present and remain unclassified by the live
probe. A small-board shape probe alone does not establish pagination. The current
scan modules return observed rows with `complete: false` and
`collection-completeness-unverified`; they cannot certify an empty success.
The modal displays these observations in a sortable table, with an explicit
incompleteness notice. Scans are user-triggered for a selected board or all open
boards; the existing counts-only integration check remains available separately.
The UI currently uses the nested strategy. The fallback is available in the scan
module for explicit callers and testing, and is not silently selected on an error.

## 8. Security requirements (hard rules)

- **Never** commit or hard-code a user token. `.gitignore` must exclude any file
  that could hold one. Use the SDK's private plugin data and `clearToken()`;
  do not add custom persistent token storage.
- Request **`scope: "read"`** only. The app must be structurally incapable of
  writing (no write endpoints in `trello-api.js`).
- The API key is public-safe and may be committed; still keep it in `config.js`
  (with `config.example.js` checked in) so the repo stays shareable.
- No analytics or trackers. Allow the hosting origin, `api.trello.com`,
  `p.trellocdn.com`, and Trello's required consent/sign-in flow. Application REST
  calls go only to the fixed Trello API origin. Never log credential-bearing URLs.
- Include a short `SECURITY.md` (or a section in the README) telling the user how to
  review/revoke the token at `https://trello.com/u/{username}/account` → Applications.

## 9. Build & hosting

- `npm run build` → static files in `dist/`, laid out so each app has a stable URL
  path (e.g. `dist/apps/overdue-checklist/connector.html`).
- Set production Vite `base` to `/web-plugins/trello-check-date/` (configurable),
  with development at `/`. Stage `dist/` under `trello-check-date/` in Pages. The
  registered connector URL will be
  `https://{user}.github.io/web-plugins/trello-check-date/apps/overdue-checklist/connector.html`.
- Generate ignored `config.js` from public repository variable `TRELLO_APP_KEY`
  using JSON serialization in deployment builds. Missing production keys fail
  the build; CI checks use an obvious fake key. No user token is a build input.
- **Local dev**: Trello requires an HTTPS connector URL. Provide an `npm run dev`
  that serves locally and document using an HTTPS tunnel (e.g. ngrok) to get a
  temporary URL for the admin portal. Iterating directly against a GitHub Pages
  deploy is also fine.
- Provide a GitHub Actions workflow that builds and deploys `dist/` to Pages on push
  to `main` (optional but preferred).

## 10. Manual setup steps (for the human — agent should emit these, not perform them)

1. Register a Power-Up at `https://trello.com/apps/admin` (name it, pick the
   workspace, set the **connector/iframe URL** to the deployed `connector.html`).
2. In the Power-Up's **API Key** tab, generate an API key; paste it into `config.js`.
   Add the exact deployed HTTPS origin (and any tunnel origin) to allowed origins.
   Supply the public key as `TRELLO_APP_KEY` for CI deployment.
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
