import React, { useState } from 'react';
import { 
  Plus, CheckCircle2, XCircle, AlertCircle, 
  Search, ExternalLink, ShieldCheck, X, FileText,
  Ship, Compass, Activity, Clock, SlidersHorizontal,
  Layers, Radio, Sparkles, ArrowRight, UserCheck
} from 'lucide-react';
import { FileUpload } from '../components/FileUpload';
import { HumanReviewPanel } from '../components/HumanReviewPanel';

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
      shipper: { label: 'Shipper Name', siValue: 'Meridian Exports Sdn Bhd', blValue: 'Meridian Exports Sdn Bhd', match: true },
      consignee: { label: 'Consignee Name', siValue: 'Hafal Trading Co.', blValue: 'Hafal Trading Co.', match: true },
      notify_party: { label: 'Notify Party', siValue: 'Hafal Trading Co.', blValue: 'Hafal Trading Co.', match: true },
      port_of_loading: { label: 'Port of Loading (POL)', siValue: 'Port Klang, MY', blValue: 'Port Klang, MY', match: true },
      port_of_discharge: { label: 'Port of Discharge (POD)', siValue: 'Rotterdam, NL', blValue: 'Rotterdam, NL', match: true },
      container_count: { label: 'Container Count', siValue: '3 x 40HC', blValue: '4 CONTAINERS', match: false },
      gross_weight_kg: { label: 'Gross Weight (kg)', siValue: '22,000 KG', blValue: '22,000 KG', match: true },
    },
    trace: [
      'LLM Classifier: Document comparison request detected (confidence 99.4%)',
      'Extracted 7/7 structured fields from SI.txt and 7/7 fields from BL_draft.txt',
      'Automated Diff Engine: Discrepancy detected in [Container Count] (SI: 3 vs BL: 4)',
      'Flagged for dispatcher review & escalation'
    ],
    rawSiText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPOL: Port Klang, MY\nPOD: Rotterdam, NL\nCONTAINERS: 3x40HC\nWEIGHT: 22000 KGS",
    rawBlText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPORT OF LOADING: Port Klang, MY\nPORT OF DISCHARGE: Rotterdam, NL\nTOTAL PACKAGES: 4 CONTAINERS\nGROSS MASS: 22000 KG"
  },
  {
    id: 'PC-9902',
    sender: 'Pacific Carrier Co.',
    subject: 'Shipping instruction attached — PC-9902',
    category: 'document_comparison',
    status: 'unreadable',
    statusText: 'BL unreadable (OCR noise)',
    time: '06:54',
    confidence: 'low',
    trace: [
      'LLM Classifier: Document comparison request detected',
      'Extraction Error: BL attachment unreadable or corrupted OCR image',
      'Escalated to human review queue with priority flag'
    ],
    rawSiText: "SHIPPER: Pacific Overseas Corp\nCONSIGNEE: Global Imports Ltd\nPOL: Port Klang, MY\nPOD: Antwerp, BE\nCONTAINERS: 2x40HC\nWEIGHT: 19500 KGS",
    rawBlText: "--- BL SCAN (OCR GARBLED) ---\nSHPR: Pacific Oversea???\nCNSG: Global Imprts\nPORT OF L: Port Klang\nPOD: Antwerp\nPACKAGES: [UNREADABLE SCAN]\nGROSS WT: 19500 KG"
  },
  {
    id: 'UNR-1044',
    sender: 'Oceanic Line Express',
    subject: 'SI Draft submission for booking UNR-1044',
    category: 'document_comparison',
    status: 'unreadable',
    statusText: 'SI Header Missing',
    time: '06:40',
    confidence: 'low',
    trace: [
      'LLM Classifier: Document comparison request detected',
      'Extraction Error: Missing Shipper Tax ID and unreadable Container Manifest block',
      'Escalated to human review queue'
    ],
    rawSiText: "BOOKING: UNR-1044\nSHIPPER: [BLURRED IMAGE]\nCONSIGNEE: TransWorld Logistics\nPOL: Shanghai, CN\nPOD: Los Angeles, US\nCONTAINER: 5x40HQ\nWEIGHT: 45000 KGS",
    rawBlText: "SHIPPER: Ocean Star Trading Co.\nCONSIGNEE: TransWorld Logistics\nPOL: Shanghai, CN\nPOD: Los Angeles, US\nCONTAINER: 5x40HQ\nWEIGHT: 45000 KGS"
  },
  {
    id: 'MRD-6602',
    sender: 'Meridian Exports',
    subject: 'BL check — booking MRD-6602',
    category: 'document_comparison',
    status: 'clear',
    statusText: '100% Match',
    time: '06:48',
    confidence: 'high',
    fields: {
      shipper: { label: 'Shipper Name', siValue: 'Meridian Exports Sdn Bhd', blValue: 'Meridian Exports Sdn Bhd', match: true },
      consignee: { label: 'Consignee Name', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      notify_party: { label: 'Notify Party', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      port_of_loading: { label: 'Port of Loading (POL)', siValue: 'Singapore, SG', blValue: 'Singapore, SG', match: true },
      port_of_discharge: { label: 'Port of Discharge (POD)', siValue: 'Hamburg, DE', blValue: 'Hamburg, DE', match: true },
      container_count: { label: 'Container Count', siValue: '2 x 20GP', blValue: '2 x 20GP', match: true },
      gross_weight_kg: { label: 'Gross Weight (kg)', siValue: '18,400 KG', blValue: '18,400 KG', match: true },
    },
    trace: [
      'LLM Classifier: Document comparison request detected',
      'Extracted 7/7 fields cleanly from both SI and BL drafts',
      'All 7 shipment parameters verified equal — auto-approved'
    ]
  },
  {
    id: 'INV-7741',
    sender: 'Accounts – Meridian',
    subject: 'Invoice #7741 outstanding balance query',
    category: 'invoice_query',
    status: 'clear',
    statusText: 'Invoice Query',
    time: '06:31'
  },
  {
    id: 'SPAM-882',
    sender: 'unknown-sender-882',
    subject: 'Urgent: You have WON a freight voucher!',
    category: 'spam',
    status: 'clear',
    statusText: 'Filtered Spam',
    time: '06:20'
  }
];

export const Dashboard: React.FC = () => {
  const [records, setRecords] = useState<EmailRecord[]>(INITIAL_RECORDS);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_RECORDS[0].id);
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showSourceViewer, setShowSourceViewer] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const selectedRecord = records.find(r => r.id === selectedId) || records[0];

  // Counts for Top Pills
  const counts = {
    all: records.length,
    mismatches: records.filter(r => r.status === 'mismatch').length,
    review: records.filter(r => r.status === 'unreadable').length,
    clear: records.filter(r => r.status === 'clear' && r.category === 'document_comparison').length,
    spam: records.filter(r => r.category === 'spam').length,
  };

  const handleSaveReview = (updatedRecord: EmailRecord) => {
    setRecords(prev => prev.map(r => r.id === updatedRecord.id ? updatedRecord : r));
    setToastMessage(`Record ${updatedRecord.id} human review submitted and verified!`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleMarkSpam = (id: string) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, category: 'spam', status: 'clear', statusText: 'Filtered Spam' } : r));
    setToastMessage(`Record ${id} re-categorized as Spam.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleSendToReviewQueue = (id: string) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'unreadable', statusText: 'Pending Human Review' } : r));
    setSelectedId(id);
    setActiveFilter('Needs review');
    setToastMessage(`Escalated ${id} to Human Review Queue.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const filteredRecords = records.filter(r => {
    const matchesQuery = searchQuery === '' || 
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.subject.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesQuery) return false;

    if (activeFilter === 'Mismatches') return r.status === 'mismatch';
    if (activeFilter === 'Needs review') return r.status === 'unreadable';
    if (activeFilter === 'Clear') return r.status === 'clear' && r.category === 'document_comparison';
    if (activeFilter === 'Spam') return r.category === 'spam';
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-800 font-sans antialiased overflow-hidden">
      
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-3 right-6 z-50 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-bounce">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Clean Top Navbar */}
      <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 z-30 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white shadow-sm">
              <Ship className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">
                  MinionShip
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                  Verification Core
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Status Indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs">
          <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
          <span className="text-slate-600 font-mono text-[11px]">LIVE SYNC</span>
          <span className="text-slate-300">|</span>
          <span className="text-emerald-700 font-mono font-semibold text-[11px]">PORT KLANG / ROTTERDAM</span>
        </div>

        {/* Search & Profile */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search booking ID, shipper, parameters..."
              className="pl-9 pr-12 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 text-xs w-72 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 transition-all"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white rounded border border-slate-200 shadow-2xs">
              ⌘K
            </kbd>
          </div>

          <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-bold font-mono shadow-xs">
              OP
            </div>
          </div>
        </div>
      </header>

      {/* Summary Metrics Bar */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-3.5 grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div 
          onClick={() => setActiveFilter('All')}
          className="bg-slate-50/70 hover:bg-slate-100 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition-all"
        >
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Today's Ingested</p>
            <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{records.length} <span className="text-xs text-slate-500 font-sans font-normal">Emails</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Layers className="w-4.5 h-4.5" />
          </div>
        </div>

        <div 
          onClick={() => setActiveFilter('Mismatches')}
          className="bg-rose-50/50 hover:bg-rose-100/50 border border-rose-200/80 rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition-all"
        >
          <div>
            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider font-mono">Discrepancies Flagged</p>
            <p className="text-xl font-extrabold text-rose-700 font-mono mt-0.5">{counts.mismatches} <span className="text-xs text-rose-600/80 font-sans font-normal">Mismatches</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-rose-100/80 text-rose-600 border border-rose-200">
            <AlertCircle className="w-4.5 h-4.5" />
          </div>
        </div>

        <div 
          onClick={() => setActiveFilter('Needs review')}
          className={`border rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition-all ${
            activeFilter === 'Needs review'
              ? 'bg-amber-100 border-amber-400 shadow-sm'
              : 'bg-amber-50/50 hover:bg-amber-100/50 border-amber-200/80'
          }`}
        >
          <div>
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider font-mono">Human Review Queue</p>
            <p className="text-xl font-extrabold text-amber-800 font-mono mt-0.5">{counts.review} <span className="text-xs text-amber-700/80 font-sans font-normal">Unreadable BL</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-100/80 text-amber-700 border border-amber-200">
            <UserCheck className="w-4.5 h-4.5" />
          </div>
        </div>

        <div 
          onClick={() => setActiveFilter('Clear')}
          className="bg-emerald-50/50 hover:bg-emerald-100/50 border border-emerald-200/80 rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition-all"
        >
          <div>
            <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono">Auto Verification Rate</p>
            <p className="text-xl font-extrabold text-emerald-800 font-mono mt-0.5">96.8% <span className="text-xs text-emerald-700/80 font-sans font-normal">Verified</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-100/80 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-4.5 h-4.5" />
          </div>
        </div>
      </div>

      {/* Main 3-Column Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Column: Runs & Batches Navigation */}
        <aside className="w-60 border-r border-slate-200 bg-[#F1F5F9]/50 p-4 flex flex-col justify-between shrink-0">
          <div>
            {/* Run New Batch Button */}
            <button 
              onClick={() => setShowUploadModal(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all mb-6"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Run New Batch Ingestion
            </button>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-500 uppercase font-mono px-1">
                  <span>BATCH HISTORY</span>
                  <Compass className="w-3.5 h-3.5 text-blue-600" />
                </div>

                <div className="mt-2.5 space-y-1.5">
                  {/* Today Active Batch */}
                  <div className="p-3 rounded-xl bg-white border border-blue-300 shadow-xs flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                        <div className="text-xs font-bold text-slate-900 font-mono">Fri, Sep 19</div>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">50 emails processed</div>
                    </div>
                    <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-mono">{counts.review + counts.mismatches} alert</span>
                  </div>

                  {/* Previous Days */}
                  <div className="p-3 rounded-xl bg-white/60 hover:bg-white border border-slate-200/60 transition-all flex items-center justify-between cursor-pointer text-slate-700">
                    <div>
                      <div className="text-xs font-semibold font-mono text-slate-800">Thu, Sep 18</div>
                      <div className="text-[11px] text-slate-500">44 emails processed</div>
                    </div>
                    <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">1 alert</span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/60 hover:bg-white border border-slate-200/60 transition-all flex items-center justify-between cursor-pointer text-slate-700">
                    <div>
                      <div className="text-xs font-semibold font-mono text-slate-800">Wed, Sep 17</div>
                      <div className="text-[11px] text-slate-500">38 emails processed</div>
                    </div>
                    <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">0 alert</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-white border border-slate-200/80 rounded-xl flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <p className="text-[10px] text-slate-500 font-mono">CRON Schedule: <span className="text-slate-800 font-semibold">Daily @ 07:00 UTC</span></p>
          </div>
        </aside>

        {/* Middle Column: Email Verification Queue */}
        <section className="w-96 border-r border-slate-200 bg-white flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-extrabold text-slate-900 tracking-wider font-mono uppercase">INBOX QUEUE</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">{records.length} items in current batch · Run completed 07:03</p>
              </div>
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-blue-600 transition-colors" />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 text-[11px]">
              {[
                { label: 'All', count: counts.all },
                { label: 'Mismatches', count: counts.mismatches, alert: true },
                { label: 'Needs review', count: counts.review, warn: true },
                { label: 'Clear', count: counts.clear, success: true },
                { label: 'Spam', count: counts.spam }
              ].map(tab => {
                const isActive = activeFilter === tab.label;
                return (
                  <button
                    key={tab.label}
                    onClick={() => setActiveFilter(tab.label)}
                    className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-slate-900 text-white font-bold shadow-xs'
                        : tab.alert
                        ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                        : tab.warn
                        ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                        : tab.success
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200/60'
                    }`}
                  >
                    {tab.label} <span className="font-mono ml-0.5 text-[10px]">({tab.count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Email Item Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredRecords.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-mono">
                No emails match current filter
              </div>
            ) : (
              filteredRecords.map(rec => {
                const isSelected = rec.id === selectedId;
                return (
                  <div 
                    key={rec.id}
                    onClick={() => setSelectedId(rec.id)}
                    className={`p-3.5 cursor-pointer transition-all border-l-4 ${
                      isSelected 
                        ? 'bg-blue-50/60 border-blue-600' 
                        : rec.status === 'mismatch'
                        ? 'border-rose-400 hover:bg-slate-50'
                        : rec.status === 'unreadable'
                        ? 'border-amber-400 hover:bg-slate-50'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          rec.status === 'mismatch' ? 'bg-rose-500' : 
                          rec.status === 'unreadable' ? 'bg-amber-500' : 
                          'bg-emerald-500'
                        }`} />
                        <span className="text-xs font-bold text-slate-900 truncate max-w-[160px]">{rec.sender}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{rec.time}</span>
                    </div>

                    <p className="text-xs text-slate-600 font-medium truncate mb-2">{rec.subject}</p>
                    
                    {/* Badges & ID */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono rounded-md">
                          {rec.id}
                        </span>
                        {rec.statusText && (
                          <span className={`px-2 py-0.5 text-[10px] rounded-md font-semibold ${
                            rec.status === 'mismatch' ? 'bg-rose-100 text-rose-800' :
                            rec.status === 'unreadable' ? 'bg-amber-100 text-amber-800' : 
                            'bg-emerald-100 text-emerald-800'
                          }`}>
                            {rec.statusText}
                          </span>
                        )}
                      </div>

                      <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isSelected ? 'text-blue-600 translate-x-0.5' : 'text-slate-400'}`} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Clean Verification Matrix / Human Review Panel */}
        <main className="flex-1 bg-[#F8FAFC] p-6 overflow-y-auto">
          {selectedRecord.status === 'unreadable' || activeFilter === 'Needs review' ? (
            /* Human Review Queue Interactive Interface */
            <HumanReviewPanel
              key={selectedRecord.id}
              record={selectedRecord}
              onSaveReview={handleSaveReview}
              onMarkSpam={handleMarkSpam}
            />
          ) : selectedRecord.category === 'document_comparison' ? (
            <div className="max-w-4xl space-y-6">
              
              {/* Header Details Card */}
              <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">
                      BOOKING REF: {selectedRecord.id}
                    </span>
                    <span className="text-xs text-slate-500">• {selectedRecord.sender}</span>
                  </div>
                  <h1 className="text-xl font-extrabold text-slate-900 mt-1.5 font-sans tracking-tight">{selectedRecord.subject}</h1>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-xl flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    Document Verification
                  </span>
                  {selectedRecord.confidence && (
                    <span className="text-[10px] font-mono text-slate-500">
                      LLM Confidence: <strong className="text-slate-800">{selectedRecord.confidence.toUpperCase()}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Status Alert Banner */}
              {selectedRecord.status === 'mismatch' && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl shadow-2xs flex items-start gap-3">
                  <div className="p-2 bg-rose-100 text-rose-600 rounded-xl shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-rose-950">Discrepancy Detected — Field Mismatch in Shipping Manifest</h4>
                    <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                      The declared <strong className="underline decoration-rose-500 decoration-2">Container Count</strong> in the Shipping Instruction (SI) does not match the Bill of Lading (BL) draft. Instant resolution or carrier confirmation required.
                    </p>
                  </div>
                </div>
              )}

              {selectedRecord.status === 'clear' && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl shadow-2xs flex items-start gap-3">
                  <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-950">100% Parameter Verification Passed</h4>
                    <p className="text-xs text-emerald-800 mt-1">All 7 critical ocean freight fields between SI and Draft BL match perfectly without discrepancy.</p>
                  </div>
                </div>
              )}

              {/* 7-Field Comparison Matrix Table */}
              {selectedRecord.fields && (
                <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
                  <div className="p-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-600" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">Parameter Comparison Matrix</h3>
                    </div>
                    <span className="text-[11px] font-mono text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                      {Object.keys(selectedRecord.fields).length} Parameters Extracted
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
                        {Object.entries(selectedRecord.fields).map(([key, item]) => (
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
                  onClick={() => alert("Mismatch report confirmed and dispatched to carrier!")}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4" />
                  Confirm Mismatch & Dispatch Alert
                </button>

                <button 
                  onClick={() => handleSendToReviewQueue(selectedRecord.id)}
                  className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                >
                  <UserCheck className="w-4 h-4 text-amber-600" />
                  Re-open in Human Review Queue
                </button>

                <button 
                  onClick={() => setShowSourceViewer(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1.5 font-semibold font-mono ml-auto py-2 px-3 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all"
                >
                  View Raw Attachments (.txt) <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Processing Trace / LLM Reasoning Panel */}
              {selectedRecord.trace && (
                <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-2xs">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 font-mono">
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                    Automated Processing & LLM Audit Trace
                  </div>
                  <ul className="space-y-2.5 text-xs text-slate-700 font-mono">
                    {selectedRecord.trace.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0" />
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          ) : (
            /* Non-comparison screen (Spam / Invoices) */
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="p-4 bg-slate-100 rounded-2xl border border-slate-200 mb-4 text-slate-500">
                <FileText className="w-10 h-10 stroke-1" />
              </div>
              <h3 className="text-base font-bold text-slate-800">Non-Manifest Triage Item</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed">
                This message was categorized as <strong className="text-blue-700 font-mono">{selectedRecord.category}</strong>. Document diff matching is skipped automatically.
              </p>
              <button
                onClick={() => handleSendToReviewQueue(selectedRecord.id)}
                className="mt-4 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
              >
                <UserCheck className="w-4 h-4 text-amber-600" />
                Edit / Re-label in Human Review Queue
              </button>
            </div>
          )}
        </main>

      </div>

      {/* File Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <button 
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-4">
              <FileUpload 
                onProcessFiles={(files) => {
                  setToastMessage(`Ingested ${files.length} documents into batch`);
                  setShowUploadModal(false);
                  setTimeout(() => setToastMessage(null), 4000);
                }} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Raw Source Document Side Drawer */}
      {showSourceViewer && selectedRecord.rawSiText && (
        <div className="fixed inset-y-0 right-0 w-112 bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-900 font-mono">Raw Attachment Documents</h3>
            </div>
            <button onClick={() => setShowSourceViewer(false)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 flex-1 overflow-y-auto space-y-5 font-mono text-xs">
            <div>
              <span className="font-sans font-bold text-[10px] text-blue-700 uppercase tracking-wider">SI Attachment Raw Text (.txt)</span>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl mt-1.5 whitespace-pre-wrap text-slate-800 text-[11px] leading-relaxed font-mono">
                {selectedRecord.rawSiText}
              </pre>
            </div>

            <div>
              <span className="font-sans font-bold text-[10px] text-blue-700 uppercase tracking-wider">BL Draft Attachment Raw Text (.txt)</span>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl mt-1.5 whitespace-pre-wrap text-slate-800 text-[11px] leading-relaxed font-mono">
                {selectedRecord.rawBlText}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};