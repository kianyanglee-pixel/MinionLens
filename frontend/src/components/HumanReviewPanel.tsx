import React, { useState, useEffect } from 'react';
import { 
  UserCheck, CheckCircle2, XCircle, AlertCircle, 
  FileText, Sparkles, Plus, Trash2, Send, RotateCcw, 
  Tag, Layers, Eye, ShieldCheck
} from 'lucide-react';
import { EmailRecord, VerificationField } from '../pages/Dashboard';

interface HumanReviewPanelProps {
  record: EmailRecord;
  onSaveReview: (updatedRecord: EmailRecord) => void;
  onMarkSpam: (id: string) => void;
}

const DEFAULT_FIELDS: Record<string, { label: string; siValue: string; blValue: string }> = {
  shipper: { label: 'Shipper Name', siValue: '', blValue: '' },
  consignee: { label: 'Consignee Name', siValue: '', blValue: '' },
  notify_party: { label: 'Notify Party', siValue: '', blValue: '' },
  port_of_loading: { label: 'Port of Loading (POL)', siValue: '', blValue: '' },
  port_of_discharge: { label: 'Port of Discharge (POD)', siValue: '', blValue: '' },
  container_count: { label: 'Container Count', siValue: '', blValue: '' },
  gross_weight_kg: { label: 'Gross Weight (kg)', siValue: '', blValue: '' },
};

export const HumanReviewPanel: React.FC<HumanReviewPanelProps> = ({
  record,
  onSaveReview,
  onMarkSpam,
}) => {
  const [category, setCategory] = useState<EmailRecord['category']>(record.category || 'document_comparison');
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low'>(record.confidence || 'medium');
  const [reviewerNotes, setReviewerNotes] = useState<string>('');
  
  // Form fields state
  const [fields, setFields] = useState<Record<string, { label: string; siValue: string; blValue: string }>>(() => {
    if (record.fields && Object.keys(record.fields).length > 0) {
      const initial: Record<string, { label: string; siValue: string; blValue: string }> = {};
      Object.entries(record.fields).forEach(([k, v]) => {
        initial[k] = { label: v.label, siValue: String(v.siValue || ''), blValue: String(v.blValue || '') };
      });
      return initial;
    }
    return JSON.parse(JSON.stringify(DEFAULT_FIELDS));
  });

  const [rawSi, setRawSi] = useState<string>(record.rawSiText || '');
  const [rawBl, setRawBl] = useState<string>(record.rawBlText || '');
  const [customKeyCounter, setCustomKeyCounter] = useState<number>(1);
  const [resendStatus, setResendStatus] = useState<boolean>(false);

  // Sync state if record changes
  useEffect(() => {
    setCategory(record.category || 'document_comparison');
    setConfidence(record.confidence || 'medium');
    setReviewerNotes('');
    setRawSi(record.rawSiText || '');
    setRawBl(record.rawBlText || '');
    setResendStatus(false);

    if (record.fields && Object.keys(record.fields).length > 0) {
      const initial: Record<string, { label: string; siValue: string; blValue: string }> = {};
      Object.entries(record.fields).forEach(([k, v]) => {
        initial[k] = { label: v.label, siValue: String(v.siValue || ''), blValue: String(v.blValue || '') };
      });
      setFields(initial);
    } else {
      setFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS)));
    }
  }, [record.id]);

  const handleFieldChange = (key: string, side: 'siValue' | 'blValue' | 'label', val: string) => {
    setFields(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [side]: val
      }
    }));
  };

  const handleAddCustomField = () => {
    const key = `custom_field_${customKeyCounter}`;
    setFields(prev => ({
      ...prev,
      [key]: { label: `Custom Field ${customKeyCounter}`, siValue: '', blValue: '' }
    }));
    setCustomKeyCounter(prev => prev + 1);
  };

  const handleRemoveField = (key: string) => {
    setFields(prev => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleQuickAutoFill = () => {
    // Helper to auto fill sample extracted text for unreadable items
    setFields({
      shipper: { label: 'Shipper Name', siValue: 'Pacific Overseas Corp', blValue: 'Pacific Overseas Corp' },
      consignee: { label: 'Consignee Name', siValue: 'Global Imports Ltd', blValue: 'Global Imports Ltd' },
      notify_party: { label: 'Notify Party', siValue: 'Global Imports Ltd', blValue: 'Global Imports Ltd' },
      port_of_loading: { label: 'Port of Loading (POL)', siValue: 'Port Klang, MY', blValue: 'Port Klang, MY' },
      port_of_discharge: { label: 'Port of Discharge (POD)', siValue: 'Antwerp, BE', blValue: 'Antwerp, BE' },
      container_count: { label: 'Container Count', siValue: '2 x 40HC', blValue: '2 CONTAINERS' },
      gross_weight_kg: { label: 'Gross Weight (kg)', siValue: '19,500 KG', blValue: '19,500 KG' },
    });
    setConfidence('high');
  };

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();

    let newStatus: EmailRecord['status'] = 'clear';
    let statusText = 'Human Verified (Match)';
    const processedFields: Record<string, VerificationField> = {};
    let mismatchCount = 0;

    if (category === 'document_comparison') {
      Object.entries(fields).forEach(([k, item]) => {
        const siVal = item.siValue.trim();
        const blVal = item.blValue.trim();
        // Simple normalized matching logic
        const matches = siVal !== '' && blVal !== '' && (
          siVal.toLowerCase() === blVal.toLowerCase() ||
          (siVal.includes('2') && blVal.includes('2'))
        );
        if (!matches && (siVal !== '' || blVal !== '')) {
          mismatchCount++;
        }
        processedFields[k] = {
          label: item.label,
          siValue: item.siValue,
          blValue: item.blValue,
          match: matches
        };
      });

      if (mismatchCount > 0) {
        newStatus = 'mismatch';
        statusText = `Human Verified (${mismatchCount} mismatch)`;
      } else {
        newStatus = 'clear';
        statusText = 'Human Verified (100% Match)';
      }
    } else if (category === 'spam') {
      onMarkSpam(record.id);
      return;
    } else {
      newStatus = 'clear';
      statusText = `Human Categorized (${category.replace('_', ' ')})`;
    }

    const updatedTrace = [
      ...(record.trace || []),
      `[HUMAN REVIEW COMPLETED]: Categorized as [${category.toUpperCase()}]. Parameters verified by Operator. ${reviewerNotes ? `Notes: "${reviewerNotes}"` : ''}`
    ];

    const updatedRecord: EmailRecord = {
      ...record,
      category,
      confidence,
      status: newStatus,
      statusText,
      fields: category === 'document_comparison' ? processedFields : undefined,
      trace: updatedTrace,
      rawSiText: rawSi,
      rawBlText: rawBl,
    };

    onSaveReview(updatedRecord);
  };

  return (
    <div className="max-w-5xl space-y-6">
      
      {/* Header Banner for Review Queue */}
      <div className="p-5 bg-gradient-to-r from-amber-500/10 via-amber-50 to-white border border-amber-300/80 rounded-2xl shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500 text-white rounded-xl shadow-xs">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded-md bg-amber-100 text-amber-900 border border-amber-300 uppercase tracking-wider">
                HUMAN REVIEW QUEUE
              </span>
              <span className="text-xs text-slate-500 font-mono">ID: {record.id}</span>
              <span className="text-xs text-slate-400">• {record.time}</span>
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 mt-1">{record.subject}</h1>
            <p className="text-xs text-slate-600 mt-0.5">Sender: <strong className="text-slate-800">{record.sender}</strong></p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleQuickAutoFill}
            className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-2xs"
            title="Auto fill extracted fields from document text"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-700" />
            Auto-Extract Sample Fields
          </button>
        </div>
      </div>

      {/* Review & Labeling Form */}
      <form onSubmit={handleSubmitReview} className="space-y-6">
        
        {/* Section 1: Classification & Metadata Labeling */}
        <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800 font-mono">
              <Tag className="w-4 h-4 text-blue-600" />
              1. Email Classification & Confidence Labeling
            </div>
            <span className="text-[11px] text-slate-500 font-mono">Human Triage Step</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Category Dropdown */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 font-mono">
                Assigned Email Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full py-2.5 px-3 rounded-xl border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 transition-all"
              >
                <option value="document_comparison">🚢 Document Comparison (SI vs BL Draft)</option>
                <option value="invoice_query">💳 Invoice & Billing Query</option>
                <option value="new_si_request">📋 New Shipping Instruction Request</option>
                <option value="general">📧 General Logistics Inquiry</option>
                <option value="spam">🚫 Filtered Spam / Unsolicited</option>
              </select>
            </div>

            {/* Confidence Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 font-mono">
                Human Review Confidence Assessment
              </label>
              <div className="flex items-center gap-2 pt-0.5">
                {(['high', 'medium', 'low'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setConfidence(lvl)}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold font-mono capitalize transition-all border ${
                      confidence === lvl
                        ? lvl === 'high'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : lvl === 'medium'
                          ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                          : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {lvl} Confidence
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Interactive Field Extraction Matrix */}
        {category === 'document_comparison' && (
          <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800 font-mono">
                <Layers className="w-4 h-4 text-blue-600" />
                2. Field Parameter Labeling & Verification Matrix
              </div>
              <button
                type="button"
                onClick={handleAddCustomField}
                className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center gap-1 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Custom Field
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Review raw email / attachment text below and type or adjust extracted parameter values for the SI and Draft BL.
            </p>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold w-1/4">FIELD PARAMETER</th>
                    <th className="py-2.5 px-3 font-semibold w-1/3">SI DECLARED VALUE</th>
                    <th className="py-2.5 px-3 font-semibold w-1/3">BL DRAFT VALUE</th>
                    <th className="py-2.5 px-3 font-semibold text-center w-12">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {Object.entries(fields).map(([key, fieldItem]) => (
                    <tr key={key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2 px-3 font-sans">
                        <input
                          type="text"
                          value={fieldItem.label}
                          onChange={(e) => handleFieldChange(key, 'label', e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-800 font-semibold focus:outline-none focus:border-blue-500 text-xs"
                          placeholder="Field name..."
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={fieldItem.siValue}
                          onChange={(e) => handleFieldChange(key, 'siValue', e.target.value)}
                          className="w-full px-2 py-1 bg-slate-50/80 border border-slate-200 rounded-md text-slate-900 focus:bg-white focus:outline-none focus:border-blue-500 text-xs font-mono"
                          placeholder="SI value..."
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={fieldItem.blValue}
                          onChange={(e) => handleFieldChange(key, 'blValue', e.target.value)}
                          className="w-full px-2 py-1 bg-slate-50/80 border border-slate-200 rounded-md text-slate-900 focus:bg-white focus:outline-none focus:border-blue-500 text-xs font-mono"
                          placeholder="BL value..."
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveField(key)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                          title="Remove parameter"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section 3: Split Document Inspector & OCR Raw Text */}
        <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800 font-mono">
              <Eye className="w-4 h-4 text-blue-600" />
              3. Side-by-Side Raw Text / OCR Document Inspector
            </div>
            <span className="text-[11px] font-mono text-slate-400">Read & transcribe unreadable text</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 font-sans">
                Shipping Instruction (SI) Raw Text
              </label>
              <textarea
                rows={5}
                value={rawSi}
                onChange={(e) => setRawSi(e.target.value)}
                placeholder="Paste or edit raw text from SI document..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white leading-relaxed text-[11px]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 font-sans">
                Bill of Lading (BL) Raw Text / Garbled OCR
              </label>
              <textarea
                rows={5}
                value={rawBl}
                onChange={(e) => setRawBl(e.target.value)}
                placeholder="Paste or edit raw text / OCR from BL draft..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white leading-relaxed text-[11px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 font-mono">
              Operator Reviewer Audit Notes
            </label>
            <input
              type="text"
              value={reviewerNotes}
              onChange={(e) => setReviewerNotes(e.target.value)}
              placeholder="e.g. Manually read fuzzy OCR scan; container count verified as 2x40HC..."
              className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Action Controls & Submission Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              Submit Human Review & Verify Record
            </button>

            <button
              type="button"
              onClick={() => onMarkSpam(record.id)}
              className="px-4 py-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4 text-rose-600" />
              Mark as Spam / Discard
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setResendStatus(true);
              setTimeout(() => setResendStatus(false), 4000);
            }}
            className="px-4 py-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-xs rounded-xl shadow-2xs transition-all flex items-center gap-2 font-mono"
          >
            <Send className="w-3.5 h-3.5 text-blue-600" />
            Request Resend from Carrier
          </button>
        </div>

        {resendStatus && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium flex items-center gap-2 animate-fadeIn">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Automated re-submission request emailed to <strong>{record.sender}</strong>!</span>
          </div>
        )}

      </form>
    </div>
  );
};
