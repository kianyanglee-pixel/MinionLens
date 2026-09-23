import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Bell, Plus, Check, X,
  AlertCircle, AlertTriangle, CheckCircle2, FileWarning, History,
  ArrowUpRight, Loader2, Terminal
} from 'lucide-react';
import { FileUpload } from '../components/FileUpload';
import { RunSummary, EmailRecord, OriginalEmail } from '../batch';
import { apiUrl, readJson } from '../api';

function formatBatchDate(isoString?: string) {
  if (!isoString) return 'Recent Batch';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
}

function formatBatchTime(isoString?: string) {
  if (!isoString) return 'Active';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Human-readable category labels (PRD §4.8 item 10) — raw enum values like
// "INVOICE_QUERY" must never reach the screen as-is.
function categoryLabel(category: string): string {
  if (!category) return 'Unknown';
  if (category === 'BL_COMPARISON') return 'Comparison';
  return category
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function reviewReasonLabel(reason?: string | null): string {
  if (!reason) return '';
  return reason
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const Dashboard: React.FC = () => {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoadError, setRunsLoadError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);

  const [activeFilter, setActiveFilter] = useState<'ALL' | 'MISMATCH' | 'NEEDS_REVIEW' | 'OK' | 'SPAM'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Background Processing & Streaming States
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Human-review resolve form (PRD §2.4-F, §4.9 POST /resolve contract)
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveAwaiting, setResolveAwaiting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Source-evidence drawer (PRD §4.8 item 4)
  const [showSourceDrawer, setShowSourceDrawer] = useState(false);
  const [sourceState, setSourceState] = useState<{
    original: OriginalEmail | null;
    si: string | null;
    bl: string | null;
    loading: boolean;
    error: string | null;
  }>({ original: null, si: null, bl: null, loading: false, error: null });

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Reset per-case UI state whenever the selected email changes, so a stale
  // resolve form or drawer from the previous case never bleeds into this one.
  useEffect(() => {
    setResolveNotes('');
    setResolveAwaiting(false);
    setResolveError(null);
    setShowSourceDrawer(false);
    setSourceState({ original: null, si: null, bl: null, loading: false, error: null });
  }, [selectedEmail?.email_id]);

  const fetchRunsList = async () => {
    try {
      const res = await fetch(apiUrl('/api/runs'));
      const data = await readJson<{ status?: string; runs: RunRecord[]; message?: string }>(res);
      if (res.ok && data.status === 'success') {
        setRunsLoadError(null);
        setRuns(data.runs);
        if (!activeRunId && data.runs.length > 0) {
          loadBatch(data.runs[0].run_id);
        }
      } else {
        setRunsLoadError(data.message || 'Backend returned an error while loading run history.');
      }
    } catch (err) {
      console.error('Failed to load runs:', err);
      setRunsLoadError("Can't reach the backend — check VITE_API_URL and the Render service status.");
    }
  };

  const loadBatch = async (runId: string) => {
    setActiveRunId(runId);
    try {
      const res = await fetch(apiUrl(`/api/runs/${runId}`));
      const data = await readJson<{ status?: string; run: RunRecord; emails: EmailRecord[] }>(res);
      if (res.ok && data.status === 'success') {
        setSelectedRun(data.run);
        setEmails(data.emails);
        if (data.emails.length > 0) {
          const firstComparison = data.emails.find((e: EmailRecord) => e.automated_status === 'MISMATCH') || data.emails[0];
          setSelectedEmail(firstComparison);
        } else {
          setSelectedEmail(null);
        }
      }
    } catch (err) {
      console.error(`Failed to load batch ${runId}:`, err);
    }
  };

  useEffect(() => {
    fetchRunsList();
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Starts the SSE streaming that lives on the dashboard
  const handleStartStream = (runId: string, initialCount: number) => {
    setIsProcessing(true);
    setTotalCount(initialCount);
    setProcessedCount(0);
    setProgressMsg('Connecting to verification engine...');
    setLogs([`[START] Triggered verification for run: ${runId}`]);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(apiUrl(`/api/stream-process?run_id=${encodeURIComponent(runId)}`));
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setProgressMsg(payload.message);
        setProcessedCount(payload.current || 0);
        if (payload.total) setTotalCount(payload.total);
        setLogs((prev) => [...prev.slice(-40), payload.message]);

        if (payload.stage === 'DONE') {
          es.close();
          setIsProcessing(false);
          fetchRunsList();
          loadBatch(runId);
        }
      } catch (err) {
        console.error('SSE JSON error:', err);
      }
    };

    es.onerror = (err) => {
      console.error('SSE Stream Error:', err);
      es.close();
      setIsProcessing(false);
    };
  };

  const progressPercent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;

  // Filter center email queue
  const filteredEmails = emails.filter((item) => {
    let matchesFilter = true;
    if (activeFilter === 'MISMATCH') matchesFilter = item.automated_status === 'MISMATCH';
    else if (activeFilter === 'NEEDS_REVIEW') matchesFilter = item.automated_status === 'NEEDS_REVIEW';
    else if (activeFilter === 'OK') matchesFilter = item.automated_status === 'OK' && item.category !== 'SPAM';
    else if (activeFilter === 'SPAM') matchesFilter = item.category === 'SPAM';

    const matchesSearch =
      item.email_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.trace?.classification?.reason || '').toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  // Derived live from the emails actually loaded for this run, not the
  // runs table's aggregate columns — those only get filled in once a batch
  // finishes (finalizeRunRecord), so an interrupted/still-processing run
  // would otherwise show a stale "520" next to real "0" counts everywhere
  // else, which is what caused the confusing all-zero-but-520 display.
  const mismatchCount = emails.filter((e) => e.automated_status === 'MISMATCH').length;
  const needsReviewCount = emails.filter((e) => e.automated_status === 'NEEDS_REVIEW').length;
  const clearCount = emails.filter((e) => e.automated_status === 'OK' && e.category !== 'SPAM').length;
  const spamCount = emails.filter((e) => e.category === 'SPAM').length;

  const comparison = selectedEmail?.trace?.comparison;
  const comparisons = comparison?.field_comparisons || {};
  const classification = selectedEmail?.trace?.classification;
  const mismatchFieldCount = selectedEmail?.defect_fields?.length || 0;
  const isProcessingFailure = !!selectedEmail?.is_processing_failure;
  const wasHumanCorrected = !!selectedEmail && selectedEmail.current_status !== selectedEmail.automated_status;
  const currentStatus = selectedEmail?.current_status;

  const resolveEmail = async (decision?: 'OK' | 'MISMATCH') => {
    if (!selectedEmail) return;
    setIsResolving(true);
    setResolveError(null);
    try {
      // Was previously `resolveAwaiting ? undefined : decision` — that
      // silently dropped a reviewer's decision if the checkbox happened to
      // be checked, even when they clicked "Mark OK"/"Confirm mismatch"
      // directly. The backend already resolves decisively whenever
      // `decision` is present (db.py's resolve_review_item), so just pass
      // it through as given.
      const res = await fetch(apiUrl(`/api/reviews/${encodeURIComponent(selectedEmail.email_id)}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          notes: resolveNotes,
          awaiting_sender_response: resolveAwaiting,
          run_id: selectedEmail.run_id,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        throw new Error(data.message || 'Resolve failed');
      }

      const patch: Partial<EmailRecord> = {
        current_status: data.current_status ?? selectedEmail.current_status,
        current_review_reason:
          'current_review_reason' in data ? data.current_review_reason : selectedEmail.current_review_reason,
        awaiting_sender_response: data.awaiting_sender_response ?? selectedEmail.awaiting_sender_response,
      };
      const updated = { ...selectedEmail, ...patch };
      setSelectedEmail(updated);
      setEmails((prev) => prev.map((e) => (e.email_id === selectedEmail.email_id ? { ...e, ...patch } : e)));
      setResolveNotes('');
      setResolveAwaiting(false);
    } catch (err: any) {
      setResolveError(err?.message || 'Failed to resolve this case.');
    } finally {
      setIsResolving(false);
    }
  };

  const openSourceDrawer = async () => {
    if (!selectedEmail) return;
    setShowSourceDrawer(true);
    setSourceState((s) => ({ ...s, loading: true, error: null }));

    const runSuffix = activeRunId ? `run_id=${encodeURIComponent(activeRunId)}` : '';
    try {
      const originalRes = await fetch(
        apiUrl(`/api/emails/${encodeURIComponent(selectedEmail.email_name)}/original${runSuffix ? `?${runSuffix}` : ''}`)
      );
      const originalData = await originalRes.json();
      const original: OriginalEmail | null = originalData.status === 'success' ? originalData : null;

      const cmp = selectedEmail.trace?.comparison;
      let si: string | null = null;
      let bl: string | null = null;

      if (cmp?.si_path) {
        const r = await fetch(
          apiUrl(`/api/attachments/content?path=${encodeURIComponent(cmp.si_path)}${runSuffix ? `&${runSuffix}` : ''}`)
        );
        const d = await r.json();
        si = d.status === 'success' ? d.content : null;
      }
      if (cmp?.bl_path) {
        const r = await fetch(
          apiUrl(`/api/attachments/content?path=${encodeURIComponent(cmp.bl_path)}${runSuffix ? `&${runSuffix}` : ''}`)
        );
        const d = await r.json();
        bl = d.status === 'success' ? d.content : null;
      }

      setSourceState({
        original,
        si,
        bl,
        loading: false,
        error: original ? null : 'No readable content extracted for the original email.',
      });
    } catch (err: any) {
      setSourceState({ original: null, si: null, bl: null, loading: false, error: err?.message || 'Failed to load source evidence.' });
    }
  };

  return (
    // Desktop-only for this hackathon build (PRD §4.8 item 9) — a stated
    // requirement, not an accident, rather than a real responsive rebuild.
    <div className="h-screen w-screen min-w-[1280px] flex flex-col bg-[#fcfcfd] text-[#1e293b] font-sans antialiased select-none overflow-x-auto">

      {/* 1. TOP NAVBAR */}
      <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base tracking-tight">
            <img src="/logo.png" alt="MinionLens" className="w-10 h-10 object-contain" />
            <span>MinionLens</span>
          </div>
          <span className="text-slate-300 font-light mx-1">|</span>
          <span className="text-xs text-slate-500 font-medium">Document Verification</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search emails or fields"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 text-slate-700"
            />
          </div>
          <button className="text-slate-400 hover:text-slate-600">
            <Bell className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 bg-[#1e293b] text-white text-xs font-semibold rounded-full flex items-center justify-center">
            IN
          </div>
        </div>
      </header>

      {/* 2. THREE-COLUMN MAIN BODY */}
      <div className="flex-1 flex overflow-hidden">

        {/* COLUMN 1: LEFT SIDEBAR (DYNAMIC TRACK PROGRESS BUTTON) */}
        <aside className="w-64 border-r border-slate-200 bg-white p-4 flex flex-col justify-between shrink-0">
          <div className="flex-1 flex flex-col overflow-hidden">
            {isProcessing ? (
              <button
                onClick={() => setShowUploadModal(true)}
                className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center justify-between shadow-xs transition-colors cursor-pointer shrink-0 animate-pulse"
              >
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Track Progress</span>
                </div>
                <span className="text-[11px] font-mono bg-blue-800/60 px-1.5 py-0.5 rounded">
                  {progressPercent}%
                </span>
              </button>
            ) : (
              <button
                onClick={() => setShowUploadModal(true)}
                className="w-full py-2 px-3 bg-[#1e293b] hover:bg-[#0f172a] text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Run new batch</span>
              </button>
            )}

            <div className="mt-5 text-[10px] font-bold text-slate-400 tracking-wider uppercase shrink-0">
              BATCH INGESTION RUNS
            </div>

            {runsLoadError && (
              <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-700 flex items-start gap-1.5 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{runsLoadError}</span>
              </div>
            )}

            {!runsLoadError && runs.length === 0 && (
              <div className="mt-2 text-[11px] text-slate-400 shrink-0">
                No runs yet — start one above.
              </div>
            )}

            <div className="mt-2 flex-1 overflow-y-auto space-y-1.5 pr-1">
              {runs.map((batch) => {
                const isActive = batch.run_id === activeRunId;
                return (
                  <button
                    key={batch.run_id}
                    type="button"
                    onClick={() => loadBatch(batch.run_id)}
                    className={`w-full text-left p-2.5 rounded-lg cursor-pointer transition-all flex items-center justify-between border ${
                      isActive
                        ? 'bg-slate-100/90 border-slate-300 shadow-2xs font-semibold'
                        : 'border-transparent hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs text-slate-900 truncate">
                        {formatBatchDate(batch.started_at)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {formatBatchTime(batch.started_at)} · {batch.email_count || 0} emails
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {batch.mismatch_count > 0 && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">
                          {batch.mismatch_count}
                        </span>
                      )}
                      {batch.needs_review_count > 0 && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
                          {batch.needs_review_count}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-[10px] text-slate-400 pt-3 border-t border-slate-100 shrink-0">
            Selected: <span className="font-mono text-slate-600">{activeRunId || 'None'}</span>
          </div>
        </aside>

        {/* COLUMN 2: CENTER EMAIL QUEUE LIST */}
        <section className="w-80 border-r border-slate-200 bg-white flex flex-col shrink-0">
          <div className="p-3.5 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-900">
              {formatBatchDate(selectedRun?.started_at)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              Batch: {selectedRun?.run_id ? selectedRun.run_id.slice(-8) : '—'} · {emails.length} processed
              {selectedRun?.email_count && selectedRun.email_count !== emails.length
                ? ` (of ${selectedRun.email_count} uploaded)`
                : ''}
            </div>

            <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 text-[11px]">
              <button
                onClick={() => setActiveFilter('ALL')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'ALL' ? 'bg-[#1e293b] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All {emails.length}
              </button>
              <button
                onClick={() => setActiveFilter('MISMATCH')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'MISMATCH' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                Mismatches {mismatchCount}
              </button>
              <button
                onClick={() => setActiveFilter('NEEDS_REVIEW')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'NEEDS_REVIEW' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                Needs review {needsReviewCount}
              </button>
              <button
                onClick={() => setActiveFilter('OK')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'OK' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                Clear {clearCount}
              </button>
              <button
                onClick={() => setActiveFilter('SPAM')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'SPAM' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Spam {spamCount}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {emails.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 leading-relaxed">
                {selectedRun?.email_count ? (
                  <>
                    This run uploaded {selectedRun.email_count} email(s) but none have finished
                    processing yet — either it's still running, or it was interrupted (e.g. the
                    backend restarted mid-batch) before any email was saved. Click{' '}
                    <strong>Run new batch</strong> to start (or restart) processing.
                  </>
                ) : (
                  <>No emails in this run.</>
                )}
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">No emails match this filter/search.</div>
            ) : (
              filteredEmails.map((item) => {
              const isSelected = item.email_id === selectedEmail?.email_id;
              const isMismatch = item.automated_status === 'MISMATCH';
              const isReview = item.automated_status === 'NEEDS_REVIEW';
              const isCorrected = item.current_status !== item.automated_status;

              return (
                <button
                  key={item.email_id}
                  type="button"
                  onClick={() => setSelectedEmail(item)}
                  className={`w-full text-left p-3 cursor-pointer transition-colors relative block ${
                    isSelected ? 'bg-[#fef2f2]/60' : 'hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.is_processing_failure ? 'bg-slate-400' :
                        isMismatch ? 'bg-red-500' : isReview ? 'bg-amber-500' : item.category === 'SPAM' ? 'bg-slate-300' : 'bg-emerald-500'
                      }`} />
                      <span className="text-xs font-bold text-slate-800 line-clamp-1">
                        {item.email_id}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {formatBatchTime(item.processed_at)}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                    {item.trace?.classification?.reason || `Subject: Inquiry ${item.email_id}`}
                  </p>

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                      {categoryLabel(item.category)}
                    </span>
                    {item.is_processing_failure && (
                      <span className="text-[10px] bg-slate-200 text-slate-700 font-medium px-1.5 py-0.5 rounded">
                        Processing failed
                      </span>
                    )}
                    {!item.is_processing_failure && isMismatch && (
                      <span className="text-[10px] bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded">
                        {item.defect_fields?.length || 1} field mismatch
                      </span>
                    )}
                    {!item.is_processing_failure && isReview && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded">
                        {reviewReasonLabel(item.automated_review_reason) || 'Needs review'}
                      </span>
                    )}
                    {item.automated_status === 'OK' && item.category === 'BL_COMPARISON' && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 font-medium px-1.5 py-0.5 rounded">
                        No mismatch
                      </span>
                    )}
                    {isCorrected && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 font-medium px-1.5 py-0.5 rounded">
                        Corrected
                      </span>
                    )}
                  </div>
                </button>
              );
              })
            )}
          </div>
        </section>

        {/* COLUMN 3: RIGHT DETAIL INSPECTION PANEL */}
        <main className="flex-1 bg-white overflow-y-auto p-6">
          {selectedEmail ? (
            <div className="max-w-4xl space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
                    FREIGHT ONE LOGISTICS · BOOKING {selectedEmail.email_id}
                  </div>
                  <h1 className="text-lg font-bold text-slate-900 mt-1">
                    Re: BL draft for booking {selectedEmail.email_id}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  {selectedEmail.current_review_reason && (
                    <span className="text-xs font-semibold px-2.5 py-1 bg-amber-100 text-amber-800 rounded-md">
                      {reviewReasonLabel(selectedEmail.current_review_reason)}
                    </span>
                  )}
                  <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md">
                    {selectedEmail.category === 'BL_COMPARISON' ? 'Document comparison' : categoryLabel(selectedEmail.category)}
                  </span>
                </div>
              </div>

              {/* automated vs. current status marker (PRD §4.8 item 6) */}
              {wasHumanCorrected && (
                <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center gap-2">
                  <History className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Corrected by a reviewer — the pipeline originally decided{' '}
                    <strong>{selectedEmail.automated_status}</strong>, current answer is{' '}
                    <strong>{selectedEmail.current_status}</strong>.
                  </span>
                </div>
              )}

              {/* Status banners — every status gets one, including NEEDS_REVIEW
                  and a processing failure (PRD §4.8 item 1 + item 5) */}
              {isProcessingFailure ? (
                <div className="p-3.5 bg-slate-100 border border-slate-300 rounded-xl flex items-start gap-3 text-slate-700">
                  <FileWarning className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">Processing failed</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      This is a system fault (an API call or a parser failed), not a document
                      problem — there is nothing to review here. Re-run this email through a new
                      batch to retry it.
                    </div>
                  </div>
                </div>
              ) : currentStatus === 'MISMATCH' ? (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">
                      Mismatch found — {mismatchFieldCount} of {Object.keys(comparisons).length} fields differ
                    </div>
                    <div className="text-[11px] text-red-600 mt-0.5">
                      {selectedEmail.defect_fields?.join(', ') || 'Fields'} do not match between SI and draft BL.
                    </div>
                  </div>
                </div>
              ) : currentStatus === 'NEEDS_REVIEW' ? (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">
                      Needs review{selectedEmail.current_review_reason ? ` — ${reviewReasonLabel(selectedEmail.current_review_reason)}` : ''}
                    </div>
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      {selectedEmail.awaiting_sender_response
                        ? 'Marked as awaiting a response from the sender.'
                        : 'The pipeline could not confidently decide this one on its own.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">No mismatch detected</div>
                    <div className="text-[11px] text-emerald-700 mt-0.5">
                      All checked fields matched between SI and draft BL.
                    </div>
                  </div>
                </div>
              )}

              {comparison ? (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    FIELD-BY-FIELD COMPARISON
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                          <th className="py-2.5 px-4">FIELD</th>
                          <th className="py-2.5 px-4">SI VALUE</th>
                          <th className="py-2.5 px-4">BL VALUE</th>
                          <th className="py-2.5 px-4 text-right">STATUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(comparisons).map(([key, comp]) => {
                          const isDefect = comp.match === false;
                          const isMatch = comp.match === true;

                          return (
                            <tr key={key} className={isDefect ? 'bg-red-50/40 text-red-700' : 'hover:bg-slate-50/50'}>
                              <td className="py-3 px-4 font-semibold text-slate-700">{comp.label}</td>
                              <td className="py-3 px-4 text-slate-600 font-mono">
                                {typeof comp.siValue === 'object' ? JSON.stringify(comp.siValue) : String(comp.siValue ?? '—')}
                              </td>
                              <td className="py-3 px-4 text-slate-600 font-mono">
                                {typeof comp.blValue === 'object' ? JSON.stringify(comp.blValue) : String(comp.blValue ?? '—')}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {isMatch && <Check className="w-3.5 h-3.5 text-emerald-500 ml-auto" />}
                                {isDefect && <X className="w-3.5 h-3.5 text-red-500 ml-auto" />}
                                {comp.match === null && <span className="text-[10px] text-amber-500 font-semibold">missing</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  No document comparison performed. This email was categorized as <strong>{categoryLabel(selectedEmail.category)}</strong>.
                </div>
              )}

              {/* Resolve form + source drawer link — hidden for a processing
                  failure (nothing to review), shown otherwise (PRD §2.4-F) */}
              {!isProcessingFailure && (
                <div className="pt-2 space-y-3">
                  {(currentStatus === 'MISMATCH' || currentStatus === 'NEEDS_REVIEW') && (
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Resolve this case
                      </div>
                      <textarea
                        value={resolveNotes}
                        onChange={(e) => setResolveNotes(e.target.value)}
                        placeholder="Notes — why you made this call, or why you can't yet"
                        className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400 resize-none"
                        rows={2}
                      />
                      <label className="flex items-center gap-2 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={resolveAwaiting}
                          onChange={(e) => setResolveAwaiting(e.target.checked)}
                        />
                        Awaiting a response from the sender (leave undecided for now)
                      </label>
                      {resolveError && <div className="text-[11px] text-red-600">{resolveError}</div>}
                      <div className="flex items-center gap-2">
                        <button
                          disabled={isResolving || resolveAwaiting}
                          onClick={() => resolveEmail('OK')}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          Mark OK
                        </button>
                        <button
                          disabled={isResolving || resolveAwaiting}
                          onClick={() => resolveEmail('MISMATCH')}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          Confirm mismatch
                        </button>
                        {resolveAwaiting && (
                          <button
                            disabled={isResolving}
                            onClick={() => resolveEmail(undefined)}
                            className="px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
                          >
                            {isResolving ? 'Saving…' : 'Save (no decision yet)'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={openSourceDrawer}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                  >
                    <span>View source documents</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="pt-6 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  PROCESSING TRACE
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>
                      <strong>Classified</strong> as {categoryLabel(selectedEmail.category)} · confidence {classification?.confidence || 'high'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>
                      <strong>Extracted</strong> fields from {comparison?.si_path || 'SI.txt'} and {comparison?.bl_path || 'BL.txt'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${mismatchFieldCount > 0 ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <span>
                      <strong>Compared</strong> values — {mismatchFieldCount > 0 ? `${mismatchFieldCount} mismatch found on ${selectedEmail.defect_fields?.join(', ')}` : 'all fields verified matching'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Audit log surface (PRD §4.8 item 7). The DB's
                  unique(email_id, run_id) constraint means there's at most
                  ONE audit row per email — a placeholder from the moment a
                  case is first escalated, updated in place once a reviewer
                  acts (never appended to) — so PostgREST embeds it as a
                  single object or null, not an array. Only show it once
                  resolved_at is set, so an untouched placeholder doesn't
                  look like a real "awaiting sender response" action nobody
                  actually took. */}
              {(() => {
                const auditRow = selectedEmail.review_audit_log;
                if (!auditRow || !auditRow.resolved_at) return null;
                return (
                  <div className="pt-6 border-t border-slate-100">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5" />
                      AUDIT LOG
                    </div>
                    <div className="space-y-2 text-xs text-slate-600">
                      {[auditRow].map((row) => (
                        <div key={row.id} className="border border-slate-100 rounded-lg p-2.5">
                          <div className="font-semibold text-slate-700">
                            {row.action === 'resolved' ? 'Resolved' : row.action === 'awaiting_sender_response' ? 'Awaiting sender response' : 'Retried'}
                            {row.resolved_by ? ` by ${row.resolved_by}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {row.human_decision ? `Decision: ${row.human_decision} · ` : ''}
                            {new Date(row.resolved_at as string).toLocaleString()}
                          </div>
                          {row.notes && <div className="text-[11px] text-slate-500 mt-1">"{row.notes}"</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              Select an email from the list to view comparison results
            </div>
          )}
        </main>

      </div>

      {/* MODAL: RUN NEW BATCH OR VIEW LIVE PROGRESS */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              title="Close modal (Processing continues in background)"
            >
              <X className="w-5 h-5" />
            </button>

            {isProcessing ? (
              /* LIVE STREAMING PROGRESS VIEW (Persists even if modal is closed and re-opened) */
              <div className="space-y-4 pt-1">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base font-sans flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    Processing Verification Batch
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Extracting fields and checking for SI/BL discrepancies in the background.
                  </p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 font-mono truncate pr-2">
                      {progressMsg || 'Processing emails...'}
                    </span>
                    <span className="font-mono font-bold text-blue-600 shrink-0">
                      {processedCount}/{totalCount} ({progressPercent}%)
                    </span>
                  </div>

                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Console Output */}
                <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 font-mono text-[11px] text-slate-300 h-52 overflow-y-auto space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-500 border-b border-slate-800 pb-1 mb-1.5 text-[10px]">
                    <Terminal className="w-3 h-3" />
                    <span>LIVE LOG STREAM</span>
                  </div>
                  {logs.map((log, i) => (
                    <div key={i} className="leading-relaxed">
                      <span className="text-slate-500 select-none">&gt; </span>
                      <span className={log.includes('[SUCCESS]') || log.includes('complete') ? 'text-emerald-400' : 'text-slate-300'}>
                        {log}
                      </span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>

                <div className="text-[11px] text-slate-400 text-center font-mono">
                  You can safely close this window. Processing will continue in the background.
                </div>
              </div>
            ) : (
              /* NEW BATCH INPUTS */
              <FileUpload
                onStartStream={(runId, count) => {
                  handleStartStream(runId, count);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* DRAWER: SOURCE EVIDENCE (PRD §4.8 item 4) */}
      {showSourceDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowSourceDrawer(false)}>
          <div
            className="bg-white h-full w-full max-w-lg shadow-2xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-900">Source evidence</h2>
              <button onClick={() => setShowSourceDrawer(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {sourceState.loading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Original email</div>
                  {sourceState.original ? (
                    <div className="text-xs border border-slate-200 rounded-lg p-3 space-y-1.5">
                      <div><span className="font-semibold text-slate-500">From:</span> {sourceState.original.sender || '—'}</div>
                      <div><span className="font-semibold text-slate-500">Subject:</span> {sourceState.original.subject || '—'}</div>
                      <div className="whitespace-pre-wrap text-slate-600 pt-1 border-t border-slate-100 mt-1">
                        {sourceState.original.body || 'no readable content extracted'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-3">
                      {sourceState.error || 'no readable content extracted'}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">SI attachment</div>
                  <pre className="text-[11px] whitespace-pre-wrap border border-slate-200 rounded-lg p-3 max-h-64 overflow-y-auto text-slate-600">
                    {sourceState.si ?? 'no readable content extracted'}
                  </pre>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">BL attachment</div>
                  <pre className="text-[11px] whitespace-pre-wrap border border-slate-200 rounded-lg p-3 max-h-64 overflow-y-auto text-slate-600">
                    {sourceState.bl ?? 'no readable content extracted'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
