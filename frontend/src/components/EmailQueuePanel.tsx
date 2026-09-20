import React from 'react';
import { SlidersHorizontal, ArrowRight } from 'lucide-react';
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
  const counts = {
    all: records.length,
    mismatches: records.filter((r) => r.status === 'mismatch').length,
    review: records.filter((r) => r.status === 'unreadable').length,
    clear: records.filter((r) => r.status === 'clear' && r.category === 'document_comparison').length,
    spam: records.filter((r) => r.category === 'spam').length,
  };

  const filterTabs = [
    { label: 'All', count: counts.all },
    { label: 'Mismatches', count: counts.mismatches, alert: true },
    { label: 'Needs review', count: counts.review, warn: true },
    { label: 'Clear', count: counts.clear, success: true },
    { label: 'Spam', count: counts.spam },
  ];

  return (
    <section className="w-96 border-r border-slate-200 bg-white flex flex-col shrink-0">
      {/* Header & Filter Bar */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-extrabold text-slate-900 tracking-wider font-mono uppercase">
              INBOX QUEUE
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 font-sans">
              {records.length} items in current batch · Run completed 07:03
            </p>
          </div>
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-blue-600 transition-colors" />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 text-[11px]">
          {filterTabs.map((tab) => {
            const isActive = activeFilter === tab.label;
            return (
              <button
                key={tab.label}
                onClick={() => onFilterChange(tab.label)}
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

      {/* Feed List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {records.map((rec) => {
          const isSelected = rec.id === selectedId;
          return (
            <div
              key={rec.id}
              onClick={() => onSelectRecord(rec.id)}
              className={`p-3.5 cursor-pointer transition-all border-l-4 ${
                isSelected
                  ? 'bg-blue-50/60 border-blue-600'
                  : rec.status === 'mismatch'
                  ? 'border-rose-400 hover:bg-slate-50'
                  : 'border-transparent hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      rec.status === 'mismatch'
                        ? 'bg-rose-500'
                        : rec.status === 'unreadable'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-xs font-bold text-slate-900 truncate max-w-[160px]">
                    {rec.sender}
                  </span>
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
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded-md font-semibold ${
                        rec.status === 'mismatch'
                          ? 'bg-rose-100 text-rose-800'
                          : rec.status === 'unreadable'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {rec.statusText}
                    </span>
                  )}
                </div>

                <ArrowRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    isSelected ? 'text-blue-600 translate-x-0.5' : 'text-slate-400'
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};