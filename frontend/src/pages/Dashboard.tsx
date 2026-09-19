import React, { useState } from 'react';
import { 
  Plus, CheckCircle2, XCircle, AlertCircle, 
  Search, ExternalLink, ShieldCheck, X, FileText 
} from 'lucide-react';
import { FileUpload } from '../components/FileUpload';

// Types for Document Verification
export interface VerificationField {
  label: string;
  siValue: string | number;
  blValue: string | number;
  match: boolean;
}

export interface EmailRecord {
  id: string;
  sender: string;
  subject: string;
  category: 'document_comparison' | 'invoice_query' | 'new_si_request' | 'general' | 'spam';
  status: 'mismatch' | 'unreadable' | 'clear';
  statusText: string;
  time: string;
  confidence?: 'high' | 'medium' | 'low';
  fields?: Record<string, VerificationField>;
  trace?: string[];
  rawSiText?: string;
  rawBlText?: string;
}

// Initial Mock Dataset matching hackathon scope
const INITIAL_RECORDS: EmailRecord[] = [
  {
    id: 'FRT-88213',
    sender: 'Freight One Logistics',
    subject: 'Re: BL draft for booking FRT-88213',
    category: 'document_comparison',
    status: 'mismatch',
    statusText: '1 field mismatch',
    time: '07:01',
    confidence: 'high',
    fields: {
      shipper: { label: 'Shipper', siValue: 'Meridian Exports Sdn Bhd', blValue: 'Meridian Exports Sdn Bhd', match: true },
      consignee: { label: 'Consignee', siValue: 'Hafal Trading Co.', blValue: 'Hafal Trading Co.', match: true },
      notify_party: { label: 'Notify party', siValue: 'Hafal Trading Co.', blValue: 'Hafal Trading Co.', match: true },
      port_of_loading: { label: 'Port of loading', siValue: 'Port Klang, MY', blValue: 'Port Klang, MY', match: true },
      port_of_discharge: { label: 'Port of discharge', siValue: 'Rotterdam, NL', blValue: 'Rotterdam, NL', match: true },
      container_count: { label: 'Container count', siValue: '3', blValue: '4', match: false },
      gross_weight_kg: { label: 'Gross weight (kg)', siValue: '22,000', blValue: '22,000', match: true },
    },
    trace: [
      'Classified as document comparison request · confidence high',
      'Extracted 7/7 fields from SI.pdf and 7/7 fields from BL_draft.pdf',
      'Compared values — 1 mismatch found on container count'
    ],
    rawSiText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPOL: Port Klang\nPOD: Rotterdam\nCONTAINERS: 3x40HC\nWEIGHT: 22000 KGS",
    rawBlText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPORT OF LOADING: Port Klang, MY\nPORT OF DISCHARGE: Rotterdam, NL\nTOTAL PACKAGES: 4 CONTAINERS\nGROSS MASS: 22000 KG"
  },
  {
    id: 'PC-9902',
    sender: 'Pacific Carrier Co.',
    subject: 'Shipping instruction attached',
    category: 'document_comparison',
    status: 'unreadable',
    statusText: 'BL unreadable',
    time: '06:54',
    confidence: 'low',
    trace: ['Classified as document comparison request', 'BL attachment corrupted or low scan resolution', 'Escalated to human review queue']
  },
  {
    id: 'MRD-6602',
    sender: 'Meridian Exports',
    subject: 'BL check — booking MRD-6602',
    category: 'document_comparison',
    status: 'clear',
    statusText: 'No mismatch',
    time: '06:48',
    confidence: 'high',
    fields: {
      shipper: { label: 'Shipper', siValue: 'Meridian Exports Sdn Bhd', blValue: 'Meridian Exports Sdn Bhd', match: true },
      consignee: { label: 'Consignee', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      notify_party: { label: 'Notify party', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      port_of_loading: { label: 'Port of loading', siValue: 'Singapore, SG', blValue: 'Singapore, SG', match: true },
      port_of_discharge: { label: 'Port of discharge', siValue: 'Hamburg, DE', blValue: 'Hamburg, DE', match: true },
      container_count: { label: 'Container count', siValue: '2', blValue: '2', match: true },
      gross_weight_kg: { label: 'Gross weight (kg)', siValue: '18,400', blValue: '18,400', match: true },
    },
    trace: ['Classified as document comparison request', 'Extracted 7/7 fields cleanly', 'All 7 values verified equal']
  },
  {
    id: 'INV-7741',
    sender: 'Accounts – Meridian',
    subject: 'Invoice #7741 outstanding balance',
    category: 'invoice_query',
    status: 'clear',
    statusText: 'Invoice query',
    time: '06:31'
  },
  {
    id: 'SPAM-882',
    sender: 'unknown-sender-882',
    subject: 'You have WON a prize!!',
    category: 'spam',
    status: 'clear',
    statusText: 'Spam',
    time: '06:20'
  }
];

export const Dashboard: React.FC = () => {
  const [records, setRecords] = useState<EmailRecord[]>(INITIAL_RECORDS);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_RECORDS[0].id);
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showSourceViewer, setShowSourceViewer] = useState<boolean>(false);

  const selectedRecord = records.find(r => r.id === selectedId) || records[0];

  // Counts for Top Pills
  const counts = {
    all: records.length,
    mismatches: records.filter(r => r.status === 'mismatch').length,
    review: records.filter(r => r.status === 'unreadable').length,
    clear: records.filter(r => r.status === 'clear' && r.category === 'document_comparison').length,
    spam: records.filter(r => r.category === 'spam').length,
  };

  const filteredRecords = records.filter(r => {
    if (activeFilter === 'Mismatches') return r.status === 'mismatch';
    if (activeFilter === 'Needs review') return r.status === 'unreadable';
    if (activeFilter === 'Clear') return r.status === 'clear' && r.category === 'document_comparison';
    if (activeFilter === 'Spam') return r.category === 'spam';
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-[#FDFCFB] text-slate-800 antialiased overflow-hidden">
      {/* Top Navbar */}
      <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <span className="font-bold text-base tracking-tight text-slate-900">ShipCheck</span>
          </div>
          <span className="text-xs text-slate-400 font-normal pl-2 border-l border-slate-200">
            Document Verification
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Search emails or fields"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-slate-50/50"
            />
          </div>
          <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
            IN
          </div>
        </div>
      </header>

      {/* Main 3-Column Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Column: Runs & Batches */}
        <aside className="w-56 border-r border-slate-200 bg-[#FAF9F8] p-4 flex flex-col justify-between shrink-0">
          <div>
            <button 
              onClick={() => setShowUploadModal(true)}
              className="w-full bg-[#1E2538] hover:bg-slate-800 text-white text-xs font-medium py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors mb-6"
            >
              <Plus className="w-3.5 h-3.5" />
              Run new batch
            </button>

            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">This Week</span>
                <div className="mt-2 space-y-1">
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-xs flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">Fri, Sep 19</div>
                      <div className="text-[10px] text-slate-500">50 emails sorted</div>
                    </div>
                    <span className="text-xs font-semibold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">3</span>
                  </div>
                  <div className="p-2.5 rounded-lg hover:bg-slate-100/60 transition-colors flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-xs font-medium text-slate-600">Thu, Sep 18</div>
                      <div className="text-[10px] text-slate-400">44 emails sorted</div>
                    </div>
                    <span className="text-xs text-slate-400">1</span>
                  </div>
                  <div className="p-2.5 rounded-lg hover:bg-slate-100/60 transition-colors flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-xs font-medium text-slate-600">Wed, Sep 17</div>
                      <div className="text-[10px] text-slate-400">38 emails sorted</div>
                    </div>
                    <span className="text-xs text-slate-400">0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">Runs auto-trigger daily at 7:00 AM</p>
        </aside>

        {/* Middle Column: Email Queue */}
        <section className="w-84 border-r border-slate-200 bg-white flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-xs font-bold text-slate-800">Friday, Sep 19</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">50 emails processed · run completed 07:03 AM</p>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1 text-[11px]">
              {[
                { label: 'All', count: counts.all, bg: 'bg-slate-900 text-white' },
                { label: 'Mismatches', count: counts.mismatches, bg: 'bg-rose-50 text-rose-600 hover:bg-rose-100' },
                { label: 'Needs review', count: counts.review, bg: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
                { label: 'Clear', count: counts.clear, bg: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
                { label: 'Spam', count: counts.spam, bg: 'bg-slate-100 text-slate-600 hover:bg-slate-200' }
              ].map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setActiveFilter(tab.label)}
                  className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors font-medium ${
                    activeFilter === tab.label ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label} {tab.count}
                </button>
              ))}
            </div>
          </div>

          {/* Email Item Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredRecords.map(rec => {
              const isSelected = rec.id === selectedId;
              return (
                <div 
                  key={rec.id}
                  onClick={() => setSelectedId(rec.id)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-rose-50/40 border-l-2 border-rose-500' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        rec.status === 'mismatch' ? 'bg-rose-500' : 
                        rec.status === 'unreadable' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                      <span className="text-xs font-semibold text-slate-800 truncate max-w-[170px]">{rec.sender}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{rec.time}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mb-2">{rec.subject}</p>
                  
                  {/* Badges */}
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded font-medium capitalize">
                      {rec.category.replace('_', ' ')}
                    </span>
                    {rec.statusText && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                        rec.status === 'mismatch' ? 'bg-rose-100 text-rose-700' :
                        rec.status === 'unreadable' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {rec.statusText}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Column: Verification Inspector */}
        <main className="flex-1 bg-white p-6 overflow-y-auto">
          {selectedRecord.category === 'document_comparison' ? (
            <div className="max-w-3xl space-y-6">
              
              {/* Header Details */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {selectedRecord.sender} · BOOKING {selectedRecord.id}
                  </span>
                  <h1 className="text-base font-bold text-slate-900 mt-0.5">{selectedRecord.subject}</h1>
                </div>
                <span className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
                  Document comparison
                </span>
              </div>

              {/* Status Alert Banner */}
              {selectedRecord.status === 'mismatch' && (
                <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-lg flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-semibold text-rose-900">Mismatch found — 1 of 7 fields differ</h4>
                    <p className="text-[11px] text-rose-700 mt-0.5">
                      Container count does not match between SI and draft BL.
                    </p>
                  </div>
                </div>
              )}

              {selectedRecord.status === 'clear' && (
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-semibold text-emerald-900">No mismatch detected</h4>
                    <p className="text-[11px] text-emerald-700 mt-0.5">All seven shipment parameters agree perfectly.</p>
                  </div>
                </div>
              )}

              {/* 7-Field Comparison Table */}
              {selectedRecord.fields && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Field-by-Field Comparison
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                        <tr>
                          <th className="py-2 px-3 font-semibold w-1/4">FIELD</th>
                          <th className="py-2 px-3 font-semibold w-1/3">SI VALUE</th>
                          <th className="py-2 px-3 font-semibold w-1/3">BL VALUE</th>
                          <th className="py-2 px-3 font-semibold text-right">STATUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(selectedRecord.fields).map(([key, item]) => (
                          <tr key={key} className={item.match ? 'hover:bg-slate-50/50' : 'bg-rose-50/30'}>
                            <td className="py-2.5 px-3 font-medium text-slate-700">{item.label}</td>
                            <td className="py-2.5 px-3 text-slate-900">{item.siValue}</td>
                            <td className={`py-2.5 px-3 ${!item.match ? 'text-rose-600 font-semibold' : 'text-slate-900'}`}>
                              {item.blValue}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {item.match ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline-block" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-rose-500 inline-block" />
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
                  onClick={() => alert("Mismatch report confirmed!")}
                  className="px-4 py-2 bg-[#1E2538] hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  Confirm mismatch report
                </button>
                <button 
                  onClick={() => alert("Case escalated to human reviewer queue")}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-xs"
                >
                  Send to human review
                </button>
                <button 
                  onClick={() => setShowSourceViewer(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium ml-2"
                >
                  View source documents <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Processing Trace / Reasoning Panel */}
              {selectedRecord.trace && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Processing Trace
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {selectedRecord.trace.map((step, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          ) : (
            /* Non-comparison screen (Spam / Invoices) */
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <FileText className="w-10 h-10 text-slate-300 mb-3" />
              <h3 className="text-sm font-semibold text-slate-700">Email Triage Only</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                This item was classified as <strong className="text-slate-600">{selectedRecord.category}</strong>. No document comparison required.
              </p>
            </div>
          )}
        </main>

      </div>

      {/* File Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden">
            <button 
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-4">
              <FileUpload 
                onProcessFiles={(files) => {
                  alert(`Ingested ${files.length} documents into batch`);
                  setShowUploadModal(false);
                }} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Raw Source Document Side Drawer */}
      {showSourceViewer && selectedRecord.rawSiText && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800">Raw Attachment Sources</h3>
            <button onClick={() => setShowSourceViewer(false)}>
              <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-4 font-mono text-[11px]">
            <div>
              <span className="font-sans font-bold text-[10px] text-slate-400 uppercase">SI Attachment (.txt)</span>
              <pre className="p-2.5 bg-slate-50 border border-slate-200 rounded mt-1 whitespace-pre-wrap text-slate-700">
                {selectedRecord.rawSiText}
              </pre>
            </div>
            <div>
              <span className="font-sans font-bold text-[10px] text-slate-400 uppercase">BL Draft (.txt)</span>
              <pre className="p-2.5 bg-slate-50 border border-slate-200 rounded mt-1 whitespace-pre-wrap text-slate-700">
                {selectedRecord.rawBlText}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};