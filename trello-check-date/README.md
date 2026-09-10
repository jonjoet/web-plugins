# Overdue Checklist Items

A personal, read-only Trello Power-Up for overdue checklist items across open
boards, open lists, and open cards, for all assignees.

**Current milestone: connection preview.** The board button opens a fullscreen
setup view with SDK authorization and a board integration check. It reports
response shapes and counts only. It does not yet display an overdue table or
certify an account-wide scan. Live consent, persistence, exact item projections,
archive/join handling, and endpoint pagination must be verified before selecting
the final fetch strategy. See [the implementation plan](docs/IMPLEMENTATION_PLAN.md).

**Start here:** [Step-by-step GitHub Pages and Trello setup](SETUP.md), with the
exact URLs and settings for `jonjoet/web-plugins`. This route needs only a browser.

## Build and run

Run these commands from `trello-check-date/`. Docker supplies Node and installs
dependencies from the lockfile; no host npm installation is necessary.

```bash
docker build -t trello-check-date:dev .
docker run --rm -p 127.0.0.1:5173:5173 trello-check-date:dev
```

Open `http://localhost:5173/apps/overdue-checklist/view.html`. Without configuration,
the view explains the missing public API key. Outside Trello it cannot complete
the SDK authorization flow.

Copy `config.example.js` to `config.js`, then set `TRELLO_APP_KEY` to the public
32-character API key from your Power-Up. Never put a user token in configuration.
`config.js` is ignored by Git and Docker; mount it explicitly for local use:

```bash
docker run --rm -p 127.0.0.1:5173:5173 \
  --mount type=bind,src="$PWD/config.js",dst=/app/config.js,readonly \
  trello-check-date:dev
```

For source iteration, rebuild the image after editing, or mount `apps/` and
`shared/` into `/app/apps` and `/app/shared` in the development container. Restart
the server after changing configuration. The npm scripts are `dev`, `build`,
`preview`, `lint`, `test`, and `config`; `config` generates `config.js` from public
environment variable `TRELLO_APP_KEY` using JSON serialization.

Build static output using your configured key, with an existing output folder:

```bash
mkdir -p dist
docker run --rm --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$PWD/config.js",dst=/app/config.js,readonly \
  --mount type=bind,src="$PWD/dist",dst=/app/dist \
  trello-check-date:dev npm run build
```

Production builds fail if the public key is missing or malformed. The default
base is `/web-plugins/trello-check-date/`; override with `-e APP_BASE=/your/path/`.
Use a root-relative path with leading and trailing slashes. Development uses `/`.
Only publish `dist/`, never the source directory or configuration file.

## HTTPS hosting and private Trello registration

1. Choose hosting. For GitHub Pages, stage this `dist/` as `trello-check-date/`
   inside the Pages artifact. The repository is `web-plugins`, so the connector is
   `https://OWNER.github.io/web-plugins/trello-check-date/apps/overdue-checklist/connector.html`.
   The included workflow publishes after the repository variables and Pages source
   are configured; follow [SETUP.md](SETUP.md). The preview can also be hosted on
   an existing static HTTPS site with the matching `APP_BASE`.
2. For temporary development, forward the local port using your HTTPS tunnel
   provider. Use the tunnel's HTTPS URL plus
   `/apps/overdue-checklist/connector.html`. Add the tunnel hostname through
   Vite's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable when
   starting the container. Keep the tunnel private to your test session.
3. In [Trello Power-Up administration](https://trello.com/apps/admin), create a
   personal Power-Up named **Overdue Checklist Items**, choose your workspace,
   provide the requested contact/author details, and enter the full connector URL.
   Registration, key generation, enabling the Power-Up, and consent are your steps.
4. In the Power-Up's API Key tab, generate its public API key. Configure the local
   file, rebuild, and replace the static output at the same URL. This resolves the
   setup order: the connector URL is determined first; consent needs the rebuilt
   site with the generated key. Add the exact hosting **origin** to the key's
   allowed origins: for Pages, `https://OWNER.github.io`, without a path. Also add
   the tunnel origin when using a tunnel. Origins and connector URLs are different.
5. Enable the **board-buttons** capability. On a board, open Power-Ups, locate
   your private Power-Up (the Custom section), and enable it. UI labels may vary;
   verify the actual administration screen during setup.
6. Click **Overdue items**, then **Authorize (read-only)** in the modal. Trello's
   popup should request read access only. No manual user-token generation or
   token copy/paste is needed. Close and reopen the modal: it should stay connected.

The [SDK documentation](https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/)
describes Chrome storage-partitioning problems. Use your normal browser settings;
do not disable security flags. If consent or reopening fails, report which step
failed and the on-screen message. Do not send tokens or authorization URLs.

## Run the integration check

Choose an existing board containing a checklist item with a due date. Click
**Run integration check**, then inspect the counts-only report. Repeat on a second
board to check cross-board access. It compares the original `checklist_fields=name`
query with omission of that parameter, and separately reads card metadata, lists,
and the board checklist collection. Zero observed items cannot establish item fields.

The archive check counts open cards inside archived lists and missing list
references. Unmatched fallback card IDs are counted, never assumed archived;
targeted lookup classification is still pending. Every report explicitly marks
collection completeness unverified. The check reads each collection once; it does
not implement paging or prove exhaustion. A small board does not prove large-board
coverage. Pagination and targeted join checks require the next integration step.

Use suitable existing content, or manually prepare a fixture with known incomplete,
complete, past/future/null-due items and an open card in an archived list. The app
cannot create or change test content. Check denial and closing the consent popup,
modal reopening, and revocation from Trello account settings. **Forget authorization**
removes the SDK's stored token; it does not revoke it at Trello.

You may share the displayed count report and observations. Do not capture raw
network traces, private board dumps, browser storage, or credential-bearing URLs.
If the report has missing arrays, invalid records, or errors, that check failed.
Do not infer an empty overdue result from any diagnostic count.

## Automated checks

```bash
docker run --rm trello-check-date:dev npm run lint
docker run --rm trello-check-date:dev npm test
```

The tests use synthetic data. Browser verification uses the standalone
`tests/browser.mjs` script with an existing Node Playwright installation and
browser; pass `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE`, `TEST_SITE_DIR`, and
`TEST_OUTPUT_DIR` as described at the top of that script. It stubs the Trello SDK
and API and checks the built site at its production subpath. This does not test
real Trello iframe permissions or consent.

## Planned overdue behavior and reuse

The completed view will include incomplete items whose due time is strictly
before one frozen scan timestamp. Due dates display in local time; Days overdue
counts elapsed 24-hour periods (`<1` below a full day). Archived boards, lists,
and cards are excluded. Parent-card completion and item assignee do not change
eligibility. Partial reads must show incomplete status rather than a total.

Each HTML file beneath `apps/` is discovered automatically by the Vite build.
Another app can add `apps/<name>/connector.html` and a view and import the small
modules in `shared/`; no second app or framework is included. Shared `auth.js`
owns SDK preparation, `trello-api.js` provides bounded read-only requests, and
`ui.js` provides sanitized messages. The integration probe is separate from the
future overdue domain and scan implementation.

See [SECURITY.md](SECURITY.md) for credential handling and revocation.
