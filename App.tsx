
import React, { useState, useMemo, useCallback } from 'react';
import Header from './components/Header';
import { extractNamesFromExcel } from './services/excelService';
import { processAttendance, extractNamesFromImage } from './services/geminiService';
import { ProcessingResult, AttendanceStatus, MatchSensitivity, Attendee } from './types';
import * as XLSX from 'xlsx';

const App: React.FC = () => {
  // الحالات الأساسية
  const [sourceMode, setSourceMode] = useState<'excel' | 'image'>('excel');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [officialImage, setOfficialImage] = useState<File | null>(null);
  const [excelNamesCount, setExcelNamesCount] = useState<number>(0);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  
  // حالات المعالجة
  const [loading, setLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [sensitivity, setSensitivity] = useState<MatchSensitivity>(MatchSensitivity.BALANCED);
  const [error, setError] = useState<string | null>(null);
  
  // حالات النتائج
  const [rawResults, setRawResults] = useState<ProcessingResult | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [finalResults, setFinalResults] = useState<ProcessingResult | null>(null);
  
  // حالات التفاعل
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<AttendanceStatus | null>(null);

  // وظيفة إعادة تعيين النظام بالكامل لمنع الكراش
  const resetApp = useCallback(() => {
    setLoading(false);
    setIsReviewing(false);
    setRawResults(null);
    setFinalResults(null);
    setExcelFile(null);
    setOfficialImage(null);
    setExcelNamesCount(0);
    setScreenshots([]);
    setProgressLog([]);
    setError(null);
    setSearchTerm('');
    setSelectedNames(new Set());
    setSourceMode('excel');
    setShowBulkConfirm(false);
    setPendingStatus(null);
  }, []);

  const getStatusLabel = (status: AttendanceStatus | null) => {
    if (!status) return "غير محدد";
    switch (status) {
      case AttendanceStatus.PRESENT: return "حاضر";
      case AttendanceStatus.ABSENT: return "غائب";
      case AttendanceStatus.UNEXPECTED: return "خارج الكشف";
      default: return "غير محدد";
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = e => reject(e);
    });
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setExcelFile(file);
      setOfficialImage(null);
      setError(null);
      try {
        const names = await extractNamesFromExcel(file);
        setExcelNamesCount(names.length);
      } catch (err) {
        setError("خطأ في قراءة ملف الإكسيل، يرجى التأكد من الصيغة.");
      }
    }
  };

  const handleOfficialImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setOfficialImage(e.target.files[0]);
      setExcelFile(null);
      setError(null);
    }
  };

  const handleScreenshotsUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setScreenshots(prev => [...prev, ...Array.from(e.target.files!)]);
      setError(null);
    }
  };

  const runAnalysis = async () => {
    const hasSource = sourceMode === 'excel' ? !!excelFile : !!officialImage;
    if (!hasSource || screenshots.length === 0) {
      setError("يرجى التأكد من رفع كشف الأسماء (إكسيل أو صورة) ولقطات زووم أولاً.");
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
        setProgressLog(["جاري استخراج الأسماء من صورة الكشف الرسمي..."]);
        const b64 = await fileToBase64(officialImage);
        officialNames = await extractNamesFromImage(b64, true);
        setProgressLog([`تم استخراج ${officialNames.length} اسم من الصورة بنجاح.`]);
      }

      if (!officialNames || officialNames.length === 0) {
        throw new Error("لم يتم العثور على أي أسماء في المصدر المرفوع. تأكد من جودة الصورة أو محتوى الملف.");
      }

      const zoomImagesB64 = await Promise.all(screenshots.map(fileToBase64));
      
      const res = await processAttendance(officialNames, zoomImagesB64, sensitivity, (msg) => {
        setProgressLog(prev => [...prev, msg]);
      });

      const sortFn = (list: Attendee[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      
      setRawResults({
        present: sortFn(res.present),
        absent: sortFn(res.absent),
        unexpected: sortFn(res.unexpected),
      });
      setIsReviewing(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "حدث خطأ غير متوقع أثناء معالجة البيانات، يرجى المحاولة لاحقاً.");
    } finally {
      setLoading(false);
    }
  };

  const rejectMatch = (index: number) => {
    if (!rawResults) return;
    const match = rawResults.present[index];
    const newPresent = rawResults.present.filter((_, i) => i !== index);
    const sortFn = (list: Attendee[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    setRawResults({
      ...rawResults,
      present: newPresent,
      absent: sortFn([...rawResults.absent, { name: match.name, status: AttendanceStatus.ABSENT }]),
      unexpected: sortFn([...rawResults.unexpected, { name: match.originalName || "", status: AttendanceStatus.UNEXPECTED }])
    });
  };

  const finalizeReport = () => {
    if (!rawResults) return;
    setFinalResults(rawResults);
    setIsReviewing(false);
  };

  const filteredDisplay = useMemo(() => {
    if (!finalResults) return null;
    const term = searchTerm.toLowerCase();
    const filterFn = (a: Attendee) => 
      a.name.toLowerCase().includes(term) || 
      (a.originalName?.toLowerCase().includes(term));
      
    return {
      present: finalResults.present.filter(filterFn),
      absent: finalResults.absent.filter(filterFn),
      unexpected: finalResults.unexpected.filter(filterFn)
    };
  }, [finalResults, searchTerm]);

  const toggleSelection = (name: string) => {
    const next = new Set(selectedNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedNames(next);
  };

  const initiateBulkChange = (status: AttendanceStatus) => {
    setPendingStatus(status);
    setShowBulkConfirm(true);
  };

  const handleBulkStatusChange = () => {
    if (!finalResults || !pendingStatus) return;
    
    const all = [...finalResults.present, ...finalResults.absent, ...finalResults.unexpected];
    const moved = all.filter(a => selectedNames.has(a.name));
    const remaining = all.filter(a => !selectedNames.has(a.name));

    const nextResults: ProcessingResult = { present: [], absent: [], unexpected: [] };
    const sortFn = (list: Attendee[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    [...remaining, ...moved.map(m => ({ ...m, status: pendingStatus }))].forEach(a => {
      if (a.status === AttendanceStatus.PRESENT) nextResults.present.push(a);
      else if (a.status === AttendanceStatus.ABSENT) nextResults.absent.push(a);
      else nextResults.unexpected.push(a);
    });

    setFinalResults({
      present: sortFn(nextResults.present),
      absent: sortFn(nextResults.absent),
      unexpected: sortFn(nextResults.unexpected)
    });
    setSelectedNames(new Set());
    setShowBulkConfirm(false);
    setPendingStatus(null);
  };

  const exportExcel = () => {
    if (!finalResults) return;
    const data = [
      ["الاسم", "الحالة", "الاسم الأصلي في زووم"],
      ...finalResults.present.map(p => [p.name, "حاضر", p.originalName || ""]),
      ...finalResults.absent.map(a => [a.name, "غائب", ""]),
      ...finalResults.unexpected.map(u => [u.name, "خارج الكشف", ""])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
    XLSX.writeFile(wb, `United_Attendance_${new Date().toLocaleDateString()}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfdfe] text-slate-900 pb-24 relative">
      <div className="no-print">
        <Header />
      </div>
      
      <main className="flex-1 max-w-6xl mx-auto w-full p-6 space-y-12">
        {!rawResults && !finalResults ? (
          <div className="space-y-12 py-10 no-print animate-in fade-in slide-in-from-bottom-10 duration-700">
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-black tracking-tight text-slate-800">تحليل الحضور والغياب الذكي</h2>
              <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
                سواء كان كشفك ملف إكسيل أو صورة فوتوغرافية، ذكاؤنا الاصطناعي سيتولى المهمة بدقة.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-10">
              {/* اختيار مصدر البيانات */}
              <div className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm space-y-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold">1. كشف الأسماء الرسمي</h3>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                      onClick={() => setSourceMode('excel')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${sourceMode === 'excel' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}
                    >إكسيل</button>
                    <button 
                      onClick={() => setSourceMode('image')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${sourceMode === 'image' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}
                    >صورة</button>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-emerald-500/10 rounded-3xl blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
                  <label className="relative block border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50/50 p-10 rounded-3xl cursor-pointer text-center transition-all">
                    <input 
                      type="file" 
                      accept={sourceMode === 'excel' ? ".xlsx,.xls" : "image/*"} 
                      onChange={sourceMode === 'excel' ? handleExcelUpload : handleOfficialImageUpload}
                      className="hidden" 
                    />
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-emerald-600">
                        {sourceMode === 'excel' ? (
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        ) : (
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        )}
                      </div>
                      <div>
                        <div className="font-black text-slate-700">{sourceMode === 'excel' ? "اختر ملف إكسيل" : "ارفع صورة الكشف"}</div>
                        <div className="text-xs text-slate-400 mt-1">{sourceMode === 'excel' ? "سيتم البحث عن الأسماء تلقائياً" : "تأكد من وضوح الأسماء في الصورة"}</div>
                      </div>
                      {(excelFile || officialImage) && (
                        <div className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold animate-in fade-in zoom-in">
                          {sourceMode === 'excel' ? excelFile?.name : officialImage?.name}
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              {/* صور زووم */}
              <div className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm space-y-8">
                <h3 className="text-2xl font-bold">2. لقطات حضور زووم</h3>
                <label className="relative block border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 p-10 rounded-3xl cursor-pointer text-center transition-all group">
                  <input type="file" multiple accept="image/*" onChange={handleScreenshotsUpload} className="hidden" />
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </div>
                    <div>
                      <div className="font-black text-slate-700">ارفع صور المشاركين</div>
                      <div className="text-xs text-slate-400 mt-1">يمكنك رفع عدة لقطات شاشة معاً</div>
                    </div>
                    {screenshots.length > 0 && (
                      <div className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold animate-in fade-in">
                        تم اختيار {screenshots.length} صور
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-6 rounded-[2rem] text-center font-bold animate-in zoom-in shadow-sm">
                {error}
              </div>
            )}

            <button
              onClick={runAnalysis}
              disabled={loading}
              className={`group relative w-full py-6 rounded-[2rem] font-black text-white text-xl transition-all shadow-2xl overflow-hidden ${
                loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>جاري التحليل الذكي...</span>
                </div>
              ) : "بدء مطابقة الحضور الآن"}
            </button>

            {loading && (
              <div className="bg-slate-900/95 backdrop-blur-xl text-emerald-400 p-8 rounded-[2rem] font-mono text-xs max-h-56 overflow-y-auto space-y-2 shadow-2xl border border-slate-800 animate-in fade-in duration-500">
                {progressLog.map((log, i) => <div key={i} className="flex gap-3"><span className="font-bold">➜</span> {log}</div>)}
              </div>
            )}
          </div>
        ) : isReviewing && rawResults ? (
          <div className="space-y-8 animate-in slide-in-from-right duration-700">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center md:items-end justify-between gap-4">
              <div className="space-y-2 text-center md:text-right">
                <h2 className="text-4xl font-black text-slate-800">مراجعة المطابقات</h2>
                <p className="text-slate-400 font-medium">راجع الأسماء التي تم التعرف عليها وتأكد من دقتها</p>
              </div>
              <button onClick={finalizeReport} className="w-full md:w-auto px-10 py-5 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-700 shadow-xl transition-all">اعتماد التقرير</button>
            </div>
            <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-slate-50 text-slate-500 text-xs font-black uppercase tracking-widest border-b border-slate-100">
                    <tr>
                      <th className="p-6">الاسم الرسمي</th>
                      <th className="p-6">الاسم في زووم</th>
                      <th className="p-6 text-center">تعديل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rawResults.present.map((p, i) => (
                      <tr key={i} className="hover:bg-emerald-50/40 transition-colors">
                        <td className="p-6 font-extrabold text-slate-800 text-lg">{p.name}</td>
                        <td className="p-6 text-emerald-700 font-medium">{p.originalName}</td>
                        <td className="p-6 text-center">
                          <button onClick={() => rejectMatch(i)} className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : finalResults && filteredDisplay ? (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div className="grid md:grid-cols-4 gap-6 no-print">
              <div className="md:col-span-2 bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between">
                <div className="space-y-2">
                  <h2 className="text-4xl font-black text-slate-800">التقرير النهائي</h2>
                  <p className="text-slate-400 font-medium">تمت معالجة الحضور بنجاح واستخراج النتائج.</p>
                </div>
                <div className="flex gap-3 mt-8">
                   <button onClick={exportExcel} className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-700 shadow-lg transition-all">Excel</button>
                   <button onClick={() => window.print()} className="flex-1 py-4 bg-white border border-slate-200 text-slate-700 rounded-2xl font-black hover:bg-slate-50 transition-all">طباعة</button>
                </div>
              </div>
              <div className="bg-emerald-600 p-8 rounded-[2.5rem] shadow-xl text-white space-y-2">
                <span className="text-[10px] font-black uppercase opacity-60">حاضرون</span>
                <div className="text-6xl font-black">{filteredDisplay.present.length}</div>
              </div>
              <div className="bg-rose-500 p-8 rounded-[2.5rem] shadow-xl text-white space-y-2">
                <span className="text-[10px] font-black uppercase opacity-60">غائبون</span>
                <div className="text-6xl font-black">{filteredDisplay.absent.length}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 min-h-[600px]">
               {/* الحاضرون */}
               <div className="flex flex-col space-y-4">
                  <div className="bg-emerald-600 p-5 rounded-3xl text-white font-black text-center shadow-lg">الحاضرون</div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-[2rem] p-4 space-y-2 overflow-y-auto max-h-[500px]">
                    {filteredDisplay.present.map((p, i) => (
                      <div key={i} className={`p-4 rounded-2xl border transition-all flex items-center gap-4 ${selectedNames.has(p.name) ? 'bg-emerald-50 border-emerald-500 shadow-md' : 'bg-slate-50/50 border-slate-100'}`}>
                        <input type="checkbox" className="no-print w-5 h-5 rounded-lg text-emerald-600" checked={selectedNames.has(p.name)} onChange={() => toggleSelection(p.name)} />
                        <div className="font-black text-slate-800">{p.name}</div>
                      </div>
                    ))}
                  </div>
               </div>

               {/* الغائبون */}
               <div className="flex flex-col space-y-4">
                  <div className="bg-rose-500 p-5 rounded-3xl text-white font-black text-center shadow-lg">الغائبون</div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-[2rem] p-4 space-y-2 overflow-y-auto max-h-[500px]">
                    {filteredDisplay.absent.map((a, i) => (
                      <div key={i} className={`p-4 rounded-2xl border transition-all flex items-center gap-4 ${selectedNames.has(a.name) ? 'bg-rose-50 border-rose-500 shadow-md' : 'bg-white border-slate-100'}`}>
                        <input type="checkbox" className="no-print w-5 h-5 rounded-lg text-rose-600" checked={selectedNames.has(a.name)} onChange={() => toggleSelection(a.name)} />
                        <div className="font-bold text-slate-700">{a.name}</div>
                      </div>
                    ))}
                  </div>
               </div>

               {/* خارج الكشف */}
               <div className="flex flex-col space-y-4">
                  <div className="bg-amber-500 p-5 rounded-3xl text-white font-black text-center shadow-lg">خارج الكشف</div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-[2rem] p-4 space-y-2 overflow-y-auto max-h-[500px]">
                    {filteredDisplay.unexpected.map((u, i) => (
                      <div key={i} className={`p-4 rounded-2xl border transition-all flex items-center gap-4 ${selectedNames.has(u.name) ? 'bg-amber-50 border-amber-500 shadow-md' : 'bg-slate-50/50 border-slate-100'}`}>
                        <input type="checkbox" className="no-print w-5 h-5 rounded-lg text-amber-600" checked={selectedNames.has(u.name)} onChange={() => toggleSelection(u.name)} />
                        <div className="font-bold text-slate-600">{u.name}</div>
                      </div>
                    ))}
                  </div>
               </div>
            </div>

            {/* شريط الإجراءات الجماعية */}
            {selectedNames.size > 0 && (
              <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 no-print animate-in slide-in-from-bottom-20 duration-500">
                <div className="bg-slate-900/90 backdrop-blur-2xl text-white px-10 py-6 rounded-[2.5rem] shadow-2xl border border-slate-800 flex items-center gap-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-500 text-slate-900 rounded-2xl flex items-center justify-center font-black text-xl">{selectedNames.size}</div>
                    <span className="font-bold text-lg">مختار</span>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => initiateBulkChange(AttendanceStatus.PRESENT)} className="px-8 py-3 bg-emerald-600 rounded-xl font-black">حاضر</button>
                    <button onClick={() => initiateBulkChange(AttendanceStatus.ABSENT)} className="px-8 py-3 bg-rose-600 rounded-xl font-black">غائب</button>
                  </div>
                  <button onClick={() => setSelectedNames(new Set())} className="text-slate-400 font-bold">إلغاء</button>
                </div>
              </div>
            )}
            
            <button 
              onClick={resetApp} 
              className="w-full py-6 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 font-black hover:bg-slate-50 transition-all no-print"
            >
              بداية تحليل جديد
            </button>
          </div>
        ) : null}
      </main>

      {/* مودال التأكيد */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 max-w-md w-full space-y-8 animate-in zoom-in">
            <h3 className="text-3xl font-black text-slate-800 text-center">تغيير الحالة</h3>
            <p className="text-slate-500 text-center font-medium">سيتم تغيير حالة {selectedNames.size} أسماء إلى <strong>"{getStatusLabel(pendingStatus)}"</strong>. هل أنت متأكد؟</p>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setShowBulkConfirm(false)} className="py-4 border-2 border-slate-200 rounded-2xl font-black text-slate-400">تراجع</button>
              <button onClick={handleBulkStatusChange} className="py-4 bg-emerald-600 text-white rounded-2xl font-black">تأكيد التغيير</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
