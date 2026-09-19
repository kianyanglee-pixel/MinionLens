import React from 'react';
import { CheckCircle2, XCircle, AlertCircle, ExternalLink, FileText, Check } from 'lucide-react';
import { EmailRecord } from '../pages/Dashboard';

interface InspectionPanelProps {
  record: EmailRecord;
  onOpenSourceModal: () => void;
  onResolveDiscrepancy: (recordId: string) => void;
  onEscalate: (recordId: string) => void;
}

export const InspectionPanel: React.FC<InspectionPanelProps> = ({
  record,
  onOpenSourceModal,
  onResolveDiscrepancy,
  onEscalate,
}) => {
  if (record.category !== 'document_comparison') {
    return (
      <main className="flex-1 bg-white p-6 flex flex-col items-center justify-center text-center">
        <FileText className="w-10 h-10 text-slate-300 mb-3" />
        <h3 className="text-sm font-semibold text-slate-700">Email Triage Only</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1">
          This message was classified as <strong className="text-slate-600 capitalize">{record.category.replace('_', ' ')}</strong>[cite: 1, 7]. 
          Document checking is skipped for non-comparison categories.
        </p>
      </main>
    );
  }

  const mismatchedCount = record.fields 
    ? Object.values(record.fields).filter((f) => !f.match).length 
    : 0;

  return (
    <main className="flex-1 bg-white p-6 overflow-y-auto">
      <div className="max-w-3xl space-y-6">
        
        {/* Document Header */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {record.sender} · BOOKING {record.id}
            </span>
            <h1 className="text-base font-bold text-slate-900 mt-0.5">{record.subject}</h1>
          </div>
          <span className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
            Document comparison
          </span>
        </div>

        {/* Dynamic Status Alert Banner */}
        {record.status === 'mismatch' && (
          <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-lg flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-rose-900">
                Mismatch found — {mismatchedCount} of 7 fields differ
              </h4>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Check values below against the reference Shipping Instruction (SI).
              </p>
            </div>
          </div>
        )}

        {record.status === 'clear' && (
          <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-emerald-900">No mismatch detected</h4>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                All 7 shipping fields match between SI and BL.
              </p>
            </div>
          </div>
        )}

        {record.status === 'unreadable' && (
          <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-amber-900">Uncertainty Detected</h4>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Attachment quality is unreadable or missing required values. Human review required.
              </p>
            </div>
          </div>
        )}

        {/* 7-Field Side-by-Side Table */}
        {record.fields && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Field-by-Field Comparison
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <tr>
                    <th className="py-2 px-3 font-semibold w-1/4">FIELD</th>
                    <th className="py-2 px-3 font-semibold w-1/3">SI VALUE (REF)</th>
                    <th className="py-2 px-3 font-semibold w-1/3">BL VALUE</th>
                    <th className="py-2 px-3 font-semibold text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(record.fields).map(([key, item]) => (
                    <tr key={key} className={item.match ? 'hover:bg-slate-50/50' : 'bg-rose-50/30'}>
                      <td className="py-2.5 px-3 font-medium text-slate-700">{item.label}</td>
                      <td className="py-2.5 px-3 text-slate-900">{item.siValue}</td>
                      <td className={`py-2.5 px-3 ${!item.match ? 'text-rose-600 font-semibold' : 'text-slate-900'}`}>
                        {item.blValue}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {item.match ? (
                          <Check className="w-4 h-4 text-emerald-500 inline-block" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-500 inline-block" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions & Human Review Controls */}
        <div className="flex items-center gap-3 pt-2">
          <button 
            onClick={() => onResolveDiscrepancy(record.id)}
            className="px-4 py-2 bg-[#1E2538] hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            Confirm report
          </button>
          {/*Later need to create a page for human review(?), onEscalate function needs to be changed.*/}
          <button 
            onClick={() => onEscalate(record.id)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-xs"
          >
            Send to human review
          </button>
          {/*Later need to change the ui */}
          <button 
            onClick={onOpenSourceModal}
            className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium ml-2"
          >
            View source documents<ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {/* Processing Trace / Confidence */}
        {record.trace && (
          <div className="pt-4 border-t border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Processing Trace
            </div>
            <ul className="space-y-1.5 text-xs text-slate-600">
              {record.trace.map((step, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </main>
  );
};