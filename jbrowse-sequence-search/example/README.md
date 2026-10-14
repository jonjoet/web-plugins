# Minimal runnable example

A 28 kb synthetic assembly, `example` (`chr1` 20,000 bp, `chr2` 8,000 bp),
generated with the deterministic test helpers. It contains
`ACGTTGCATGCAGTCCTAGG` three times:

| # | Location (1-based) | Strand | Notes |
| --- | --- | --- | --- |
| 1 | chr1:2,001-2,020 | + | |
| 2 | chr1:15,001-15,020 | − | soft-masked (lowercase) in the FASTA |
| 3 | chr2:7,981-8,000 | + | ends at the contig end |

The initial view shows `chr1:1-1000`, so a correct search finds matches
outside the visible region and on another contig.

## Run it

Use any static web server that supports HTTP Range requests, such as nginx,
Apache or `npx http-server`. Python's `http.server` does not support Range
requests. Lay the files out like this:

```
site/
  jbrowse/                     ← unzipped jbrowse-web-v4.3.0.zip
  jbrowse-plugins/jbrowse-sequence-search/0.1.0/  ← from dist/
  example/                     ← this directory
```

For example:

```bash
mkdir -p site/jbrowse-plugins
unzip -q jbrowse-web-v4.3.0.zip -d site/jbrowse
cp -R ../dist/jbrowse-sequence-search site/jbrowse-plugins/
cp -R . site/example
npx http-server site -p 8080 -a 127.0.0.1
```

Open `http://127.0.0.1:8080/jbrowse/?config=/example/config.json`, choose
**Tools → Search genome…**, paste `ACGTTGCATGCAGTCCTAGG` and press
**Search**. Expect *Found 3 matches. Searched all 2 sequences of example
(28.0 kb), both strands.*, with the rows above.

This layout and query were checked in JBrowse Web 4.3.0 with the test
suite's Range-capable server. The `npx http-server` command is an example
and was not run here.
