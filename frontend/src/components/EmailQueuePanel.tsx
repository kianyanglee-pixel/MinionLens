import React, { useState } from 'react';
import { Mail, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { EmailRecord } from '../batch';

interface EmailQueuePanelProps {
  emails: EmailRecord[];
  selectedEmailId: string | null;
  onSelectEmail: (email: EmailRecord) => void;
}

export const EmailQueuePanel: React.FC<EmailQueuePanelProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'MISMATCH' | 'NEEDS_REVIEW' | 'OK'>('ALL');
  const [search, setSearch] = useState('');

  const filteredEmails = emails.filter((item) => {
    const matchesFilter = filter === 'ALL' || item.automated_status === filter;
    const matchesSearch =
      item.email_id.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="w-96 border-r border-slate-200 bg-white flex flex-col h-full shrink-0">
      {/* Search & Filter Header */}
      <div className="p-4 border-b border-slate-100 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search email ID or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {(['ALL', 'MISMATCH', 'NEEDS_REVIEW', 'OK'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-all ${
                filter === status
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Email List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filteredEmails.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">No emails match the filter</div>
        ) : (
          filteredEmails.map((email) => {
            const isSelected = email.email_id === selectedEmailId;
            return (
              <div
                key={email.email_id}
                onClick={() => onSelectEmail(email)}
                className={`p-3.5 cursor-pointer transition-colors ${
                  isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-mono font-bold text-slate-800">
                      {email.email_id}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold ${
                      email.automated_status === 'MISMATCH'
                        ? 'bg-red-100 text-red-700'
                        : email.automated_status === 'NEEDS_REVIEW'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {email.automated_status}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-medium">{email.category}</span>
                  {email.has_defect && (
                    <span className="flex items-center gap-1 text-[10px] text-red-600 font-mono">
                      <AlertCircle className="w-3 h-3" />
                      {email.defect_fields.length} defect(s)
                    </span>
                  )}
                </div>

                {email.defect_fields && email.defect_fields.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {email.defect_fields.map((field) => (
                      <span
                        key={field}
                        className="text-[9px] font-mono bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.2 rounded"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};