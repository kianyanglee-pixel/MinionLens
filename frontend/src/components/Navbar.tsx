import React from 'react';
import { Ship, Search, Radio } from 'lucide-react';

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  userInitials?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  searchQuery, 
  onSearchChange, 
  userInitials = 'OP' 
}) => {
  return (
    <header className="h-16 border-b border-slate-200 bg-white grid grid-cols-3 items-center px-6 shrink-0 z-30 shadow-xs">
      {/* Left: Brand Identity */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white shadow-sm">
          <Ship className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-lg tracking-tight text-slate-900">
            MinionShip
          </span>
          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
            Verification Core
          </span>
        </div>
      </div>

      {/* Center: Search Bar with Keyboard Shortcut Badge */}
      <div className="flex justify-center">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search booking ID, shipper, parameters..."
            className="w-full pl-9 pr-12 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 transition-all font-sans"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white rounded border border-slate-200 shadow-2xs">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: Port Live Indicator & Operator Avatar */}
      <div className="flex items-center justify-end gap-3">
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs">
          <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
          <span className="text-slate-600 font-mono text-[10px]">LIVE SYNC</span>
          <span className="text-slate-300">|</span>
          <span className="text-emerald-700 font-mono font-semibold text-[10px]">PORT KLANG / ROTTERDAM</span>
        </div>

        <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-bold font-mono shadow-xs">
          {userInitials}
        </div>
      </div>
    </header>
  );
};