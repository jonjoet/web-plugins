# Personal web plugins

Small, privately registered web plugins with portable static builds.

All plugins are published together as one GitHub Pages site,
`https://jonjoet.github.io/web-plugins/`, by
[Plugin site (GitHub Pages)](.github/workflows/pages.yml); see [site/](site/README.md).
Each plugin also has a checks-only workflow for pull requests.

- [Trello: Overdue Checklist Items](trello-check-date/README.md) — a read-only
  checklist table preview (v0.2.1) for selected-board or all-board scans, with
  active, dated and overdue filters and current-tab or new-tab card navigation.
  Filters and current-tab navigation have been confirmed in live single-board
  use; collection completeness and broader live acceptance remain pending.
  See the [setup guide](trello-check-date/SETUP.md) to enable it.
- [JBrowse: Genome sequence search](jbrowse-sequence-search/README.md) — a
  JBrowse Web/Desktop 4.3.x plugin (v0.1.0) that searches every sequence of an
  assembly for a DNA sequence (both strands, overlapping, optional IUPAC
  codes) and shows the matches as a clickable list with Previous/Next plus a
  results track. One versioned JavaScript file, served from the Pages site at
  `jbrowse-sequence-search/<version>/` or from your own server; tested in
  JBrowse Web 4.3.0 and Desktop 4.3.0. See the
  [deployment guide](jbrowse-sequence-search/DEPLOYMENT.md).
