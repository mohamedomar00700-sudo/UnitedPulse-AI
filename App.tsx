
import React, { useState, useMemo, useEffect } from 'react';
import Header from './components/Header';
import { extractNamesFromExcel } from './services/excelService';
import { processAttendance, extractNamesFromImage } from './services/geminiService';
import { ProcessingResult, AttendanceStatus, MatchSensitivity, Attendee } from './types';
import * as XLSX from 'xlsx';

const App: React.FC = () => {
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' || 
           (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  // Input Selection
  const [sourceMode, setSourceMode] = useState<'excel' | 'image'>('excel');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [officialImage, setOfficialImage] = useState<File | null>(null);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  
  // Settings
  const [sensitivity, setSensitivity] = useState<MatchSensitivity>(MatchSensitivity.BALANCED);
  
  // Processing
  const [loading, setLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Results Flow
  const [reviewResults, setReviewResults] = useState<ProcessingResult | null>(null);
  const [finalResults, setFinalResults] = useState<ProcessingResult | null>(null);
  
  // Selection & Bulk Editing
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  
  // View Controls
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [activeFilter, setActiveFilter] = useState<'ALL' | AttendanceStatus>('ALL');

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const resetApp = () => {
    const msg = "تنبيه: سيتم مسح جميع النتائج الحالية والعودة للبداية. هل أنت متأكد؟";
    if (window.confirm(msg)) {
      setExcelFile(null);
      setOfficialImage(null);
      setScreenshots([]);
      setReviewResults(null);
      setFinalResults(null);
      setLoading(false);
      setProgressLog([]);
      setError(null);
      setSearchTerm('');
      setSelectedNames(new Set());
      setActiveFilter('ALL');
    }
  };

  const handlePrint = () => {
    // Ensuring the view is correct for printing
    window.print();
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  const runAnalysis = async () => {
    const hasSource = sourceMode === 'excel' ? !!excelFile : !!officialImage;
    if (!hasSource || screenshots.length === 0) {
      setError("يرجى اختيار ملف الكشف الرسمي ولقطة زووم واحدة على الأقل.");
      return;
    }

    setLoading(true);
    setError(null);
    setProgressLog([]);
    try {
      let officialNames: string[] = [];
      if (sourceMode === 'excel' && excelFile) {
        setProgressLog(["جاري قراءة ملف الإكسيل..."]);
        officialNames = await extractNamesFromExcel(excelFile);
      } else if (sourceMode === 'image' && officialImage) {
        setProgressLog(["جاري تحليل صورة الكشف..."]);
        const b64 = await fileToBase64(officialImage);
        officialNames = await extractNamesFromImage(b64, true);
      }

      const zoomImagesB64 = await Promise.all(screenshots.map(fileToBase64));
      const res = await processAttendance(officialNames, zoomImagesB64, sensitivity, (msg) => {
        setProgressLog(prev => [...prev, msg]);
      });

      setReviewResults(res);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء المعالجة.");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (name: string) => {
    const next = new Set(selectedNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedNames(next);
  };

  const applyBulkStatus = (status: AttendanceStatus) => {
    if (!finalResults) return;
    
    let statusName = status === AttendanceStatus.PRESENT ? "حاضر" : status === AttendanceStatus.ABSENT ? "غائب" : "خارج الكشف";
    if (!window.confirm(`هل تريد تغيير حالة ${selectedNames.size} أسماء إلى "${statusName}"؟`)) return;

    const all = [...finalResults.present, ...finalResults.absent, ...finalResults.unexpected];
    const nextResults: ProcessingResult = { present: [], absent: [], unexpected: [] };
    
    all.forEach(item => {
      const newItem = selectedNames.has(item.name) ? { ...item, status } : item;
      if (newItem.status === AttendanceStatus.PRESENT) nextResults.present.push(newItem);
      else if (newItem.status === AttendanceStatus.ABSENT) nextResults.absent.push(newItem);
      else nextResults.unexpected.push(newItem);
    });

    setFinalResults(nextResults);
    setSelectedNames(new Set());
  };

  const finalizeReview = () => {
    setFinalResults(reviewResults);
    setReviewResults(null);
  };

  const unmatchAttendee = (name: string) => {
    if (!reviewResults) return;
    const attendee = reviewResults.present.find(p => p.name === name);
    if (!attendee) return;

    setReviewResults({
      ...reviewResults,
      present: reviewResults.present.filter(p => p.name !== name),
      absent: [...reviewResults.absent, { name: attendee.name, status: AttendanceStatus.ABSENT }],
      unexpected: [...reviewResults.unexpected, { name: attendee.originalName || "Unknown", status: AttendanceStatus.UNEXPECTED }]
    });
  };

  const filteredData = useMemo(() => {
    if (!finalResults) return null;
    const term = searchTerm.toLowerCase();
    const filterAndSort = (list: Attendee[]) => {
      return list
        .filter(a => a.name.toLowerCase().includes(term) || a.originalName?.toLowerCase().includes(term))
        .sort((a, b) => {
          const res = a.name.localeCompare(b.name, 'ar');
          return sortOrder === 'asc' ? res : -res;
        });
    };
    return {
      present: filterAndSort(finalResults.present),
      absent: filterAndSort(finalResults.absent),
      unexpected: filterAndSort(finalResults.unexpected)
    };
  }, [finalResults, searchTerm, sortOrder]);

  const exportData = (format: 'xlsx' | 'csv') => {
    if (!finalResults) return;
    const data = [
      ["الاسم الرسمي", "الحالة", "الاسم في زووم"],
      ...finalResults.present.map(p => [p.name, "حاضر", p.originalName || ""]),
      ...finalResults.absent.map(a => [a.name, "غائب", ""]),
      ...finalResults.unexpected.map(u => [u.name, "خارج الكشف", ""])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    if (format === 'xlsx') XLSX.writeFile(wb, "UnitedPulse_Attendance_Report.xlsx");
    else {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "UnitedPulse_Attendance_Report.csv";
      link.click();
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#fcfdfe] text-slate-900'}`}>
      <div className="no-print">
        <Header isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} />
      </div>
      
      <main className="flex-1 max-w-6xl mx-auto w-full p-6 space-y-8">
        {/* ترويسة التقرير للطباعة فقط */}
        <div className="print-only text-center border-b-2 border-slate-900 pb-6 mb-8">
           <h1 className="text-3xl font-black">UnitedPulse AI - تقرير الحضور</h1>
           <p className="text-lg mt-2">صيدليات المتحدة - نظام التحليل الذكي</p>
           <div className="mt-4 text-sm font-bold">تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</div>
        </div>

        {!reviewResults && !finalResults ? (
          <div className="space-y-8 animate-in fade-in duration-700 no-print">
            <div className="text-center space-y-4 pt-10">
              <h2 className={`text-4xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>UnitedPulse AI</h2>
              <p className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>الجيل الذكي لتحليل حضور محاضرات السوفت سكيلز</p>
            </div>

            {/* Match Sensitivity Card */}
            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} shadow-sm space-y-4`}>
              <h3 className={`text-sm font-black uppercase tracking-widest text-center ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>حساسية مطابقة الأسماء</h3>
              <div className={`flex flex-col md:flex-row gap-2 p-1 rounded-2xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                {[
                  { id: MatchSensitivity.STRICT, label: "تدقيق عالٍ", desc: "مطابقة حرفية صارمة" },
                  { id: MatchSensitivity.BALANCED, label: "متوازن", desc: "تجاوز الأخطاء البسيطة" },
                  { id: MatchSensitivity.FLEXIBLE, label: "مرن", desc: "مطابقة ذكية للأسماء المختصرة" }
                ].map((item) => (
                  <button key={item.id} onClick={() => setSensitivity(item.id)} className={`flex-1 p-3 rounded-xl transition-all text-center ${sensitivity === item.id ? 'bg-[#009639] text-white shadow-lg' : isDarkMode ? 'text-slate-100 hover:bg-slate-700' : 'text-slate-700 hover:bg-slate-200'}`}>
                    <div className="font-bold">{item.label}</div>
                    <div className={`text-[10px] ${sensitivity === item.id ? 'text-white/80' : isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className={`p-8 rounded-[2.5rem] border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} shadow-sm space-y-6`}>
                <div className="flex justify-between items-center">
                  <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>1. الكشف الرسمي</h3>
                  <div className={`flex p-1 rounded-xl text-xs ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    <button onClick={()=>setSourceMode('excel')} className={`px-3 py-1 rounded-lg transition-colors ${sourceMode==='excel'?'bg-[#009639] text-white':'text-slate-600 hover:text-[#009639]'}`}>Excel</button>
                    <button onClick={()=>setSourceMode('image')} className={`px-3 py-1 rounded-lg transition-colors ${sourceMode==='image'?'bg-[#009639] text-white':'text-slate-600 hover:text-[#009639]'}`}>صورة</button>
                  </div>
                </div>
                <label className={`block border-2 border-dashed p-10 rounded-3xl text-center cursor-pointer transition-all ${isDarkMode ? 'border-slate-800 hover:border-united-green' : 'border-slate-300 hover:border-united-green'}`}>
                  <input type="file" className="hidden" onChange={(e) => sourceMode === 'excel' ? setExcelFile(e.target.files?.[0] || null) : setOfficialImage(e.target.files?.[0] || null)} accept={sourceMode === 'excel' ? ".xlsx,.xls" : "image/*"} />
                  <div className="space-y-2">
                    <div className="text-3xl">📄</div>
                    <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>ارفع الكشف هنا</div>
                    {(excelFile || officialImage) && <div className="text-xs text-united-green font-black mt-2">✓ تم اختيار: {sourceMode === 'excel' ? excelFile?.name : officialImage?.name}</div>}
                  </div>
                </label>
              </div>

              <div className={`p-8 rounded-[2.5rem] border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} shadow-sm space-y-6`}>
                <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>2. لقطات زووم</h3>
                <label className={`block border-2 border-dashed p-10 rounded-3xl text-center cursor-pointer transition-all ${isDarkMode ? 'border-slate-800 hover:border-united-blue' : 'border-slate-300 hover:border-united-blue'}`}>
                  <input type="file" multiple className="hidden" onChange={(e) => setScreenshots(Array.from(e.target.files || []))} accept="image/*" />
                  <div className="space-y-2">
                    <div className="text-3xl">📷</div>
                    <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>ارفع صور الحضور</div>
                    {screenshots.length > 0 && <div className="text-xs text-united-blue font-black mt-2">✓ تم اختيار {screenshots.length} صور</div>}
                  </div>
                </label>
              </div>
            </div>

            {error && <div className="p-4 bg-rose-500/10 text-rose-500 rounded-2xl text-center font-bold border border-rose-500/20">{error}</div>}

            <button onClick={runAnalysis} disabled={loading} className="w-full py-6 bg-[#009639] hover:bg-[#008532] text-white rounded-[2rem] font-black text-xl shadow-xl transition-all active:scale-95 disabled:opacity-50">
              {loading ? "جاري التحليل الذكي..." : "بدء التحليل والمطابقة"}
            </button>

            {loading && (
              <div className={`p-6 rounded-3xl font-mono text-xs space-y-1 max-h-40 overflow-auto border ${isDarkMode ? 'bg-slate-900 text-[#009639] border-[#009639]/20' : 'bg-slate-900 text-[#009639] border-[#009639]/20'}`}>
                {progressLog.map((log, i) => <div key={i}>➜ {log}</div>)}
              </div>
            )}
          </div>
        ) : reviewResults ? (
          <div className="space-y-8 animate-in slide-in-from-right duration-700 no-print">
             <div className="text-center space-y-4">
                <h2 className={`text-3xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>مراجعة مطابقات الذكاء الاصطناعي</h2>
                <p className={`${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>يرجى التأكد من دقة المطابقات قبل إصدار التقرير النهائي</p>
             </div>
             <div className={`rounded-[2rem] border overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} shadow-xl`}>
                <table className="w-full text-right border-collapse">
                   <thead className={`${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                      <tr><th className={`p-4 font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>الاسم الرسمي</th><th className={`p-4 font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>المطابقة في زووم</th><th className={`p-4 font-black text-center ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>إجراء</th></tr>
                   </thead>
                   <tbody className={`divide-y ${isDarkMode ? 'divide-slate-800' : 'divide-slate-100'}`}>
                      {reviewResults.present.map((p, i) => (
                        <tr key={i} className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                           <td className={`p-4 font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{p.name}</td>
                           <td className="p-4 text-[#009639] font-medium">✨ {p.originalName}</td>
                           <td className="p-4 text-center"><button onClick={() => unmatchAttendee(p.name)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 px-4 py-1 rounded-lg font-bold">فصل</button></td>
                        </tr>
                      ))}
                      {reviewResults.present.length === 0 && (<tr><td colSpan={3} className="p-10 text-center opacity-60 font-bold">لا توجد مطابقات للمراجعة</td></tr>)}
                   </tbody>
                </table>
             </div>
             <div className="flex gap-4">
                <button onClick={finalizeReview} className="flex-1 py-5 bg-[#009639] text-white rounded-2xl font-black shadow-xl">اعتماد وإصدار التقرير</button>
                <button onClick={() => setReviewResults(null)} className={`px-10 py-5 rounded-2xl font-bold ${isDarkMode ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-800'}`}>إلغاء</button>
             </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in slide-in-from-bottom-10 duration-700 relative">
            <div className={`p-6 rounded-3xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} shadow-sm flex flex-col md:flex-row gap-4 items-center no-print`}>
              <div className="relative flex-1 w-full">
                <input type="text" placeholder="ابحث بالاسم..." className={`w-full p-4 pr-12 rounded-2xl border outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 focus:border-united-green text-white' : 'bg-slate-50 border-slate-100 focus:border-united-green text-slate-900'}`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30">🔍</span>
              </div>
              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} className={`px-4 py-4 rounded-2xl border font-bold transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-800 hover:bg-slate-200'}`}>{sortOrder === 'asc' ? 'أ-ي' : 'ي-أ'}</button>
                <div className={`flex p-1 rounded-2xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                   <button onClick={() => exportData('xlsx')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${isDarkMode ? 'text-slate-200 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>XLSX</button>
                   <button onClick={() => exportData('csv')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${isDarkMode ? 'text-slate-200 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>CSV</button>
                   <button onClick={handlePrint} className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${isDarkMode ? 'text-slate-200 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>PDF</button>
                </div>
                <button onClick={resetApp} className="px-6 py-4 bg-rose-600 text-white rounded-2xl font-black shadow-lg hover:bg-rose-700">مسح الكل</button>
              </div>
            </div>

            <div className="flex justify-center gap-2 no-print">
               <button onClick={() => setActiveFilter('ALL')} className={`px-6 py-2 rounded-full font-bold transition-all ${activeFilter === 'ALL' ? 'bg-slate-800 text-white shadow-md' : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>الكل</button>
               <button onClick={() => setActiveFilter(AttendanceStatus.PRESENT)} className={`px-6 py-2 rounded-full font-bold transition-all ${activeFilter === AttendanceStatus.PRESENT ? 'bg-[#009639] text-white shadow-md' : 'bg-[#009639]/10 dark:bg-[#009639]/20 text-[#009639] dark:text-[#009639]'}`}>حاضر</button>
               <button onClick={() => setActiveFilter(AttendanceStatus.ABSENT)} className={`px-6 py-2 rounded-full font-bold transition-all ${activeFilter === AttendanceStatus.ABSENT ? 'bg-rose-600 text-white shadow-md' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'}`}>غائب</button>
               <button onClick={() => setActiveFilter(AttendanceStatus.UNEXPECTED)} className={`px-6 py-2 rounded-full font-bold transition-all ${activeFilter === AttendanceStatus.UNEXPECTED ? 'bg-amber-600 text-white shadow-md' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>خارج الكشف</button>
            </div>

            {selectedNames.size > 0 && (
              <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-20 no-print">
                <div className="font-bold">{selectedNames.size} مختار</div>
                <div className="flex gap-2">
                  <button onClick={() => applyBulkStatus(AttendanceStatus.PRESENT)} className="px-4 py-2 bg-[#009639] rounded-xl font-black text-xs hover:bg-[#008532]">حاضر</button>
                  <button onClick={() => applyBulkStatus(AttendanceStatus.ABSENT)} className="px-4 py-2 bg-rose-600 rounded-xl font-black text-xs hover:bg-rose-700">غائب</button>
                  <button onClick={() => applyBulkStatus(AttendanceStatus.UNEXPECTED)} className="px-4 py-2 bg-amber-600 rounded-xl font-black text-xs hover:bg-amber-700">خارج الكشف</button>
                </div>
                <button onClick={() => setSelectedNames(new Set())} className="opacity-50 hover:opacity-100">✕</button>
              </div>
            )}

            <div className={`grid gap-6 ${activeFilter === 'ALL' ? 'md:grid-cols-3' : 'grid-cols-1 max-w-2xl mx-auto'}`}>
              {[
                { id: AttendanceStatus.PRESENT, title: "حاضر", color: "bg-[#009639]", list: filteredData?.present },
                { id: AttendanceStatus.ABSENT, title: "غائب", color: "bg-rose-500", list: filteredData?.absent },
                { id: AttendanceStatus.UNEXPECTED, title: "خارج الكشف", color: "bg-amber-500", list: filteredData?.unexpected }
              ].filter(col => activeFilter === 'ALL' || activeFilter === col.id).map((col, idx) => (
                <div key={idx} className="space-y-4 animate-in fade-in zoom-in duration-300">
                  <div className={`${col.color} p-4 rounded-2xl text-white font-black text-center shadow-lg relative`}>
                    {col.title} ({col.list?.length})
                    {activeFilter !== 'ALL' && (<button onClick={() => setActiveFilter('ALL')} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-xs no-print">عودة</button>)}
                  </div>
                  <div className={`space-y-2 pr-2 ${activeFilter === 'ALL' ? 'max-h-[600px] overflow-y-auto' : ''}`}>
                    {col.list?.map((item, i) => (
                      <div key={i} className={`group p-4 rounded-2xl border shadow-sm transition-all flex items-center gap-3 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'} ${selectedNames.has(item.name) ? 'ring-2 ring-[#009639] border-[#009639]' : ''}`}>
                        <input type="checkbox" className={`w-5 h-5 rounded-md no-print ${isDarkMode ? 'accent-[#009639] bg-slate-800' : ''}`} checked={selectedNames.has(item.name)} onChange={() => toggleSelection(item.name)} />
                        <div className="flex-1">
                          <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.name}</div>
                          {item.originalName && <div className={`text-[10px] italic mt-1 ${isDarkMode ? 'text-slate-400 font-medium' : 'text-slate-500'}`}>مطابق لـ: {item.originalName}</div>}
                        </div>
                      </div>
                    ))}
                    {col.list?.length === 0 && <div className={`p-10 text-center italic ${isDarkMode ? 'text-slate-600' : 'opacity-30'}`}>لا يوجد أسماء</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
