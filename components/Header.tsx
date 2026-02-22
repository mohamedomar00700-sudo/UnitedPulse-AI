
import React from 'react';

interface HeaderProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const Header: React.FC<HeaderProps> = ({ isDarkMode, toggleDarkMode }) => {
  return (
    <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b px-6 py-4 transition-all duration-300 ${isDarkMode ? 'bg-slate-950/70 border-slate-800' : 'bg-white/70 border-slate-200/60'}`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-md overflow-hidden border border-slate-100 relative">
            <img 
              src="https://drive.google.com/thumbnail?id=1zBcr8zz3WUgL4yAVCbU8fMIyLiRw5ugz&sz=w500" 
              alt="United Pharmacies Logo" 
              className="w-full h-full object-cover relative z-10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-[#009639] font-black text-xl z-0">U</div>
          </div>
          <div>
            <h1 className={`text-xl font-extrabold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              UnitedPulse <span className="text-[#009639]">AI</span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">United Pharmacies Attendance</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleDarkMode}
            className={`p-3 rounded-xl transition-all border ${isDarkMode ? 'bg-slate-900 border-slate-800 text-amber-400 hover:bg-slate-800' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'}`}
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#009639]/10 dark:bg-[#009639]/20 rounded-full border border-[#009639]/20 dark:border-[#009639]/30">
            <div className="w-2 h-2 bg-[#009639] rounded-full animate-pulse"></div>
            <span className="text-[10px] font-bold text-[#009639] dark:text-[#009639] uppercase">System Active</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
