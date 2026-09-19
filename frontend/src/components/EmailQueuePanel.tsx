import React from 'react';
import { EmailRecord } from '../pages/Dashboard';

interface EmailQueuePanelProps {
  records: EmailRecord[];
  selectedId: string;
  onSelectRecord: (id: string) => void;
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

export const EmailQueuePanel: React.FC<EmailQueuePanelProps> = ({
  records,
  selectedId,
  onSelectRecord,
  activeFilter,
  onFilterChange,
}) => {
  // Dynamic badge counts
  const counts = {
    all: records.length,
    mismatches: records.filter((r) => r.status === 'mismatch').length,
    review: records.filter((r) => r.status === 'unreadable').length,
    clear: records.filter((r) => r.status === 'clear' && r.category === 'document_comparison').length,
    spam: records.filter((r) => r.category === 'spam').length,
  };

  const filterTabs = [
    { label: 'All', count: counts.all },
    { label: 'Mismatches', count: counts.mismatches },
    { label: 'Needs review', count: counts.review },
    { label: 'Clear', count: counts.clear },
    { label: 'Spam', count: counts.spam },
  ];

  return (
    <section className="w-84 border-r border-slate-200 bg-white flex flex-col shrink-0">
      {/* Header & Filter Bar */}
      <div className="p-4 border-b border-slate-100">
        <h2 className="text-xs font-bold text-slate-800">Current Queue</h2>
        <p className="text-[10px] text-slate-400 mt-0.5">{records.length} records in this batch</p>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1 text-[11px] no-scrollbar">
          {filterTabs.map((tab) => {
            const isActive = activeFilter === tab.label;
            return (
              <button
                key={tab.label}
                onClick={() => onFilterChange(tab.label)}
                className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors font-medium text-xs ${
                  isActive 
                    ? 'bg-slate-900 text-white' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label} <span className="opacity-80 font-normal">({tab.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {records.map((rec) => {
          const isSelected = rec.id === selectedId;
          return (
            <div
              key={rec.id}
              onClick={() => onSelectRecord(rec.id)}
              className={`p-3.5 cursor-pointer transition-colors ${
                isSelected ? 'bg-indigo-50/40 border-l-2 border-indigo-600' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      rec.status === 'mismatch'
                        ? 'bg-rose-500'
                        : rec.status === 'unreadable'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-xs font-semibold text-slate-800 truncate max-w-[170px]">
                    {rec.sender}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">{rec.time}</span>
              </div>

              <p className="text-[11px] text-slate-500 truncate mb-2">{rec.subject}</p>

              {/* Status and Category Chips */}
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded font-medium capitalize">
                  {rec.category.replace('_', ' ')}
                </span>
                {rec.statusText && (
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      rec.status === 'mismatch'
                        ? 'bg-rose-100 text-rose-700'
                        : rec.status === 'unreadable'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {rec.statusText}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};