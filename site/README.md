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
workflow from `pages.yml`, and stage its output in `stage-site.sh`. Also copy
its inputs in `Dockerfile` and allow them in `Dockerfile.dockerignore`.

## Serve the site yourself (Docker Compose)

[`compose.yaml`](compose.yaml) builds the same site with [`Dockerfile`](Dockerfile)
and serves it with nginx, at the same paths as Pages. Only Docker is needed.

```bash
cd site
cp .env.example .env          # optional: edit ports, address, Trello key
docker compose up -d --build  # build and start; restarts with Docker
docker compose down           # stop
```

With the defaults, open `http://127.0.0.1:8731/web-plugins/`. The JBrowse
plugin is then at
`http://127.0.0.1:8731/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`.

Settings in `site/.env` (all optional; `.env` is git-ignored):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PLUGIN_SITE_HOST_ADDRESS` | `127.0.0.1` | Address on this machine. `127.0.0.1` keeps it private to this machine; `0.0.0.0` lets other computers on your network reach it. |
| `PLUGIN_SITE_HOST_PORT` | `8731` | Port on this machine. |
| `PLUGIN_SITE_CONTAINER_PORT` | `8080` | Port nginx listens on inside the container. |
| `TRELLO_APP_KEY` | placeholder | The Power-Up's public API key. The placeholder builds and serves the Trello pages, but Trello authorization only works with your real key. Rebuild after changing it. |

Port changes take effect on `docker compose up -d`. Changes to the key or the
plugin releases need `--build`.

Notes:

- `restart: unless-stopped` brings the site back whenever Docker starts. A
  JBrowse Desktop session that uses this URL opens only while Docker is
  running.
- Released JBrowse files are served with a one-year `immutable` cache header,
  since versions never change; Trello pages with `no-cache`.
- To share it beyond this machine for JBrowse Web over `https://`, put it
  behind HTTPS (for example a reverse proxy): browsers block `http://` plugin
  URLs on `https://` pages. Desktop accepts `http://`.
- The Trello Power-Up itself is registered with the Pages URL. Serving it
  here does not change that registration.

Tested: built and run with the defaults and with host port 9123 → container
port 9000, and with a port set in `.env`. The redirect, directory listing,
Trello connector and JBrowse plugin (byte-identical to the release, served as
`application/javascript`) were checked. JBrowse Desktop 4.3.0 loaded the
plugin from it and searched.

## Stage without Docker

Build Trello (`npm run config` with a key, then `npm run build` in
`trello-check-date/`), then run
`sh site/stage-site.sh trello-check-date/dist _site`.
