import React, { useState, useMemo } from 'react';
import { 
  Plus, Layers, AlertCircle, Clock, CheckCircle2, 
  Compass, X, FileText 
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { EmailQueuePanel } from '../components/EmailQueuePanel';
import { InspectionPanel } from '../components/InspectionPanel';
import { FileUpload, BatchPayload } from '../components/FileUpload';

// Types definition
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

const INITIAL_DATA: EmailRecord[] = [
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
    statusText: 'BL unreadable',
    time: '06:54',
    confidence: 'low',
    trace: [
      'LLM Classifier: Document comparison request detected',
      'Extraction Error: BL attachment unreadable or corrupted OCR image',
      'Escalated to human review queue with priority flag'
    ]
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
  const [records, setRecords] = useState<EmailRecord[]>(INITIAL_DATA);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_DATA[0].id);
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showSourceViewer, setShowSourceViewer] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const selectedRecord = records.find(r => r.id === selectedId) || records[0];

  // Calculated Metrics
  const mismatchesCount = records.filter(r => r.status === 'mismatch').length;
  const reviewCount = records.filter(r => r.status === 'unreadable').length;

  // Filter & Search Logic
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
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
  }, [records, searchQuery, activeFilter]);

  const handleBatchIngest = (payload: BatchPayload) => {
    if (payload.sourceType === 'local') {
      alert(`Batch received: ${payload.inboxFiles?.length} email JSONs & ${payload.attachmentFiles?.length} document attachments[cite: 1]!`);
    } else {
      alert(`Connected to ${payload.cloudConfig?.provider} storage[cite: 9]!`);
    }
    setShowUploadModal(false);
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-800 font-sans antialiased overflow-hidden">
      
      {/* 1. Dynamic Modular Navbar */}
      <Navbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* 2. Top Summary Metrics Bar */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-3.5 grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Today's Ingested</p>
            <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{records.length} <span className="text-xs text-slate-500 font-sans font-normal">Emails</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Layers className="w-4.5 h-4.5" />
          </div>
        </div>

        <div className="bg-rose-50/50 border border-rose-200/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider font-mono">Discrepancies Flagged</p>
            <p className="text-xl font-extrabold text-rose-700 font-mono mt-0.5">{mismatchesCount} <span className="text-xs text-rose-600/80 font-sans font-normal">Mismatches</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-rose-100/80 text-rose-600 border border-rose-200">
            <AlertCircle className="w-4.5 h-4.5" />
          </div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider font-mono">Human Review Queue</p>
            <p className="text-xl font-extrabold text-amber-800 font-mono mt-0.5">{reviewCount} <span className="text-xs text-amber-700/80 font-sans font-normal">Unreadable BL</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-100/80 text-amber-700 border border-amber-200">
            <Clock className="w-4.5 h-4.5" />
          </div>
        </div>

        <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono">Auto Verification Rate</p>
            <p className="text-xl font-extrabold text-emerald-800 font-mono mt-0.5">96.8% <span className="text-xs text-emerald-700/80 font-sans font-normal">Verified</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-100/80 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-4.5 h-4.5" />
          </div>
        </div>
      </div>

      {/* 3. Main 3-Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Column: Batch History Navigation */}
        <aside className="w-60 border-r border-slate-200 bg-[#F1F5F9]/50 p-4 flex flex-col justify-between shrink-0">
          <div>
            <button 
              onClick={() => setShowUploadModal(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all mb-6 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Run New Batch Ingestion
            </button>

            <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-500 uppercase font-mono px-1">
              <span>BATCH HISTORY</span>
              <Compass className="w-3.5 h-3.5 text-blue-600" />
            </div>

            <div className="mt-2.5 space-y-1.5">
              <div className="p-3 rounded-xl bg-white border border-blue-300 shadow-xs flex items-center justify-between cursor-pointer">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                    <div className="text-xs font-bold text-slate-900 font-mono">Current Run</div>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{records.length} emails</div>
                </div>
                <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-mono">
                  {mismatchesCount} alert
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-white border border-slate-200/80 rounded-xl flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <p className="text-[10px] text-slate-500 font-mono">CRON: <span className="text-slate-800 font-semibold">Daily @ 07:00 UTC</span></p>
          </div>
        </aside>

        {/* Middle Column: Email Queue Panel Component */}
        <EmailQueuePanel 
          records={filteredRecords}
          selectedId={selectedId}
          onSelectRecord={setSelectedId}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />

        {/* Right Column: Inspection Matrix Component */}
        <InspectionPanel 
          record={selectedRecord}
          onOpenSourceModal={() => setShowSourceViewer(true)}
          onResolveDiscrepancy={(id) => alert(`Verified & dispatched report for ${id}[cite: 9]!`)}
          onEscalate={(id) => alert(`Escalated ${id} to human review queue[cite: 1, 9]!`)}
        />
      </div>

      {/* 4. Dual-Folder Batch Ingestion Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden p-6">
            <button 
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <FileUpload onIngestBatch={handleBatchIngest} />
          </div>
        </div>
      )}

      {/* 5. Raw Source Documents Side Drawer */}
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
              <span className="font-sans font-bold text-[10px] text-blue-700 uppercase tracking-wider">SI Attachment (.txt)</span>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded-xl mt-1.5 whitespace-pre-wrap text-slate-800 text-[11px] leading-relaxed font-mono">
                {selectedRecord.rawSiText}
              </pre>
            </div>

            <div>
              <span className="font-sans font-bold text-[10px] text-blue-700 uppercase tracking-wider">BL Draft (.txt)</span>
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