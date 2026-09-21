import React from 'react';
import { ShieldCheck, AlertTriangle, Clock, RefreshCw, PlusCircle } from 'lucide-react';
import { RunSummary } from '../batch';

interface NavbarProps {
  run: RunSummary | null;
  onRefresh: () => void;
  onOpenUpload: () => void;
  isLoading: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ run, onRefresh, onOpenUpload, isLoading }) => {
  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between text-white shrink-0">
      {/* Left branding */}
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-blue-600 rounded-lg">
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-xs font-bold tracking-wider uppercase">SDOC BATCH VERIFICATION</div>
          <div className="text-[11px] text-slate-400 font-mono">
            Run: <span className="text-slate-300">{run?.run_id || 'No active batch'}</span>
          </div>
        </div>
      </div>

      {/* Right Stats & Actions */}
      <div className="flex items-center gap-3">
        {run && (
          <>
            <div className="bg-slate-800/90 border border-slate-700 px-3 py-1 rounded-md text-xs font-mono flex items-center gap-1.5">
              <span className="text-slate-400">Total:</span>
              <span className="font-bold text-slate-100">{run.email_count}</span>[cite: 1]
            </div>

            <div className="bg-red-950/40 border border-red-800/60 text-red-300 px-3 py-1 rounded-md text-xs font-mono flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span>Mismatches:</span>
              <span className="font-bold text-red-200">{run.mismatch_count || 0}</span>[cite: 1]
            </div>

            <div className="bg-amber-950/40 border border-amber-800/60 text-amber-300 px-3 py-1 rounded-md text-xs font-mono flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Needs Review:</span>
              <span className="font-bold text-amber-200">{run.needs_review_count || 0}</span>[cite: 1]
            </div>

            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors cursor-pointer"
              title="Refresh Queue"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </>
        )}

        {/* Primary Action Button */}
        <button
          onClick={onOpenUpload}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md shadow-sm transition-all cursor-pointer ml-1"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Run New Batch</span>
        </button>
      </div>
    </header>
  );
};