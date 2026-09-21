import React, { useState, useEffect, useRef } from 'react';
import { 
  Ship, Search, Bell, Plus, Check, X, 
  AlertCircle, ArrowUpRight, Loader2, Terminal
} from 'lucide-react';
import { FileUpload } from '../components/FileUpload';
import { RunSummary, EmailRecord } from '../batch';

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

export const Dashboard: React.FC = () => {
  const [runs, setRuns] = useState<RunSummary[]>([]);
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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchRunsList = async () => {
    try {
      const res = await fetch('/api/runs');
      const data = await res.json();
      if (res.ok && data.status === 'success' && data.runs.length > 0) {
        setRuns(data.runs);
        if (!activeRunId) {
          loadBatch(data.runs[0].run_id);
        }
      }
    } catch (err) {
      console.error('Failed to load runs:', err);
    }
  };

  const loadBatch = async (runId: string) => {
    setActiveRunId(runId);
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
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

    const es = new EventSource(`/api/stream-process?run_id=${encodeURIComponent(runId)}`);
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

  const comparison = selectedEmail?.trace?.comparison;
  const comparisons = comparison?.field_comparisons || {};
  const classification = selectedEmail?.trace?.classification;
  const mismatchFieldCount = selectedEmail?.defect_fields?.length || 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#fcfcfd] text-[#1e293b] font-sans antialiased select-none">
      
      {/* 1. TOP NAVBAR[cite: 9] */}
      <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base tracking-tight">
            <Ship className="w-5 h-5 text-slate-800" />
            <span>MinionShip</span>
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
        
        {/* COLUMN 1: LEFT SIDEBAR (DYNAMIC TRACK PROGRESS BUTTON)[cite: 9] */}
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

            <div className="mt-2 flex-1 overflow-y-auto space-y-1.5 pr-1">
              {runs.map((batch) => {
                const isActive = batch.run_id === activeRunId;
                return (
                  <div
                    key={batch.run_id}
                    onClick={() => loadBatch(batch.run_id)}
                    className={`p-2.5 rounded-lg cursor-pointer transition-all flex items-center justify-between border ${
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
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-[10px] text-slate-400 pt-3 border-t border-slate-100 shrink-0">
            Selected: <span className="font-mono text-slate-600">{activeRunId || 'None'}</span>
          </div>
        </aside>

        {/* COLUMN 2: CENTER EMAIL QUEUE LIST[cite: 9] */}
        <section className="w-80 border-r border-slate-200 bg-white flex flex-col shrink-0">
          <div className="p-3.5 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-900">
              {formatBatchDate(selectedRun?.started_at)}[cite: 1]
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              Batch: {selectedRun?.run_id ? selectedRun.run_id.slice(-8) : '—'} · {selectedRun?.email_count || 0} emails[cite: 1]
            </div>

            <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 text-[11px]">
              <button
                onClick={() => setActiveFilter('ALL')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'ALL' ? 'bg-[#1e293b] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All {selectedRun?.email_count || emails.length}
              </button>
              <button
                onClick={() => setActiveFilter('MISMATCH')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'MISMATCH' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                Mismatches {selectedRun?.mismatch_count || 0}
              </button>
              <button
                onClick={() => setActiveFilter('NEEDS_REVIEW')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'NEEDS_REVIEW' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                Needs review {selectedRun?.needs_review_count || 0}
              </button>
              <button
                onClick={() => setActiveFilter('OK')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'OK' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                Clear {selectedRun?.clear_count || 0}
              </button>
              <button
                onClick={() => setActiveFilter('SPAM')}
                className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeFilter === 'SPAM' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Spam {selectedRun?.spam_count || 0}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredEmails.map((item) => {
              const isSelected = item.email_id === selectedEmail?.email_id;
              const isMismatch = item.automated_status === 'MISMATCH';
              const isReview = item.automated_status === 'NEEDS_REVIEW';

              return (
                <div
                  key={item.email_id}
                  onClick={() => setSelectedEmail(item)}
                  className={`p-3 cursor-pointer transition-colors relative ${
                    isSelected ? 'bg-[#fef2f2]/60' : 'hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
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

                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                      {item.category === 'BL_COMPARISON' ? 'Comparison' : item.category.toLowerCase().replace('_', ' ')}
                    </span>
                    {isMismatch && (
                      <span className="text-[10px] bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded">
                        {item.defect_fields?.length || 1} field mismatch
                      </span>
                    )}
                    {isReview && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded">
                        {item.automated_review_reason || 'Needs review'}
                      </span>
                    )}
                    {item.automated_status === 'OK' && item.category === 'BL_COMPARISON' && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 font-medium px-1.5 py-0.5 rounded">
                        No mismatch
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* COLUMN 3: RIGHT DETAIL INSPECTION PANEL[cite: 9] */}
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
                <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md">
                  {selectedEmail.category === 'BL_COMPARISON' ? 'Document comparison' : selectedEmail.category}
                </span>
              </div>

              {selectedEmail.automated_status === 'MISMATCH' && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">
                      Mismatch found — {mismatchFieldCount} of {Object.keys(comparisons).length || 7} fields differ
                    </div>
                    <div className="text-[11px] text-red-600 mt-0.5">
                      {selectedEmail.defect_fields?.join(', ') || 'Fields'} do not match between SI and draft BL.
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
                  No document comparison performed. This email was categorized as <strong>{selectedEmail.category}</strong>.
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button className="px-4 py-2 bg-[#1e293b] hover:bg-[#0f172a] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer">
                  Confirm mismatch report
                </button>
                <button className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer">
                  Send to human review
                </button>
                <button className="ml-auto text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1">
                  <span>View source documents</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  PROCESSING TRACE
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>
                      <strong>Classified</strong> as document comparison request · confidence {classification?.confidence || 'high'}[cite: 2]
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
                      <strong>Compared</strong> values — {mismatchFieldCount > 0 ? `${mismatchFieldCount} mismatch found on ${selectedEmail.defect_fields?.join(', ')}` : 'all fields verified matching'}[cite: 1]
                    </span>
                  </div>
                </div>
              </div>

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

    </div>
  );
};