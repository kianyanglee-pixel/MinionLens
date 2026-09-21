import React, { useState } from 'react';
import { Check, X, AlertCircle, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { EmailRecord } from '../batch';

interface InspectionPanelProps {
  email: EmailRecord | null;
  onResolve?: (emailId: string, decision: 'APPROVED' | 'REJECTED', notes: string) => Promise<void>;
}

export const InspectionPanel: React.FC<InspectionPanelProps> = ({ email, onResolve }) => {
  const [decisionNotes, setDecisionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!email) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-400 p-8">
        <FileText className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-xs font-mono">Select an email from the queue to inspect details</p>
      </div>
    );
  }

  const comparison = email.trace?.comparison;
  const comparisons = comparison?.field_comparisons || {};
  const classification = email.trace?.classification;

  const handleAction = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!onResolve) return;
    setIsSubmitting(true);
    await onResolve(email.email_id, decision, decisionNotes);
    setDecisionNotes('');
    setIsSubmitting(false);
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-y-auto">
      {/* Header Info */}
      <div className="bg-white border-b border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900 font-mono">{email.email_id}</h2>
              <span className="text-xs font-mono text-slate-400">({email.email_name})</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Category: <span className="font-semibold text-slate-700">{email.category}</span>
              {classification?.reason && ` — ${classification.reason}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-lg text-xs font-bold font-mono ${
                email.automated_status === 'MISMATCH'
                  ? 'bg-red-100 text-red-700'
                  : email.automated_status === 'NEEDS_REVIEW'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              Status: {email.automated_status}
            </span>
          </div>
        </div>

        {/* Source File Paths */}
        {comparison && (
          <div className="mt-3 flex gap-4 text-xs font-mono text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <span className="font-bold text-slate-800">SI Path:</span> {comparison.si_path}
            </div>
            <div>
              <span className="font-bold text-slate-800">BL Path:</span> {comparison.bl_path}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="p-6 flex-1 space-y-6">
        {comparison ? (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">
              Field Comparison Matrix (SI vs. BL)
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-mono">
                  <th className="py-2.5 px-4 font-bold">Field Name</th>
                  <th className="py-2.5 px-4 font-bold">Shipping Instruction (SI)</th>
                  <th className="py-2.5 px-4 font-bold">Bill of Lading (BL)</th>
                  <th className="py-2.5 px-4 font-bold text-center">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {Object.entries(comparisons).map(([fieldKey, comp]) => {
                  const isMatch = comp.match;
                  const isDefect = isMatch === false;
                  const isMissing = isMatch === null;

                  return (
                    <tr
                      key={fieldKey}
                      className={
                        isDefect
                          ? 'bg-red-50/50'
                          : isMissing
                          ? 'bg-amber-50/30'
                          : 'hover:bg-slate-50/50'
                      }
                    >
                      <td className="py-3 px-4 font-bold text-slate-800">{comp.label}</td>
                      <td className="py-3 px-4 text-slate-700">
                        {typeof comp.siValue === 'object'
                          ? JSON.stringify(comp.siValue)
                          : String(comp.siValue ?? '—')}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {typeof comp.blValue === 'object'
                          ? JSON.stringify(comp.blValue)
                          : String(comp.blValue ?? '—')}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isMatch === true && <Check className="w-4 h-4 text-emerald-600 mx-auto" />}
                        {isDefect && <X className="w-4 h-4 text-red-600 mx-auto" />}
                        {isMissing && (
                          <AlertCircle className="w-4 h-4 text-amber-500 mx-auto" title="Missing field" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl border border-slate-200 text-xs text-slate-500 font-mono">
            No document comparison performed. This email was categorized as{' '}
            <strong className="text-slate-800">{email.category}</strong>.
          </div>
        )}

        {/* Human Resolution Section */}
        {(email.automated_status === 'MISMATCH' || email.automated_status === 'NEEDS_REVIEW') && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Operator Resolution & Audit Action
            </h3>

            <input
              type="text"
              placeholder="Add justification or inspection notes..."
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-blue-500 font-mono"
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleAction('REJECTED')}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Reject Draft
              </button>
              <button
                type="button"
                onClick={() => handleAction('APPROVED')}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve / Override
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};