# Combined plugin site

One GitHub Pages site serves every plugin in this repository at
`https://jonjoet.github.io/web-plugins/`:

| Path | Source |
| --- | --- |
| `trello-check-date/…` | the Trello Power-Up, built by the workflow with the configured key |
| `jbrowse-sequence-search/<version>/…` | each committed release in `jbrowse-sequence-search/releases/` |

A Pages deployment replaces the whole site, so a plugin missing from the
staged site would disappear. Only
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) deploys. It
runs each plugin's checks, then [`stage-site.sh`](stage-site.sh), then
publishes. Deployment is gated by the repository variable
`TRELLO_PAGES_ENABLED=true`.

`stage-site.sh` fails rather than publish an incomplete site. It fails if:

- the Trello connector is missing;
- there are no JBrowse releases;
- a release's checksums do not match.

To add a plugin, give it a checks workflow with `workflow_call`, call that
workflow from `pages.yml`, and stage its output in `stage-site.sh`.

To stage locally, build Trello (`npm run config` with a key, then
`npm run build` in `trello-check-date/`), then run
`sh site/stage-site.sh trello-check-date/dist _site`.
