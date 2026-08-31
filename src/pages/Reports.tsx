import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Play, Loader, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { getReport, getReports, runReport, ReportRunResult } from '../lib/api';

/** Past monthly cellar reports, plus a "run it now" button. */
export default function Reports() {
  const queryClient = useQueryClient();
  const { data: reports, isLoading } = useQuery({ queryKey: ['reports'], queryFn: getReports });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [send, setSend] = useState(true);
  const [refreshPrices, setRefreshPrices] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = selectedId ?? reports?.[0]?.id ?? null;
  const { data: report } = useQuery({ queryKey: ['report', selected], queryFn: () => getReport(selected!), enabled: !!selected });

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const r = await runReport({ send, refreshPrices });
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['wines'] });
      setSelectedId(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed');
    } finally {
      setRunning(false);
    }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Mail size={22} className="text-wine-500" />
          Monthly reports
        </h1>
        <p className="text-slate-400 mt-1 text-sm">Sent automatically on the 1st of each month. Drink-window alerts, current prices, last month's activity, and buying ideas.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} disabled={running} />
          Email it to me
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={refreshPrices} onChange={(e) => setRefreshPrices(e.target.checked)} disabled={running} />
          Refresh prices from the web (slower)
        </label>
        <button
          onClick={handleRun}
          disabled={running}
          className="ml-auto flex items-center gap-2 bg-wine-700 hover:bg-wine-600 disabled:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? `Generating… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'Run now'}
        </button>
        {running && <p className="w-full text-xs text-slate-500">Looking up prices and recommendations takes 5–10 minutes. Keep this tab open.</p>}
        {result && (
          <p className="w-full text-sm flex items-center gap-2 text-emerald-300">
            <CheckCircle size={14} /> Done — {result.totals.bottles} bottles, {result.alerts.pastPeak + result.alerts.lastCall} to drink soon, {result.picks} picks.
            {result.sent ? ' Emailed.' : result.error ? ` ${result.error}` : ''}
          </p>
        )}
        {error && (
          <p className="w-full text-sm flex items-center gap-2 text-red-300">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
        <aside className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">Past reports</div>
          {isLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading…</p>
          ) : reports?.length ? (
            <div className="divide-y divide-slate-800/60 max-h-[60vh] overflow-y-auto">
              {reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${selected === r.id ? 'bg-wine-900/30 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                >
                  <div className="font-medium">{r.month}</div>
                  <div className="text-xs text-slate-500">{fmtDate(r.createdAt)}</div>
                  <div className={`text-xs mt-0.5 ${r.sent ? 'text-emerald-400' : 'text-slate-500'}`}>{r.sent ? `Emailed to ${r.to}` : r.error ? 'Not emailed' : 'Saved only'}</div>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-slate-500">No reports yet — run one above.</p>
          )}
        </aside>

        <section className="bg-white rounded-xl overflow-hidden border border-slate-800 min-h-[60vh]">
          {report ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
                <span className="text-xs text-slate-400 truncate">{report.subject}</span>
                <a href={`/api/reports/${report.id}/html`} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 shrink-0">
                  Open <ExternalLink size={11} />
                </a>
              </div>
              <iframe title={report.subject} srcDoc={report.html} className="w-full h-[75vh] bg-white" sandbox="allow-popups allow-popups-to-escape-sandbox" />
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm p-8">Select a report to view it.</div>
          )}
        </section>
      </div>
    </div>
  );
}
