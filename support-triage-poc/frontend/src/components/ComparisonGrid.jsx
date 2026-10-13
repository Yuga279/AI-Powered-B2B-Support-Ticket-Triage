import ResultCard from './ResultCard.jsx';

/** Fields (among successful results) that differ across providers. */
export function diffFields(results) {
  const ok = results.filter((r) => r.status === 'ok');
  const diff = new Set();
  if (ok.length < 2) return diff;
  for (const f of ['team', 'severity']) {
    if (new Set(ok.map((r) => r[f])).size > 1) diff.add(f);
  }
  return diff;
}

export default function ComparisonGrid({ results }) {
  const diff = diffFields(results);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {results.map((r) => (
        <ResultCard key={r.resultId || r.provider} result={r} diff={diff} />
      ))}
    </div>
  );
}
