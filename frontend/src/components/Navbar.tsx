import React from 'react';
import { ShieldCheck, Search, Bell } from 'lucide-react';

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
    <header className="h-14 border-b border-slate-200 bg-white grid grid-cols-3 items-center px-6 shrink-0 z-10">
      {/* 1. Left: Brand Identification */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 rounded-lg">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
          </div>
          <span className="font-bold text-base tracking-tight text-slate-900">ShipCheck</span>
        </div>
        <span className="text-xs text-slate-400 font-normal pl-2 border-l border-slate-200">
          Document Verification System
        </span>
      </div>

      {/* 2. Center: Search Bar */}
      <div className="flex justify-center">
        <div className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails, parties, or ports..."
            className="w-full pl-9 pr-3.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/70 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* 3. Right: Notifications & Avatar */}
      <div className="flex items-center justify-end gap-3">
        <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-50 transition-colors">
          <Bell className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold shadow-xs">
          {userInitials}
        </div>
      </div>
    </header>
  );
};