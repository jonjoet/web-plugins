# Overdue Checklist Items — implementation plan

Status: Phase 1 connection preview deployed; single-board live shape verification
reported successful on 2026-09-10, with the modal opened twice. Both checklist
projections returned matching counts and valid item fields, including non-null
due dates. Prefer the original `checklist_fields=name` projection. Cross-board
live acceptance is deferred by the user; the application's scope is unchanged.
No open card in an archived list was observed. Fallback join misses were observed
but their classification remains unverified against live data. Revocation recovery
and pagination/exhaustion also remain pending, so the Phase 1 exit is not closed.

Phase 2 domain and scan modules implement validated active observations, archive
filtering, targeted fallback lookup, board caching, partial results and cancellation.
The preview now offers a sortable table for selected-board or all-board scans,
alongside the original integration check. Collection completeness remains explicitly
unverified, including empty responses: pagination and its multiple-page
and repeated-cursor tests are still to be implemented against a verified endpoint
contract. Phase 2 is therefore partial. Phase 3's table, progress, partial-result
notices, refresh and cancellation are implemented. The user reported the deployed
v0.1.0 table working well on their board; this is not exhaustive live acceptance. Scans start from an
explicit button, allowing a selected-board read without an automatic account scan.
Phase 4's Pages workflow completed all three jobs successfully in the first
configured deployment; the step-by-step setup guide remains available.
Prepared with GPT-6 against the build spec in commit
`dbb57908e653addb584eb3396dbc9f6121d71053`.

The user-directed v0.2.0 milestone adds display filters before pagination work:
all active items, active items with a due date, and overdue only (the default).
All modes exclude completed checklist items and archived boards/lists/cards.
Filters reuse normalized observations without refetching and preserve the frozen
scan timestamp. Default order in each mode is due ascending, undated last;
undated Due and non-overdue Days overdue cells show a dash. Selected/all-board
controls and integration diagnostics remain. These filters do not close any
pending completeness or live archive/fallback acceptance gate.

## 1. Outcome and scope

Build a personal Trello Power-Up whose board button opens a fullscreen view of
active checklist items, with overdue only as the default display, across the signed-in user's open boards,
open lists, and open cards. Use a static site, vanilla JavaScript modules, Vite, and a read-only
Trello user token. Keep the shared Trello authentication, fetching, and UI code
small enough to serve a second Power-Up without building that second app.

This plan addresses the gaps found in the original spec. The first implementation
change will reconcile the spec with the decisions below so the two documents do
not give conflicting instructions. Public marketplace submission, a backend,
Trello content writes, multi-user administration, and a general cross-platform
plugin framework remain outside scope.

## 2. Corrections and evidence

| Topic | Finding | Planned treatment |
| --- | --- | --- |
| Token storage | The REST client documentation says authorization stores the token in private plugin data, contradicting the spec's exclusive `localStorage` claim. [S1] | Use the SDK's storage and clear-token functions. Promise that tokens are absent from source, builds, our hosting, and logs; allow communication with Trello and its SDK-managed private storage. Do not implement custom persistent token storage. |
| Browser authorization | Atlassian documents third-party storage partitioning problems affecting token retrieval in Chrome. [S1] | Make authorization, persistence after reopening, and recovery an early test in the user's normal browser settings. Do not require disabling browser security flags. A failure blocks live acceptance and triggers investigation within the static-site design. |
| Allowed origins | Authorization redirects require an allowed origin on the app's API key. [S2] | Include the deployed HTTPS origin and any development tunnel origin in manual setup, separately from the connector URL. |
| Network policy | Authorization uses Trello's own consent flow, which the spec's two-host allowance does not describe. [S2] | Allow the Power-Up's hosting origin, `api.trello.com`, `p.trellocdn.com`, and Trello's required consent/sign-in flow. Keep custom application fetches confined to the Trello API; no analytics or unrelated services. Verify required sign-in redirects in the live browser flow before documenting a restrictive policy. |
| Item schema | Documented check-item fields include `due` and `state`; `dueComplete` is a card field and is not needed for item completion. [S3, S4] | Determine eligibility from valid `due` plus `state === "incomplete"`. Remove item-level `dueComplete` assumptions from the spec and fixtures. |
| Nested payload | The user's single-board live report on 2026-09-10 returned matching valid item counts for `checklist_fields=name` and the omitted selector, including dated items. [S3] | Select the original name projection for nested items. The added card archive/join projection still needs a combined live check. Missing expected arrays must not silently become empty arrays. This observation does not establish collection completeness. |
| Archived lists | A firsthand API reproduction reports that archiving a list leaves its cards open; an earlier developer-forum reply confirms that preserving card state is intentional. [S11, S12] | Explicitly refine the product's archive policy to exclude archived lists as well as archived boards/cards. Fetch list archive state and join using card `idList`; card `filter=open` alone does not establish list visibility. Verify this case in Phase 1. |
| Collection completeness | Trello documents limits and paging for long collections, including cards. The precise behavior of the chosen board-card route still needs verification. [S5] | Do not guarantee one request per board. Verify the route's supported paging, ordering, and exhaustion rules; implement them before claiming a complete account scan. |
| Deployment configuration | A clean CI checkout will not contain ignored `config.js`. | Supply the public key explicitly during deployment builds; distinguish a missing setup value from an unauthorized user. |

Documentation checked on 2026-09-09. Where documentation does not establish the
exact behavior, the plan requires a runtime check rather than claiming certainty.

## 3. Project and deployment layout

Keep this Git repository rooted at `web-plugins/`. Put Trello application source,
dependencies, and build configuration under the existing `trello-check-date/`
directory. Interpret the original spec's application layout relative to that
directory; do not move the supplied spec.

```text
web-plugins/
  .gitignore
  .github/workflows/trello-check-date.yml
  README.md
  trello-check-date/
    docs/trello-powerups-spec.md
    docs/IMPLEMENTATION_PLAN.md
    README.md
    SECURITY.md
    package.json
    package-lock.json
    Dockerfile
    vite.config.js
    config.example.js
    config.js                         # ignored, public app key only
    shared/auth.js
    shared/trello-api.js
    shared/overdue.js
    shared/ui.js
    shared/styles.css
    apps/overdue-checklist/
      connector.html
      connector.js
      view.html
      view.js
      icons/
    tests/
```

Use one npm package and lockfile, with no workspace orchestrator or UI framework.
Pin a supported Node container image and compatible Vite version when scaffolding.
Provide `dev`, `build`, `preview`, `lint`, and `test` scripts. Discover connector
and view HTML entries under `apps/` so adding an app does not require editing a
central entry list. Vite preserves HTML entry paths in its output. [S6]

Build into `trello-check-date/dist/`. The Pages artifact places that output under
`trello-check-date/`, giving this stable connector path:

`https://<owner>.github.io/web-plugins/trello-check-date/apps/overdue-checklist/connector.html`

Use production base `/web-plugins/trello-check-date/`, configurable for a renamed
repository or another host; local development uses `/`. Derive runtime modal and
icon URLs from the same base. Test the packaged artifact at its actual nested
path, including a trailing slash, rather than only at the development root. [S6, S7]

Local setup copies `config.example.js` to ignored `config.js`, with an exported
public app key. A deployment build generates the equivalent file from a GitHub
Actions repository variable `TRELLO_APP_KEY`, using safe JSON serialization rather
than interpolating executable JavaScript. CI verification uses a conspicuous fake
key and mocked Trello calls. Production deployment fails clearly if its key is
missing. A missing local key produces setup guidance instead of an authorization
loop. No user token or application secret is a build input.

## 4. Product behavior and module contracts

### Authentication

`shared/auth.js` owns SDK client initialization and exposes token lookup,
read-only authorization, and clearing the stored token. Configure both connector
and modal with the public `appKey` and application name. The modal prepares its
client before enabling its Authorize button, then starts consent directly from
that button's click handler to preserve the browser user gesture. [S1]

Use `scope: "read"` and the spec's `expiration: "never"`. Handle denied consent,
closed popups, missing setup, and storage failures with distinct actionable
messages. On a 401 during scanning, cancel remaining requests, discard that scan,
clear the stored token, and return to Authorize. Do not retry indefinitely or
misclassify an invalid/missing app key as a revoked user token. A 403 for one board
is a board access failure, not automatically a global authentication failure.

Tokens are passed only to the fixed Trello API origin. Keep credential-bearing
URLs out of errors, console messages, fixtures, screenshots, and saved reports.
Use the SDK to manage private authentication data; the application's own REST
wrapper exposes GET operations only and does not modify cards or checklists.

### Fetching and completeness

`shared/trello-api.js` exposes board listing and a scan result with rows, completed
board IDs, failed boards, and an explicit completeness flag. It validates HTTP
status and response shape before data reaches the view.

Start from open boards (`/members/me/boards?filter=open&fields=name,url`). For each
board, verify the spec's nested cards/checklists route and its field projection.
Request identifiers and any fields necessary to establish card archive state,
parent-list archive state, item eligibility, joins, links, and collection completeness. An actual empty
collection is valid; a missing required collection or malformed response fails
that board. Items with a null due date match only the all-active display; an invalid
non-null date or unrecognized state must be reported as a data-quality failure
instead of making the total appear complete.

Compare the spec's exact `checklist_fields=name` projection with the same request
omitting `checklist_fields` (documented default: `all`). Check whether `checkItems`
is present and includes the required item fields on a checklist known to contain
items. A narrowed projection might omit that array; this is a hypothesis, not a
confirmed response. Choose a projection only after the comparison. A simulated
HTTP 200 containing checklist IDs/names but no `checkItems` must fail validation,
not produce an empty success. [S3]

Both fetch strategies also read the board's lists with `filter=all`, retaining
list IDs and `closed`, and retain `idList` on cards. Exclude a card when either
the card or its parent list is positively known to be closed. An absent list ID,
unrecognized archive state, or failed/incomplete list fetch leaves the board
incomplete; never interpret a missing list as an archived list. Use the same
scheduler and completeness checks for list requests. [S13]

If the nested route cannot supply complete items, use the documented board
checklists route plus open-card metadata, joining by `idCard`. Filter out
checklists only when the card or parent list is positively known to be archived.
An unmatched `idCard` is not proof of archive status. Resolve each distinct miss
with a scheduled GET of that card's `idBoard`, `idList`, and `closed` fields.
Known archived cards/lists may be excluded. An open card in an open list that is
absent from the supposedly complete card collection is a completeness failure;
do not merely append it and assume there are no other missing cards. A moved card,
404/403, failed lookup, or unresolved list is likewise an inconsistent/incomplete
board result, with manual retry available. This also handles cross-request changes
without claiming a transactional snapshot. Targeted lookups use the existing
retry budget and cancellation rules, and their values remain scan-local. [S14]

This is the spec's existing fallback with an explicit join-validation contract,
not a new architecture. Both routes must satisfy the same normalized result contract.
Verify exact endpoint field and pagination behavior before choosing one. [S3]

For a paginated route, deduplicate by IDs, advance a verified cursor, stop only
under its verified exhaustion rule, and fail explicitly if a cursor repeats or
an endpoint limit prevents a complete scan. Do not assume response order is card
creation order, use a positional field as a paging cursor, or apply a generic
1000-item rule to endpoints whose semantics differ. More than one page is part of
the verification cases. [S5]

Use sequential board requests initially, with a shared request scheduler limited
to at most five request starts per second within a scan. Add bounded retry for
429, transient network errors, and 5xx: three retries after the original attempt,
exponential delay with jitter, and a valid server retry delay when provided.
Other tabs or apps may consume the same limits, so local pacing does not replace
429 handling. Stop after exhaustion and show the affected board. Cache the open
board list in memory for refreshes, while allowing an explicit full refresh; do
not continuously poll Trello. Its published rate limits include a separate
member-route limit as well as API-key and token windows. [S8]

Each scan has its own cancellation signal and generation ID. Refresh cancels and
replaces the previous scan; closing the modal cancels work. Old responses may not
overwrite newer results. Freeze one `now` timestamp for eligibility and sorting
throughout a scan. This is an observation over a scan interval, not a transactional
snapshot of all Trello boards; record when it finished and allow manual refresh.

### Eligibility, results, and dates

`shared/overdue.js` is independent of the SDK and browser. Normalize item ID,
checklist ID/name, card ID/name/URL, board ID/name, and due timestamp. Include all
matching items on accessible open boards/open lists/open cards, regardless of
item assignee or the parent card's due date/completion status. Exclude archived
boards, lists, and cards. Excluding archived lists is an explicit refinement of
the original spec, which named board and card archive filters but left this case
unspecified. State that scope in the modal and README; retain it when comparing
the result with user-visible Trello content. No assignee filter is introduced.

Normalize all incomplete items, including future and null due dates, before
applying the display filter in the view. The three modes are all active, active
with a due date, and overdue only. Switching modes uses the same observations
and frozen timestamp; Refresh results reads again and advances that timestamp.
Completed checklist items are excluded in every mode. Mode changes reset sorting
to due ascending, with undated items last. Undated Due and non-overdue Days overdue
cells display a dash, and blank numeric cells sort last in either direction.
Headings, captions and summaries describe the selected mode; zero-result modes
retain both failed-board and unverified returned-data notices where applicable.

An item is overdue only when its valid due timestamp is strictly less than the
scan's frozen `now` and its state is incomplete. An item due exactly at `now` is
not overdue. Sort by due timestamp ascending, with stable board/card/item ID
tie-breakers. Display due dates in the browser's local timezone. Define Days
overdue as completed elapsed 24-hour periods, rendering positive intervals below
one day as `<1`; explain that it is elapsed time rather than calendar boundaries.
Sort this column numerically by elapsed time, never by its formatted text.

The modal has setup-required, unauthorized, authorizing, loading, complete,
partial, empty, and error states. While loading, show scan progress. Show
`Nothing overdue` only when all required data was read successfully and the
result is empty. Partial scans say, for example, `12 overdue items found; 2 of 8
boards could not be checked`; partial scans with zero rows do not show success.
Do not present an account-wide total while any board or required page failed.
Retry reruns the scan; a board-list failure is a global error.

Render Item, Card, Board, Due, and Days overdue in a sortable accessible table.
Use text rendering for Trello-controlled names, keyboard-operable sort buttons,
`aria-sort`, readable focus states, and a horizontally scrollable narrow layout.
Validate card-link destinations as Trello HTTPS URLs and open them outside the
iframe using a new tab with `noopener noreferrer`. Include a count summary,
last-completed time, and Refresh control. The board button uses contrasting icon
variants and opens `t.modal({ fullscreen: true, ... })`. [S9, S10]

## 5. Implementation sequence and acceptance gates

### Phase 1 — reconcile the spec and prove the Trello integration

1. Update the spec with the confirmed corrections and chosen layout, configuration,
   date, archive, and incomplete-scan behavior from this plan.
2. Scaffold the minimal Vite package, reproducible container build, connector,
   modal, and auth wrapper. Produce an HTTPS-hostable integration probe with
   sanitized shape/count diagnostics and no credential logging.
3. Prepare concrete manual instructions for hosting and private registration,
   API-key generation, allowed origins, enabling `board-buttons`, and consent.
   Use the current administration UI; the documentation currently links to
   `https://trello.com/apps/admin`. [S1, S2]
4. After the user's account-dependent setup, verify authorize, reopen, cancel,
   revocation recovery, and cross-board reads in the actual Trello iframe using
   normal browser settings. Verify the nested response and the exact projection
   comparison, card/list archive behavior, fallback join-miss classification, and
   collection completeness. Use existing suitable boards
   or a user-created fixture; the read-only app does not create test content.
5. After verification, reconcile the spec's section 7 and related item-field
   descriptions with the selected route, verified field projection, pagination
   and exhaustion rules, and archive/join handling. Keep unresolved behavior
   explicitly pending. This second spec update is part of the Phase 1 exit,
   so the implementation reference reflects what the probe actually established.

Exit: documented selected request strategy with verified item fields and
completion rules, plus working authorization in the intended browser. A small
account check alone does not establish large-board completeness; verify the
chosen pagination/limit contract separately. If account access is unavailable,
continue independent fixture-based work but label live acceptance outstanding.
Do not assume a failed integration gate passes because mocks work.

### Phase 2 — fetching and domain behavior

Implement the request wrapper, selected fetch strategy, response validation,
normalization, overdue filtering, scheduler, retries, cancellation, and scan
completeness contract. Keep the wrapper's endpoint set read-only and narrowly
scoped. Make time, transport, and retry scheduling injectable for deterministic
tests. Exit: the domain and transport cases in section 6 pass, including multiple
pages, failed boards, malformed payloads, and reauthorization.

### Phase 3 — usable modal and shared modules

Build the table and all states against the scan contract, then connect them to
the verified auth and API wrappers. Keep view-specific behavior in the app and
share only the small functions another Trello view would use. Exit: browser
tests verify sorting, links, safe rendering, user-gesture auth, complete and
partial zero-result states, progress, cancellation, and refresh races.

### Phase 4 — release packaging and documentation

Create a root-level GitHub Actions workflow with Trello path filters and explicit
working directories. Verify and build with the lockfile; stage the Pages artifact
under the agreed subpath; deploy on `main` and manual dispatch once hosting has
been configured. Pull-request checks use fake configuration and never deploy.
Use only the deployment job's required Pages permissions. [S7]

Provide the root project index plus the Trello README, config example, container
commands, HTTPS development instructions, registration URLs, allowed-origin
setup, public-key CI configuration, token-revocation instructions, and a short
SECURITY document explaining the actual SDK token storage. Document how a second
app reuses shared modules and enters the build; no second shipping app is needed.

Exit: a clean checkout builds with documented inputs, the nested Pages artifact
loads correctly, local and CI configuration failures are clear, and the user can
complete the private setup from the README. After authorized deployment and
account setup, verify the final registered URL and live cross-board results.

## 6. Verification matrix

| Layer | Required cases |
| --- | --- |
| Domain | All/dated/overdue mode membership; completed items excluded in every mode; past/equal/future/null-due boundaries; invalid date and state handling; UTC offsets and DST boundary; stable ties; due ascending with undated last; numeric Days overdue ordering and non-overdue blanks; archived board/card/list filtering in every mode, including an open card in an archived list; item eligibility independent of parent-card dueComplete and assignment; mode switches without refetch or clock drift, refresh and cancellation isolation. |
| HTTP and scans | Empty board list; empty cards/checklists; unexpected/missing arrays; compare exact `checklist_fields=name` with omitted projection; HTTP 200 lacking `checkItems` is a failure; more than one page and repeated cursor; duplicate IDs; failed list request or missing list reference; fallback join miss with confirmed archived card, missing open card, moved card, and failed/404/403 card lookup; mid-scan inaccessible board; retryable 429/5xx/network failure with bounded attempts; 401 clears auth and cancels; board-list failure; partial zero results; refresh and close cancellation; late response isolation. |
| Browser with synthetic data | Board-button declaration and fullscreen modal arguments; authorize from a view click; denied/cancelled/failed auth; returning-token path; all display states; sorting via keyboard; hostile item names rendered as text; external Trello links; narrow viewport; production subpath assets and modal URLs. |
| Clean build and packaging | Container installs from lockfile; lint/tests/build pass; no local config in checkout; fake-key verification succeeds; production missing-key build fails; public-key build succeeds; both HTML entry points and icons resolve in the staged Pages directory; token canary absent from output and logs. |
| Real Trello | Normal-browser consent and reopening; manual revocation recovery; two open boards with known matching/nonmatching items; archive exclusion including an open card in an archived list; cross-board links; exact field-projection comparison and endpoint completeness contract; fallback join behavior; comparison with user-visible Trello content under the documented archive scope; final hosted connector and modal. |

Run dependency installation and automated checks in the project Docker image or
an existing suitable development container. Keep host package installations out
of the workflow. Browser tests can use the existing Node Playwright/browser
installation or the container's pinned browser setup. Mocked Trello responses
must be clearly distinguished from live integration verification.

For live verification, retain only sanitized schema/count outcomes; never save
tokens, authorization URLs, browser storage, raw private board dumps, or network
traces containing credentials. A token-canary check is supporting evidence,
alongside code review and request assertions, not proof that arbitrary secrets
can never leak.

## 7. External setup and completion criteria

The implementation can prepare all code, build artifacts, and exact setup
instructions without Trello account access. Registration, API-key generation,
enabling the Power-Up on boards, and granting consent remain user-performed
steps as required by the spec. Publishing to a remote repository or host requires
the user's deployment authorization; writing the workflow is part of the build.
Keep these dependencies visible rather than treating them as completed work.

Completion requires all automated checks above plus the real Trello acceptance
gate. If the chosen browser cannot complete SDK authorization under ordinary
settings, or the selected endpoint cannot establish a complete scan, report the
specific blocker and investigate; do not ship a falsely complete dashboard or
silently add a server, broader scopes, or another authentication architecture.

## 8. Sources

- [S1 — Trello REST API client](https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/)
- [S2 — Trello authorization and allowed origins](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/)
- [S3 — Trello nested resources and check-item fields](https://developer.atlassian.com/cloud/trello/guides/rest-api/nested-resources/)
- [S4 — Trello object definitions](https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/)
- [S5 — Trello REST API introduction and paging](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/)
- [S6 — Vite production builds and multiple HTML entries](https://vite.dev/guide/build.html)
- [S7 — Vite GitHub Pages deployment](https://vite.dev/guide/static-deploy.html)
- [S8 — Trello rate limits](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)
- [S9 — Trello board buttons](https://developer.atlassian.com/cloud/trello/power-ups/capabilities/board-buttons/)
- [S10 — Trello modal UI](https://developer.atlassian.com/cloud/trello/power-ups/ui-functions/modal/)
- [S11 — Firsthand reproduction of open cards in archived lists (May 2026)](https://community.developer.atlassian.com/t/filter-open-on-card-endpoints-ignores-parent-lists-archived-state-inconsistent-with-ui-search/100997)
- [S12 — Developer-forum explanation of list and card archive states](https://community.developer.atlassian.com/t/rest-api-card-in-archived-list-is-not-marked-as-closed/34294)
- [S13 — Trello board lists endpoint](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-lists-get)
- [S14 — Trello single-card endpoint](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-get)
