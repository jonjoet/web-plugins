import { observer } from 'mobx-react';
import { getSession } from '@jbrowse/core/util';
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormLabel, LinearProgress,
  MenuItem, Radio, RadioGroup, TextField, Typography,
} from '@mui/material';
import { formatBases, formatLocation, formatNumber } from '../search/format.js';
import { sessionAssemblyNames } from '../jbrowse/session.js';
import ResultsList from './ResultsList.jsx';

const STRANDS = {
  both: 'both strands',
  forward: 'the forward (+) strand only',
  reverse: 'the reverse (−) strand only',
};

function plural(n, word) {
  return `${formatNumber(n)} ${word}${n === 1 ? '' : 'es'}`;
}

function scopeText({ assemblyName, regionCount, totalBases, strandMode }) {
  return `all ${formatNumber(regionCount)} sequences of ${assemblyName} (${formatBases(totalBases)}), ${STRANDS[strandMode]}`;
}

function coverageText(r) {
  if (!r.coveredThrough) return 'It stopped before any part of the genome was fully searched.';
  const { refName, position } = r.coveredThrough;
  return `Matches starting up to ${refName}:${formatNumber(position)} are listed; later positions were not searched.`;
}

// One message that states exactly what was searched and whether the list is
// complete.
export function outcomeMessage(r) {
  const scope = scopeText(r);
  switch (r.status) {
    case 'complete':
      return r.count === 0
        ? { severity: 'info', text: `No matches. Searched ${scope}.` }
        : { severity: 'success', text: `Found ${plural(r.count, 'match')}. Searched ${scope}.` };
    case 'limit':
      return {
        severity: 'warning',
        text: `Incomplete: stopped at the limit of ${formatNumber(r.maxHits)} matches. The first ${formatNumber(r.count)} in genome order are listed, through ${r.coveredThrough.refName}:${formatNumber(r.coveredThrough.position)}; the rest of ${r.assemblyName} was not searched. Use a longer sequence to narrow the search.`,
      };
    case 'cancelled':
      return { severity: 'warning', text: `Incomplete: search stopped. ${plural(r.count, 'match')} found before stopping. ${coverageText(r)}` };
    default:
      return { severity: 'error', text: `Incomplete: the search failed (${r.error}). ${plural(r.count, 'match')} found before the failure. ${coverageText(r)}` };
  }
}

const Form = observer(function Form({ model }) {
  const session = getSession(model);
  const names = sessionAssemblyNames(session);
  const assembly = model.assemblyName ? session.assemblyManager.get(model.assemblyName) : undefined;
  const regions = assembly?.regions;
  const parsed = model.parsed;
  const empty = model.queryText.trim() === '';
  return (
    <Box component="form" onSubmit={e => { e.preventDefault(); model.search(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField
        select
        size="small"
        label="Assembly"
        value={model.assemblyName ?? ''}
        onChange={e => model.setAssemblyName(e.target.value)}
        disabled={model.running}
        inputProps={{ 'data-testid': 'genome-search-assembly' }}
      >
        {names.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
      </TextField>
      <TextField
        label="DNA sequence"
        multiline
        minRows={3}
        maxRows={8}
        value={model.queryText}
        onChange={e => model.setQueryText(e.target.value)}
        placeholder="e.g. GAATTC — paste plain sequence or one FASTA record"
        error={!empty && !parsed.ok}
        helperText={empty ? 'Letters A, C, G, T; case, spaces and line breaks are ignored.'
          : parsed.ok ? [`${formatNumber(parsed.length)} bases.`, ...parsed.notes].join(' ') : parsed.error}
        inputProps={{ 'data-testid': 'genome-search-query', spellCheck: false, style: { fontFamily: 'monospace' } }}
      />
      <FormControl>
        <FormLabel id="genome-search-strand">Strands</FormLabel>
        <RadioGroup row aria-labelledby="genome-search-strand" value={model.strandMode} onChange={e => model.setStrandMode(e.target.value)}>
          <FormControlLabel value="both" control={<Radio size="small" />} label="Both" />
          <FormControlLabel value="forward" control={<Radio size="small" />} label="Forward (+)" />
          <FormControlLabel value="reverse" control={<Radio size="small" />} label="Reverse (−)" />
        </RadioGroup>
      </FormControl>
      <FormControlLabel
        control={<Checkbox size="small" checked={model.allowAmbiguity} onChange={e => model.setAllowAmbiguity(e.target.checked)} />}
        label={(
          <span>
            Allow ambiguity codes
            <Typography component="span" variant="caption" display="block" color="text.secondary">
              N = A/C/G/T, R = A/G, Y = C/T, and so on (IUPAC). These are not wildcards for gaps or patterns; an N in the genome never matches.
            </Typography>
          </span>
        )}
      />
      <Typography variant="body2" color="text.secondary" data-testid="genome-search-scope">
        {model.assemblyName
          ? regions
            ? `Searches ${scopeText({ assemblyName: model.assemblyName, regionCount: regions.length, totalBases: regions.reduce((s, r) => s + r.end - r.start, 0), strandMode: model.strandMode })} — the whole assembly, not just the region on screen.`
            : `Searches every sequence of ${model.assemblyName}, not just the region on screen.`
          : 'No assembly is loaded.'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button type="submit" variant="contained" disabled={!parsed.ok || !model.assemblyName} data-testid="genome-search-submit">
          {model.running ? 'Restart search' : 'Search'}
        </Button>
        {model.running ? (
          <Button variant="outlined" color="warning" onClick={() => model.cancel()} data-testid="genome-search-stop">Stop</Button>
        ) : null}
      </Box>
    </Box>
  );
});

const Progress = observer(function Progress({ model }) {
  const { progress, runningSearch } = model;
  if (!progress) return null;
  const fraction = progress.totalBases ? progress.scannedBases / progress.totalBases : 0;
  return (
    <Box data-testid="genome-search-progress">
      <LinearProgress variant={progress.totalBases ? 'determinate' : 'indeterminate'} value={fraction * 100} />
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {progress.totalBases
          ? `Searching ${runningSearch.assemblyName}: ${formatBases(progress.scannedBases)} of ${formatBases(progress.totalBases)} (${Math.floor(fraction * 100)}%), ${plural(progress.hits, 'match')} so far.`
          : `Preparing ${runningSearch.assemblyName}…`}
      </Typography>
    </Box>
  );
});

const Results = observer(function Results({ model }) {
  if (model.running) return null;
  if (model.resultsMissing) {
    return <Alert severity="info">The results track was removed, so its results are no longer available. Run the search again.</Alert>;
  }
  const results = model.results ?? model.emptyOutcome;
  if (!results) return null;
  if (results.error instanceof Error) return <Alert severity="error">{results.error.message}</Alert>;
  const message = outcomeMessage(results);
  const hits = results.hits ?? [];
  const selected = model.selectedIndex;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Alert severity={message.severity} data-testid="genome-search-outcome" data-status={results.status}>
        <strong>{results.query.length > 40 ? `${results.query.slice(0, 36)}…` : results.query}</strong>
        {' in '}{results.assemblyName}: {message.text}
        {results.palindromic && results.strandMode === 'both'
          ? ' This sequence is its own reverse complement, so each site is listed once, with strand “both”.' : ''}
      </Alert>
      {hits.length ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => model.step(-1)} disabled={selected === 0} data-testid="genome-search-previous">Previous</Button>
            <Button size="small" variant="outlined" onClick={() => model.step(1)} disabled={selected === hits.length - 1} data-testid="genome-search-next">Next</Button>
            <Typography variant="body2" data-testid="genome-search-position">
              {selected >= 0
                ? `Match ${formatNumber(selected + 1)} of ${formatNumber(hits.length)}: ${formatLocation(hits[selected].refName, hits[selected].start, hits[selected].end)}`
                : `${formatNumber(hits.length)} listed in genome order. Select one to go to it.`}
            </Typography>
          </Box>
          {model.navigationError ? <Alert severity="error">{model.navigationError}</Alert> : null}
          <ResultsList hits={hits} selectedIndex={selected} onSelect={i => model.select(i)} />
          <Typography variant="caption" color="text.secondary">
            Coordinates are 1-based and inclusive. Matches are also shown in the track “{model.resultTrackName}”.
          </Typography>
        </>
      ) : null}
    </Box>
  );
});

const SearchWidget = observer(function SearchWidget({ model }) {
  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="genome-search-widget">
      <Form model={model} />
      {model.runError ? <Alert severity="error" data-testid="genome-search-error">Search could not run: {model.runError}</Alert> : null}
      <Progress model={model} />
      <Results model={model} />
    </Box>
  );
});

export default SearchWidget;
