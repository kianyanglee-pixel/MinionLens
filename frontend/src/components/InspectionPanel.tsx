import React from 'react';
import { 
  CheckCircle2, XCircle, AlertCircle, ExternalLink, 
  FileText, Sparkles, Layers, Activity 
} from 'lucide-react';
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
      <main className="flex-1 bg-[#F8FAFC] p-8 flex flex-col items-center justify-center text-center">
        <div className="p-4 bg-slate-100 rounded-2xl border border-slate-200 mb-4 text-slate-500">
          <FileText className="w-10 h-10 stroke-1" />
        </div>
        <h3 className="text-base font-bold text-slate-800">Non-Manifest Triage Item</h3>
        <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed">
          This message was categorized as <strong className="text-blue-700 font-mono">{record.category}</strong>. 
          Document comparison is skipped for non-checking requests.
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-[#F8FAFC] p-6 overflow-y-auto">
      <div className="max-w-4xl space-y-6">
        
        {/* Header Details Card */}
        <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">
                BOOKING REF: {record.id}
              </span>
              <span className="text-xs text-slate-500">• {record.sender}</span>
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 mt-1.5 font-sans tracking-tight">
              {record.subject}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-xl flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Document Verification
            </span>
            {record.confidence && (
              <span className="text-[10px] font-mono text-slate-500">
                LLM Confidence: <strong className="text-slate-800 uppercase">{record.confidence}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Status Alert Banner */}
        {record.status === 'mismatch' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl shadow-2xs flex items-start gap-3">
            <div className="p-2 bg-rose-100 text-rose-600 rounded-xl shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-rose-950">
                Discrepancy Detected — Field Mismatch in Shipping Manifest
              </h4>
              <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                The declared <strong className="underline decoration-rose-500 decoration-2">Container Count</strong> in the Shipping Instruction (SI) does not match the Bill of Lading (BL) draft. Resolution required.
              </p>
            </div>
          </div>
        )}

        {record.status === 'clear' && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl shadow-2xs flex items-start gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-950">100% Parameter Verification Passed</h4>
              <p className="text-xs text-emerald-800 mt-1">
                All 7 critical ocean freight fields between SI and Draft BL match perfectly without discrepancy.
              </p>
            </div>
          </div>
        )}

        {record.status === 'unreadable' && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl shadow-2xs flex items-start gap-3">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-950">Uncertainty Detected — Unreadable BL</h4>
              <p className="text-xs text-amber-800 mt-1">
                Attachment quality is unreadable or corrupted OCR image. Human review queue required.
              </p>
            </div>
          </div>
        )}

        {/* 7-Field Comparison Matrix Table */}
        {record.fields && (
          <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
                  Parameter Comparison Matrix
                </h3>
              </div>
              <span className="text-[11px] font-mono text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                7 / 7 Parameters Extracted
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4 font-semibold w-1/4">FIELD PARAMETER</th>
                    <th className="py-3 px-4 font-semibold w-1/3">SI DECLARED VALUE</th>
                    <th className="py-3 px-4 font-semibold w-1/3">BL DRAFT VALUE</th>
                    <th className="py-3 px-4 font-semibold text-right">VERDICT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 font-mono text-xs">
                  {Object.entries(record.fields).map(([key, item]) => (
                    <tr 
                      key={key} 
                      className={`transition-colors ${
                        item.match 
                          ? 'hover:bg-slate-50 text-slate-900' 
                          : 'bg-rose-50/80 hover:bg-rose-100/60 text-slate-900 border-l-4 border-rose-500'
                      }`}
                    >
                      <td className="py-3.5 px-4 font-sans font-semibold text-slate-800">
                        {item.label}
                      </td>
                      <td className="py-3.5 px-4 text-slate-900 font-medium">{item.siValue}</td>
                      <td className={`py-3.5 px-4 ${!item.match ? 'text-rose-700 font-bold' : 'text-slate-900 font-medium'}`}>
                        {item.blValue}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {item.match ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Match
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 border border-rose-200 text-rose-800 text-[10px] font-bold">
                            <XCircle className="w-3 h-3 text-rose-600" /> Mismatch
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button 
            onClick={() => onResolveDiscrepancy(record.id)}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4" />
            Confirm Mismatch & Dispatch Alert
          </button>

          <button 
            onClick={() => onEscalate(record.id)}
            className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition-all shadow-2xs"
          >
            Send to Human Review Queue
          </button>

          <button 
            onClick={onOpenSourceModal}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1.5 font-semibold font-mono ml-auto py-2 px-3 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all"
          >
            View Raw Attachments (.txt) <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Processing Trace / LLM Audit Trace */}
        {record.trace && (
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-2xs">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 font-mono">
              <Activity className="w-3.5 h-3.5 text-blue-600" />
              Automated Processing & LLM Audit Trace
            </div>
            <ul className="space-y-2.5 text-xs text-slate-700 font-mono">
              {record.trace.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0" />
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </main>
  );
};