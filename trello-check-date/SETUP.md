# Set up the Trello preview on GitHub Pages

These steps are for [jonjoet/web-plugins](https://github.com/jonjoet/web-plugins).
Everything can be done in your browser; no local Node or Docker installation is
needed for this route.

This release is an **active checklist table preview (v0.2.1)**. It opens from a Trello board,
requests read-only access, and lists active observations for a selected board or
all open boards, with overdue only as the default display. Collection completeness is not yet verified, and the original
field/count integration check remains available. The website and source are public; your Trello board
data and authorization token are not part of the published site.

## 1. Enable GitHub Pages

1. Open [repository Settings → Pages](https://github.com/jonjoet/web-plugins/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Skip the suggested workflow templates: this repository includes
   [Trello checks and Pages](../.github/workflows/trello-check-date.yml).

The workflow will publish after you configure the key and enable deployment in
step 4. GitHub's instructions for
[selecting Actions as the publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow)
describe this setting.

## 2. Register a private Trello Power-Up

1. Sign in at [Trello app administration](https://trello.com/apps/admin).
2. If Trello presents its developer agreement, review and accept it yourself.
3. Click **New** and fill in:

   | Field | Value |
   | --- | --- |
   | Name | `Overdue Checklist Items` |
   | Workspace | The workspace containing the board where you will enable it |
   | Email / Support Email | Your preferred contact addresses |
   | Author | Your preferred display name |
   | iframe Connector URL | The exact URL below |

   ```text
   https://jonjoet.github.io/web-plugins/trello-check-date/apps/overdue-checklist/connector.html
   ```

4. Click **Create**. Keep this Power-Up private to your workspace; public GitHub
   hosting does not require a public Trello marketplace listing.
5. In **Capabilities**, enable **board-buttons** and save if prompted.

The connector URL is determined now and becomes live after step 5. Do not enable
the Power-Up on a board until the deployment finishes. If the admin portal rejects
the not-yet-hosted URL, use the optional reachability fallback below. Do not
substitute a GitHub source-file URL or generate a user token as a workaround.

Trello documents the registration fields in
[Managing Apps](https://developer.atlassian.com/cloud/trello/guides/power-ups/managing-apps/).

### Only if registration requires a reachable connector

This is a contingency, not a known requirement of the admin portal:

1. Follow steps 4 and 5 below with `TRELLO_APP_KEY` temporarily set to
   `00000000000000000000000000000000` and `TRELLO_PAGES_ENABLED` set to `true`.
   This deliberately publishes a preview with a placeholder app key so the
   connector URL can load. Authorization will not work with that key.
2. Once the hosted connector is reachable, return to steps 2 and 3 to register
   the Power-Up, generate its real public API key, and set the allowed origin.
3. Replace the placeholder repository variable with the real public API key and
   run the workflow again as in step 5. Changing the variable alone does not
   update the deployed site.
4. Wait for that new deployment to succeed before enabling or authorizing the
   Power-Up in step 6. If registration still fails, share the validation message.

## 3. Generate the app key and allow the hosting origin

1. In your new Power-Up, open **API Key → Generate a new API Key**.
2. Copy the **API key**. This is the public app identifier, normally 32 hexadecimal
   characters. Do not copy a secret, manually generate a user token, or put a user
   token anywhere in GitHub.
3. In the API key settings, add this exact **allowed origin**, and save:

   ```text
   https://jonjoet.github.io
   ```

An allowed origin has no path. It is different from the connector URL in step 2.
Without a matching origin, Trello can block the consent redirect. See
[Trello authorization](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/).

## 4. Add two GitHub repository variables

1. Open [Settings → Secrets and variables → Actions → Variables](https://github.com/jonjoet/web-plugins/settings/variables/actions).
2. Click **New repository variable** and add:

   | Name | Value |
   | --- | --- |
   | `TRELLO_APP_KEY` | The public API key from step 3 |
   | `TRELLO_PAGES_ENABLED` | `true` (lowercase) |

Use **repository variables**, not environment variables or Actions secrets.
GitHub's [variable setup instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables#creating-configuration-variables-for-a-repository)
show the same screen.

The workflow generates the ignored configuration file automatically. You do not
need to create or commit `config.js` for GitHub Pages. Once enabled, future changes
on `main` under the Trello folder or its workflow will rebuild and redeploy. Pull
requests run checks with a fake key and never deploy. Setting the flag to `false`
stops future deployments; it does not remove a site that is already published.

## 5. Run the first deployment

Pre-deployment validation covered the CI check job and local build/staging
commands. The first deployment also tests GitHub's artifact-upload, Pages setup,
and publish actions for this repository. If one fails, share the failed job/run
link: the workflow may need a fix, rather than the problem being your settings.

1. Open [Actions → Trello checks and Pages](https://github.com/jonjoet/web-plugins/actions/workflows/trello-check-date.yml).
2. Click **Run workflow**, select **main**, and click the green **Run workflow** button.
   Adding variables does not start a run by itself.
3. Open the new run and wait for all three jobs to succeed:
   **Check the preview**, **Build the configured site**, and **Publish to GitHub Pages**.
4. Open the exact [hosted connector URL](https://jonjoet.github.io/web-plugins/trello-check-date/apps/overdue-checklist/connector.html).
   It should load and say to open the Power-Up from a Trello board. It is not the
   checklist view and will not authorize you in a standalone tab.

The repository website root may return 404 because this milestone has no root
index page. Use the full connector URL above. If either deployment job is skipped,
check that the flag is the repository variable `TRELLO_PAGES_ENABLED=true` and that
the run uses `main`. A missing/malformed app key fails the configured build; it
will never silently publish the synthetic-key verification build.

## 6. Enable and authorize on a Trello board

1. Open a board in the workspace selected in step 2.
2. Open **Power-Ups**, locate your private Power-Up in **Custom** (the label may
   vary), and add **Overdue Checklist Items**.
3. Click the new **Overdue items** board button.
4. In the fullscreen preview, click **Authorize (read-only)**.
5. Complete the Trello popup. Check that it requests read-only access. The SDK
   handles the token; there is nothing to paste back into this project.
6. Close the modal, reopen it, and check that it remains connected.

If you close the popup without finishing, use **Cancel waiting**, close the popup,
and reopen the modal before trying again. Test with ordinary browser settings;
do not disable Chrome security flags. The SDK documents storage-partitioning
issues, so successful mocked browser tests do not establish live persistence.
See [the REST client documentation](https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/).

## 7. Run the live integration checks

1. Choose a board with known checklist items and at least one item due date.
2. Click **Run integration check**, then expand the count report if needed.
3. For cross-board acceptance, repeat with a second board. If you only use one
   board, leave that acceptance check untested. An empty board cannot verify item fields.
4. If suitable existing content is available, check an open card in an archived
   list. The report should count that case. The app does not create test data.
5. Check that the board button icon is visible on both light and dark board
   backgrounds. In the report, `collectionCompleteness: "unverified"` is expected:
   this preview does not prove pagination or return an overdue total.
6. Report whether consent, reopening, and the board checks you performed worked. You may share
   the displayed counts-only report. Do not send tokens, authorization URLs,
   browser storage, network exports, or raw board/card data.

Missing item arrays, invalid records, or HTTP errors are outcomes to investigate,
not evidence of zero overdue items. Targeted fallback-card classification and
large-board paging/exhaustion remain pending even when these checks pass.

## 8. View and filter checklist items

1. Reopen the Power-Up after the updated deployment finishes.
2. Choose your board and click **Scan selected board**. Use **Scan all boards**
   only if you want the broader scan; no second test board is needed.
3. The table defaults to **Overdue only**: incomplete items due before scan start.
   Use **Show → All active items** to also see upcoming and undated items, or
   **With a due date** for upcoming and overdue items without undated rows.
   Completed checklist items and archived boards, lists and cards are excluded
   in every mode, for all assignees. Switching modes uses the last scan without
   fetching again; use Refresh results to update the data and overdue timestamp.
4. Click a column heading to sort, or focus it and press Enter. Beside each plain
   card name, **Open here** closes the Power-Up, then navigates the existing Trello tab to that card;
   **Open in new tab** keeps the results available in the original tab.
   Both controls support keyboard activation. If Open here fails, retry or use
   Open in new tab. Dates use your local timezone; Days overdue is elapsed 24-hour
   periods rather than calendar boundaries. Each mode starts sorted by due date,
   oldest first, undated last. A dash means no due date or not overdue at scan start.
5. Compare the selected-board observations with the items you know in Trello.
   The completeness notice is expected in this release, even if all board reads
   succeed. Zero observed rows do not prove that nothing is overdue.
6. **Refresh results** keeps the display mode and reruns the same scope. **Reload board list** refreshes board
   membership and clears the current results. **Cancel scan** stops a running scan.

The v0.2.0 filters were reported working on the user's board. The first Open here
implementation left the Power-Up covering the navigation in live use. The fix
closes it first and needs another live check; synthetic checks do not establish
live acceptance. **Reload the Trello board in the browser after deployment**, then
reopen the Power-Up. Reopening just the modal does not update the persistent
connector. No new key, registration or consent scope is needed. If navigation
fails after the modal closes, a Trello alert directs you to reopen and use
Open in new tab.

If a card moves between boards during **Scan all boards**, the same active item
can appear in two board reads. The second board is then reported as failed and
all its rows are withheld, even if the duplicate is an undated or upcoming item
hidden by the display mode. This can withhold other overdue items from that board.
Use **Refresh results** to retry, or scan the selected board. The failure notice
remains visible in every mode.

## Troubleshooting and revocation

| Symptom | Check |
| --- | --- |
| Workflow is missing | Open the Actions link in step 5 on `main`; the workflow lives at the repository root under `.github/workflows/`. |
| Deployment reports Pages not found | Set **Settings → Pages → Source → GitHub Actions**, then rerun. |
| Configured build rejects the key | Use repository variable `TRELLO_APP_KEY`, containing only the public API key with no quotes. |
| Connector URL is 404 | Wait for a successful deployment and use the complete URL, including `trello-check-date/apps/overdue-checklist/connector.html`. |
| Consent popup is blocked or cannot return | Click Authorize inside the modal; allow that popup and confirm the exact allowed origin from step 3. |
| Modal asks for consent every time | Report the browser/version and which step failed; do not disable security features. |
| A board read returns 403 | Check that your Trello account can access that board. |

**Forget authorization** removes the SDK's stored token, but does not revoke it
at Trello. To revoke access, use your Trello account settings → **Applications**
and revoke this Power-Up. The next API check should return to Authorize. The
developer agreement, account registration, consent, and any test-content changes
are actions you perform in Trello.

For local development or a different HTTPS host, see [README.md](README.md).
