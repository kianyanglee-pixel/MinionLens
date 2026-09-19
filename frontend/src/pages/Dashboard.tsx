import React, { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { EmailQueuePanel } from '../components/EmailQueuePanel';
import { InspectionPanel } from '../components/InspectionPanel';
import { FileUpload } from '../components/FileUpload';

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
      'Extracted 7/7 fields from SI.txt and 7/7 fields from BL_draft.txt',
      'Compared values — 1 mismatch found on container count'
    ],
    rawSiText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPOL: Port Klang\nPOD: Rotterdam\nCONTAINERS: 3\nWEIGHT: 22000 KG",
    rawBlText: "SHIPPER: Meridian Exports Sdn Bhd\nCONSIGNEE: Hafal Trading Co.\nPORT OF LOADING: Port Klang\nPORT OF DISCHARGE: Rotterdam\nCONTAINERS: 4\nGROSS WEIGHT: 22000 KG"
  },
  {
    id: 'PC-9902',
    sender: 'Pacific Carrier Co.',
    subject: 'Shipping instruction attached',
    category: 'document_comparison',
    status: 'unreadable',
    statusText: 'BL unreadable',
    time: '06:54',
    trace: ['Low scan resolution on BL document', 'Sent to human review']
  },
  {
    id: 'MRD-6602',
    sender: 'Meridian Exports',
    subject: 'BL check — booking MRD-6602',
    category: 'document_comparison',
    status: 'clear',
    statusText: 'No mismatch',
    time: '06:48',
    fields: {
      shipper: { label: 'Shipper', siValue: 'Meridian Exports Sdn Bhd', blValue: 'Meridian Exports Sdn Bhd', match: true },
      consignee: { label: 'Consignee', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      notify_party: { label: 'Notify party', siValue: 'Apex Supply LLC', blValue: 'Apex Supply LLC', match: true },
      port_of_loading: { label: 'Port of loading', siValue: 'Singapore, SG', blValue: 'Singapore, SG', match: true },
      port_of_discharge: { label: 'Port of discharge', siValue: 'Hamburg, DE', blValue: 'Hamburg, DE', match: true },
      container_count: { label: 'Container count', siValue: '2', blValue: '2', match: true },
      gross_weight_kg: { label: 'Gross weight (kg)', siValue: '18,400', blValue: '18,400', match: true },
    },
    trace: ['All 7 fields extracted and verified identical']
  }
];

export const Dashboard: React.FC = () => {
  const [records, setRecords] = useState<EmailRecord[]>(INITIAL_DATA);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_DATA[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Filter and search logic
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const matchesSearch = 
        r.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.subject.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (activeFilter === 'Mismatches') return r.status === 'mismatch';
      if (activeFilter === 'Needs review') return r.status === 'unreadable';
      if (activeFilter === 'Clear') return r.status === 'clear' && r.category === 'document_comparison';
      if (activeFilter === 'Spam') return r.category === 'spam';
      return true;
    });
  }, [records, searchQuery, activeFilter]);

  const selectedRecord = records.find((r) => r.id === selectedId) || records[0];

  return (
    <div className="flex flex-col h-screen bg-[#FDFCFB] text-slate-800 antialiased overflow-hidden">
      {/* 1. Dynamic Navbar */}
      <Navbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Leftmost Drawer: Batch Navigator */}
        <aside className="w-56 border-r border-slate-200 bg-[#FAF9F8] p-4 flex flex-col justify-between shrink-0">
          <div>
            <button 
              onClick={() => setShowUploadModal(true)}
              className="w-full bg-[#1E2538] hover:bg-slate-800 text-white text-xs font-medium py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors mb-6 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Run new batch
            </button>
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Batches</span>
            <div className="mt-2 p-2.5 rounded-lg bg-white border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-800">Current Run</div>
                <div className="text-[10px] text-slate-500">{records.length} emails sorted</div>
              </div>
              <span className="text-xs font-semibold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">
                {records.filter(r => r.status === 'mismatch').length}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">Automated Pipeline v1.0</p>
        </aside>

        {/* 2. Middle Panel: Email Queue */}
        <EmailQueuePanel 
          records={filteredRecords}
          selectedId={selectedId}
          onSelectRecord={setSelectedId}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />

        {/* 3. Right Panel: Verification Details */}
        <InspectionPanel 
          record={selectedRecord}
          onOpenSourceModal={() => alert(`Raw SI:\n${selectedRecord.rawSiText}\n\nRaw BL:\n${selectedRecord.rawBlText}`)}
          onResolveDiscrepancy={(id) => alert(`Verified & submitted email ${id}[cite: 1, 7]`)}
          onEscalate={(id) => alert(`Escalated email ${id} for manual human confirmation[cite: 1, 7]`)}
        />
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden p-6">
            <FileUpload 
              onIngestBatch={(payload) => {
                alert(`Batch received from ${payload.sourceType}!`);
                setShowUploadModal(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};