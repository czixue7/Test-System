import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDutyScheduleStore, buildShifts } from '../store/dutyScheduleStore';
import { DutyShift, DutyShiftType, JsonDutyScheduleData } from '../types';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { fetchDutyIndex, checkDutyStatus } from '../utils/dutyScheduleIndex';
import { parseDutyExcelFile, parseJsonDutyText, isRestShiftText, ExcelParseResult } from '../utils/xlsxDutyParser';
import { generateDutyForecast } from '../utils/dutyForecast';

const STORAGE_KEY_CURRENT_DUTY = 'current-duty-id';

const SHIFT_LABEL: Record<DutyShiftType, string> = {
  morning: '早班', noon: '中班', night: '晚班', allday: '全天'
};

// 班组颜色映射
const GROUP_COLOR: Record<string, string> = {
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-purple-500 text-white',
  D: 'bg-emerald-500 text-white'
};

const SHIFT_COLOR: Record<DutyShiftType, { badge: string; ring: string }> = {
  morning: { badge: 'bg-orange-500/90 text-white',  ring: 'ring-orange-400' },
  noon:    { badge: 'bg-blue-500/90 text-white',    ring: 'ring-blue-400' },
  night:   { badge: 'bg-purple-500/90 text-white', ring: 'ring-purple-400' },
  allday:  { badge: 'bg-emerald-500/90 text-white', ring: 'ring-emerald-400' }
};

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const LUNAR_NUM = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十','卅一'];
const getLunarLike = (day: number) => LUNAR_NUM[Math.min(day - 1, 30)];

// 演练名称滚动显示组件（首尾相连循环滚动，首尾留空格；点击弹窗）
const DrillMarquee: React.FC<{ text: string; onClick: () => void }> = ({ text, onClick }) => {
  const needScroll = text.length > 12;
  return (
    <div
      className="overflow-hidden whitespace-nowrap cursor-pointer select-none rounded-md"
      onClick={onClick}
      title={text}
    >
      {needScroll ? (
        <div className="inline-block" style={{ animation: 'duty-marquee 12s linear infinite' }}>
          <span className="px-4">{text}</span>
          <span className="px-4">{text}</span>
        </div>
      ) : (
        <span className="px-2">{text}</span>
      )}
    </div>
  );
};

interface RemoteDutyInfo {
  name: string; filename: string; downloadUrl: string; sha: string;
  source: 'system' | 'user'; exists: boolean; hasUpdate: boolean;
  downloading: boolean; progress: number;
}

const DutySchedule: React.FC = () => {
  const navigate = useNavigate();
  const safeArea = useSafeArea();
  const { showSuccess, showError, showInfo } = useToast();
  const { duties, loadDuties, importDuty, importDutyWithSha, updateDutyWithSha, deleteDuty } = useDutyScheduleStore();

  const [currentDutyId, setCurrentDutyId] = useState<string | null>(null);
  const [isDutyListExpanded, setIsDutyListExpanded] = useState(false);

  const now = new Date();
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(() => formatDate(now));

  const [showAddModal, setShowAddModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const [showForecastModal, setShowForecastModal] = useState(false);
  const [forecastClosing, setForecastClosing] = useState(false);
  const [forecastEndDate, setForecastEndDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-12-31`;
  });

  // 演练名称弹窗（带关闭动效）
  const [drillModalText, setDrillModalText] = useState<string | null>(null);
  const [drillClosing, setDrillClosing] = useState(false);
  const closeDrillModal = () => {
    if (drillClosing) return;
    setDrillClosing(true);
    setTimeout(() => {
      setDrillModalText(null);
      setDrillClosing(false);
    }, 180);
  };

  // 推算未来排班弹窗（带关闭动效）
  const closeForecastModal = () => {
    if (forecastClosing) return;
    setForecastClosing(true);
    setTimeout(() => {
      setShowForecastModal(false);
      setForecastClosing(false);
    }, 180);
  };

  // 删除确认弹窗（带关闭动效）
  const closeDeleteModal = () => {
    if (deleteClosing) return;
    setDeleteClosing(true);
    setTimeout(() => {
      setShowDeleteModal(false);
      setDutyToDelete(null);
      setDeleteClosing(false);
    }, 180);
  };

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [importPreview, setImportPreview] = useState<ExcelParseResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [remoteDuties, setRemoteDuties] = useState<RemoteDutyInfo[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteClosing, setDeleteClosing] = useState(false);
  const [dutyToDelete, setDutyToDelete] = useState<string | null>(null);

  useEffect(() => { loadDuties(); }, [loadDuties]);
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_CURRENT_DUTY);
    if (stored && duties.some((d) => d.id === stored)) {
      setCurrentDutyId(stored);
    } else if (duties.length > 0) {
      setCurrentDutyId(duties[0].id);
      localStorage.setItem(STORAGE_KEY_CURRENT_DUTY, duties[0].id);
    } else {
      setCurrentDutyId(null);
    }
  }, [duties]);

  useEffect(() => {
    if (showAddModal) { setIsClosing(false); setTimeout(() => setModalVisible(true), 10); }
    else { setIsClosing(true); setTimeout(() => setModalVisible(false), 300); }
  }, [showAddModal]);

  const currentDuty = duties.find((d) => d.id === currentDutyId);
  const todayStr = formatDate(now);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, DutyShift[]>();
    if (!currentDuty) return map;
    for (const s of currentDuty.shifts) {
      // 只保留有班组（A/B/C/D）、且非休息的班次（休不进日历格）
      if (!s.group) continue;
      if (isRestShiftText(s.tasks[0])) continue;
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ga = a.group || '';
        const gb = b.group || '';
        if (ga !== gb) return ga.localeCompare(gb);
        const order: Record<DutyShiftType, number> = { morning: 0, noon: 1, night: 2, allday: 3 };
        return order[a.shiftType] - order[b.shiftType];
      });
    }
    return map;
  }, [currentDuty]);

  // 详情用：保留休在内，用于标注休和跨班组调班
  const allShiftsByDate = useMemo(() => {
    const map = new Map<string, DutyShift[]>();
    if (!currentDuty) return map;
    for (const s of currentDuty.shifts) {
      if (!s.group) continue;
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [currentDuty]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ date: string | null; day: number; isToday: boolean; inMonth: boolean }> = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ date: null, day: 0, isToday: false, inMonth: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDate(new Date(viewYear, viewMonth, d));
      cells.push({ date: dateStr, day: d, isToday: dateStr === todayStr, inMonth: true });
    }
    while (cells.length % 7 !== 0 || cells.length < 42) {
      cells.push({ date: null, day: 0, isToday: false, inMonth: false });
      if (cells.length >= 42) break;
    }
    return cells;
  }, [viewYear, viewMonth, todayStr]);

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => {
    const now2 = new Date();
    setViewYear(now2.getFullYear());
    setViewMonth(now2.getMonth());
    setSelectedDate(formatDate(now2));
  };

  const handleSelectDuty = (id: string) => {
    setCurrentDutyId(id);
    localStorage.setItem(STORAGE_KEY_CURRENT_DUTY, id);
    setIsDutyListExpanded(false);
  };

  // ===== 导入 =====
  const handleFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setImporting(true);
    setImportError(null);
    setImportPreview(null);
    setImportProgress('解析中...');

    try {
      let result: ExcelParseResult;
      const name = file.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        setImportProgress('解析 Excel 矩阵排班表...');
        result = await parseDutyExcelFile(file);
      } else if (name.endsWith('.json')) {
        setImportProgress('解析 JSON 值班表...');
        const text = await file.text();
        result = parseJsonDutyText(text, file.name);
      } else {
        throw new Error('不支持的文件格式，请上传 .xlsx / .xls / .json');
      }
      setImportPreview(result);
      setImportProgress('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '解析失败');
      showError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    const id = importDuty(importPreview.schedule);
    setCurrentDutyId(id);
    localStorage.setItem(STORAGE_KEY_CURRENT_DUTY, id);

    // 导入后自动跳转到值班表数据所在的月份，并选中第一个有班次的日期
    const shifts = importPreview.schedule.shifts;
    if (shifts.length > 0) {
      const firstDate = new Date(shifts[0].date);
      if (!isNaN(firstDate.getTime())) {
        setViewYear(firstDate.getFullYear());
        setViewMonth(firstDate.getMonth());
        setSelectedDate(shifts[0].date);
      }
    }

    showSuccess(`「${importPreview.schedule.name}」导入成功！共 ${importPreview.preview.totalShifts} 条班次，${importPreview.preview.totalPeople} 人`);
    closeAddModal();
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setImportPreview(null);
    setImportError(null);
    setImportProgress('');
    if (importFileRef.current) importFileRef.current.value = '';
  };

  // ===== 推算未来排班 =====
  const handleForecast = () => {
    if (!currentDuty) {
      showError('请先导入值班表');
      return;
    }
    try {
      const result = generateDutyForecast(currentDuty.shifts, forecastEndDate);
      if (result.shifts.length === 0) {
        showInfo('当前排班已覆盖到截止日期，无需推算');
        closeForecastModal();
        return;
      }
      // 生成独立记录：原有排班 + 推算的未来排班
      const mergedShifts = [...currentDuty.shifts, ...result.shifts];
      const id = importDuty({
        name: `${currentDuty.name}（推算至${result.endDate}）`,
        description: `推算：${result.fromDate} ~ ${result.endDate}，新增 ${result.totalDays} 天 / ${result.shifts.length} 条班次`,
        shifts: mergedShifts
      });
      setCurrentDutyId(id);
      localStorage.setItem(STORAGE_KEY_CURRENT_DUTY, id);
      // 跳到推算起始月
      const startDate = new Date(result.fromDate);
      if (!isNaN(startDate.getTime())) {
        setViewYear(startDate.getFullYear());
        setViewMonth(startDate.getMonth());
        setSelectedDate(result.fromDate);
      }
      showSuccess(`已推算未来排班至 ${result.endDate}，新增 ${result.shifts.length} 条班次`);
      closeForecastModal();
    } catch (err) {
      showError(err instanceof Error ? err.message : '推算失败');
    }
  };

  // ===== GitHub 下载 =====
  const fetchRemoteDutyList = async () => {
    setLoadingRemote(true);
    setRemoteError(null);
    try {
      const index = await fetchDutyIndex();
      if (!index) { setRemoteError('无法获取值班表索引文件'); showError('获取值班表列表失败'); return; }
      const all: RemoteDutyInfo[] = [];
      for (const d of index.systemDuties) {
        const s = checkDutyStatus(d.name, d.sha, d.filename, 'system', duties);
        all.push({ name: d.name, filename: d.filename, downloadUrl: d.downloadUrl, sha: d.sha, source: 'system', exists: s.exists, hasUpdate: s.hasUpdate, downloading: false, progress: 0 });
      }
      for (const d of index.userDuties) {
        const s = checkDutyStatus(d.name, d.sha, d.filename, 'user', duties);
        all.push({ name: d.name, filename: d.filename, downloadUrl: d.downloadUrl, sha: d.sha, source: 'user', exists: s.exists, hasUpdate: s.hasUpdate, downloading: false, progress: 0 });
      }
      all.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      setRemoteDuties(all);
    } catch { setRemoteError('获取值班表列表失败'); showError('获取值班表列表失败'); }
    finally { setLoadingRemote(false); }
  };

  useEffect(() => {
    setRemoteDuties(prev => prev.map(d => {
      const s = checkDutyStatus(d.name, d.sha, d.filename, d.source, duties);
      return { ...d, exists: s.exists, hasUpdate: s.hasUpdate };
    }));
  }, [duties]);

  const handleDownloadRemote = async (duty: RemoteDutyInfo, index: number) => {
    if (!duty.downloadUrl) { showError('下载链接不可用'); return; }
    setRemoteDuties(prev => prev.map((d, i) => i === index ? { ...d, downloading: true, progress: 0 } : d));
    showInfo(duty.hasUpdate ? `更新「${duty.name}」...` : `下载「${duty.name}」...`);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(duty.downloadUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      let data: JsonDutyScheduleData;
      try { data = JSON.parse(text); } catch { throw new Error('文件格式无效'); }
      if (!data.shifts) throw new Error('缺少 shifts 字段');

      const newDuty = { name: data.name || duty.name, description: data.description, shifts: buildShifts(data) };
      const localExist = duties.find(d => d.sourceFilename === duty.filename && d.sourceType === duty.source);
      if (localExist && duty.hasUpdate) updateDutyWithSha(localExist.id, newDuty, duty.sha);
      else importDutyWithSha(newDuty, duty.sha, duty.filename);

      showSuccess(`「${newDuty.name}」${duty.hasUpdate ? '更新' : '下载'}成功`);
      setRemoteDuties(prev => prev.map((d, i) => i === index ? { ...d, downloading: false, progress: 100, exists: true, hasUpdate: false } : d));
    } catch (err) {
      setRemoteDuties(prev => prev.map((d, i) => i === index ? { ...d, downloading: false } : d));
      showError(`下载失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleDeleteConfirm = () => {
    if (!dutyToDelete) return;
    deleteDuty(dutyToDelete);
    if (currentDutyId === dutyToDelete) { setCurrentDutyId(null); localStorage.removeItem(STORAGE_KEY_CURRENT_DUTY); }
    showSuccess('已删除');
    closeDeleteModal();
  };

  // ===== 下载面板 =====
  const renderDownloadPanel = () => {
    if (!loadingRemote && remoteDuties.length === 0 && !remoteError) fetchRemoteDutyList();
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900" style={{ paddingTop: safeArea.top }}>
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 shadow border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
            <button onClick={() => setShowDownloadPanel(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-base font-semibold dark:text-white">下载值班表</h1>
            <button onClick={fetchRemoteDutyList} disabled={loadingRemote} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
              <svg className={`w-5 h-5 ${loadingRemote ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {loadingRemote && <div className="text-center text-gray-400 py-12">加载中...</div>}
          {remoteError && !loadingRemote && (
            <div className="text-center py-12"><p className="text-red-500 mb-3">{remoteError}</p><button onClick={fetchRemoteDutyList} className="px-4 py-2 bg-blue-500 text-white rounded-lg">重试</button></div>
          )}
          {!loadingRemote && !remoteError && remoteDuties.map((duty, idx) => {
            const needsUpdate = duty.hasUpdate;
            return (
              <div key={duty.filename} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium dark:text-white truncate text-sm">{duty.name}</h3>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {duty.source === 'system' ? '系统' : '用户'}
                      {needsUpdate && <span className="ml-2 text-orange-500">有更新</span>}
                      {duty.exists && !needsUpdate && <span className="ml-2 text-blue-500">已存在</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDownloadRemote(duty, idx)} disabled={duty.downloading}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium ${duty.exists && !needsUpdate ? 'bg-gray-200 text-gray-500 dark:bg-gray-700' : needsUpdate ? 'bg-orange-500 text-white' : 'bg-blue-500 text-white'} disabled:opacity-50`}>
                    {duty.downloading ? '下载中...' : duty.exists ? (needsUpdate ? '更新' : '已下载') : '下载'}
                  </button>
                </div>
              </div>
            );
          })}
          {!loadingRemote && !remoteError && remoteDuties.length === 0 && (
            <div className="text-center text-gray-400 py-12">暂无可下载的值班表</div>
          )}
        </div>
      </div>
    );
  };

  if (showDownloadPanel) return renderDownloadPanel();

  // ===== 主页面 =====
  const selectedDayShifts = selectedDate ? allShiftsByDate.get(selectedDate) || [] : [];
  const selectedDateObj = selectedDate ? new Date(selectedDate) : null;
  const selectedWeekday = selectedDateObj ? WEEKDAYS_CN[selectedDateObj.getDay()] : '';
  const selectedDayOfMonth = selectedDateObj ? selectedDateObj.getDate() : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" style={{ paddingTop: safeArea.top + 48, paddingBottom: safeArea.bottom + 70 }}>
      <style>{`
        @keyframes duty-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes modal-fade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes modal-pop {
          0% { opacity: 0; transform: scale(0.9) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="relative max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-800 dark:text-white pointer-events-none">值班表</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowForecastModal(true)} title="推算未来排班" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
            <button onClick={() => setShowAddModal(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4">
        {/* 当前值班表选择器 */}
        {currentDuty ? (
          <div className="mt-4 mb-3">
            <div onClick={() => duties.length > 1 && setIsDutyListExpanded(!isDutyListExpanded)}
              className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 cursor-pointer border border-blue-100 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-gray-800 dark:text-white truncate">{currentDuty.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{currentDuty.shifts.length} 条班次 · {new Set(currentDuty.shifts.map(s => s.personInCharge).filter(Boolean)).size} 人</div>
                </div>
                {duties.length > 1 && (
                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${isDutyListExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                )}
              </div>
              {isDutyListExpanded && duties.length > 1 && (
                <div className="mt-3 pt-3 border-t border-blue-100 dark:border-blue-800 space-y-2 max-h-60 overflow-y-auto">
                  {duties.map(duty => (
                    <div key={duty.id} className="flex items-center gap-2">
                      <button onClick={() => handleSelectDuty(duty.id)}
                        className={`flex-1 text-left px-3 py-2 rounded-lg text-sm ${currentDutyId === duty.id ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                        {duty.name} ({duty.shifts.length})
                      </button>
                      <button onClick={() => { setDutyToDelete(duty.id); setShowDeleteModal(true); }}
                        className="p-2 text-gray-400 hover:text-red-500">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 mb-3 bg-gray-100 dark:bg-gray-800 rounded-xl p-6 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-3 text-sm">暂无值班表</p>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm">导入值班表</button>
          </div>
        )}

        {/* 年月切换 + 大字标题 */}
        <div className="flex items-center justify-between mb-2">
          <button onClick={goPrevMonth} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="text-center">
            <div className="text-xl font-bold text-gray-800 dark:text-white">
              {viewYear} 年 {viewMonth + 1} 月
            </div>
            <button onClick={goToday} className="text-xs text-blue-500 hover:underline">回到今天 ({todayStr})</button>
          </div>
          <button onClick={goNextMonth} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {!currentDuty && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-xs text-yellow-700 dark:text-yellow-300 mb-2 text-center">
            请先导入值班表 · 支持 Excel (.xlsx/.xls) 和 JSON 格式
          </div>
        )}

        {/* 星期表头 */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS_CN.map((w, i) => (
            <div key={w} className={`text-center text-xs py-1 ${i === 0 || i === 6 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {w}
            </div>
          ))}
        </div>

        {/* 日历网格 */}
        <div className="grid grid-cols-7 gap-1 mb-4">
          {calendarCells.map((cell, i) => {
            if (!cell.date) return <div key={i} className="h-11" />;
            const cellShifts = shiftsByDate.get(cell.date) || [];
            const hasDuty = cellShifts.length > 0;
            const isSelected = selectedDate === cell.date;
            const isWeekend = new Date(cell.date).getDay() === 0 || new Date(cell.date).getDay() === 6;
            const dayOfMonth = cell.day;
            // 单元格班组字母（必须与详情"当班班组"一致）：
            //   对每个班次类别（白/夜），人数最多的归属组 = 当班班组 = 显示字母
            //   跨班组来援的人不改变该类别的当班班组归属（即：单元格不显示跨班组的字母）
            //   ⚠️ 统计人数时必须剔除"休"，否则所有非当班且休的班组（5人/组）会比实际当班（4人）的班组人数多，
            //      导致 Day 1 白班被 B(5个休) 胜 D(4人)，选出错的当班班组！
            const catCount = new Map<string, Map<string, number>>(); // cat -> group -> count
            for (const s of cellShifts) {
              if (!s.group) continue;
              if (isRestShiftText(s.tasks[0])) continue; // 休/请假等非当班→不计
              const cat: 'white' | 'night' = s.shiftType === 'night' ? 'night' : 'white';
              if (!catCount.has(cat)) catCount.set(cat, new Map());
              const gm = catCount.get(cat)!;
              gm.set(s.group, (gm.get(s.group) || 0) + 1);
            }
            // 每个cat选人数最多组；然后按 白在前、夜在后排序
            interface CellCat { cat: 'white' | 'night'; group: string; }
            const cats: CellCat[] = [];
            for (const catStr of ['white', 'night'] as const) {
              const gm = catCount.get(catStr);
              if (!gm || gm.size === 0) continue;
              let bestG = ''; let bestN = 0;
              for (const [g, n] of gm.entries()) {
                if (n > bestN || (n === bestN && g < bestG)) { bestN = n; bestG = g; }
              }
              if (bestG) cats.push({ cat: catStr, group: bestG });
            }
            const groups = cats.sort((a,b) => (a.cat === 'white' ? 0 : 1) - (b.cat === 'white' ? 0 : 1)).map(c => c.group);

            return (
              <button key={i} onClick={() => setSelectedDate(cell.date)}
                className={`h-11 rounded-lg flex flex-col items-center justify-center relative transition-all
                  ${isSelected ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400 scale-[1.02]' :
                    cell.isToday ? 'bg-blue-50 dark:bg-blue-900/20' :
                    hasDuty ? 'bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800/30'}`}>
                <span className={`text-sm font-bold leading-none
                  ${cell.isToday ? 'text-blue-600 dark:text-blue-400' :
                    isWeekend ? 'text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                  {cell.inMonth ? dayOfMonth : ''}
                </span>
                {cell.inMonth && hasDuty && (
                  <div className="absolute bottom-0.5 left-0 right-0 flex items-center justify-center gap-0.5">
                    {groups.map(g => (
                      <span key={g} className={`text-[9px] font-bold leading-none w-3.5 h-3.5 rounded flex items-center justify-center ${GROUP_COLOR[g] || 'bg-gray-400 text-white'}`}>
                        {g}
                      </span>
                    ))}
                  </div>
                )}
                {cell.isToday && cell.inMonth && (
                  <div className="absolute bottom-0.5 w-4 h-0.5 bg-blue-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* 选中日期详情 */}
        {selectedDate && (
          <div className="mt-2 mb-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-2xl font-bold text-gray-800 dark:text-white">{selectedDayOfMonth}</span>
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{selectedDateObj ? `${selectedDateObj.getFullYear()}年${selectedDateObj.getMonth() + 1}月` : `${viewYear}年${viewMonth + 1}月`} · 周{selectedWeekday}</span>
                </div>
                <span className="text-xs text-gray-400">{getLunarLike(selectedDayOfMonth)}</span>
              </div>
              {selectedDayShifts.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">当天无排班</div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    // 步骤1：只用于 typedMap（后续未使用，保留以避免回归）
                    const typedMap = new Map<string, DutyShift[]>();
                    for (const s of selectedDayShifts) {
                      const st = s.shiftType === 'night' ? 'night' : 'white';
                      const g = s.group || '';
                      const key = `${st}|${g}`;
                      if (!typedMap.has(key)) typedMap.set(key, []);
                      typedMap.get(key)!.push(s);
                    }

                    // 找到每个 shiftType 的主班组（当班班组）
                    type DutySection = {
                      shiftType: 'white' | 'night';
                      onDutyGroup: string;      // 当班班组字母，如"D"
                      groupShiftType: DutyShiftType;
                      members: Array<{
                        shift: DutyShift;
                        origin: 'on' | 'cross' | 'rest'; // on=本班组正常上班, cross=跨班组来援, rest=本班组但当日休
                      }>;
                    };
                    const sections: DutySection[] = [];

                    // 遍历 shiftType：white first, then night
                    for (const shiftTypeCat of ['white' as const, 'night' as const]) {
                      // 该 shiftType 下，统计「实际当班」的每组人数（休的不计入 bucket，否则长白班会污染统计）
                      const bucket = new Map<string, DutyShift[]>(); // group -> 该类别正常当班的人
                      for (const s of selectedDayShifts) {
                        const g = s.group;
                        if (!g) continue;
                        const isNight = s.shiftType === 'night';
                        const isRest = isRestShiftText(s.tasks[0]);
                        if (isRest) continue; // 休/请假 → 不算当班人数
                        const st = isNight ? 'night' : 'white';
                        if (st !== shiftTypeCat) continue;
                        if (!bucket.has(g)) bucket.set(g, []);
                        bucket.get(g)!.push(s);
                      }

                      // 找主班组：当班人数最多的归属班组
                      let onDutyGroup = '';
                      let maxCount = 0;
                      for (const [g, list] of bucket.entries()) {
                        if (list.length > maxCount || (list.length === maxCount && g < onDutyGroup)) {
                          maxCount = list.length;
                          onDutyGroup = g;
                        }
                      }
                      if (!onDutyGroup) continue;

                      // 该当班班组的 groupShiftType：取 bucket 里第一个有班的 shiftType
                      const first = bucket.get(onDutyGroup)?.[0];
                      if (!first) continue;
                      const groupShiftType: DutyShiftType = first.shiftType;

                      // 成员收集：
                      //   on    = 本班组正常当班（shiftTypeCat 匹配 & 非休）
                      //   cross = 非本班组但 shiftTypeCat 匹配 & 非休（跨班组来援）
                      //   rest  = 本班组但当日休/其它类型上班（标注灰删除线+休）
                      // 注意：只把「当班班组休的人」放进该卡片；其他班组休的人不归入（否则会出现多余"援班"）
                      const added = new Set<string>();
                      const members: DutySection['members'] = [];

                      // 先加跨班组来援的（shiftTypeCat 匹配且非休，但归属组 ≠ 当班班组）
                      for (const [g, list] of bucket.entries()) {
                        if (g === onDutyGroup) continue;
                        for (const s of list) {
                          if (added.has(s.id)) continue;
                          added.add(s.id);
                          members.push({ shift: s, origin: 'cross' });
                        }
                      }
                      // 再加本班组正常当班的
                      for (const s of bucket.get(onDutyGroup) || []) {
                        if (added.has(s.id)) continue;
                        added.add(s.id);
                        members.push({ shift: s, origin: 'on' });
                      }
                      // 最后补：当班班组里，休/或其它 shiftType 当班的（标注休或其它）
                      for (const s of selectedDayShifts) {
                        if (s.group !== onDutyGroup) continue;
                        if (added.has(s.id)) continue;
                        added.add(s.id);
                        const isRest = isRestShiftText(s.tasks[0]);
                        const isThisCat = (s.shiftType === 'night' ? 'night' : 'white') === shiftTypeCat;
                        if (isRest || !isThisCat) {
                          members.push({ shift: s, origin: 'rest' });
                        } else {
                          members.push({ shift: s, origin: 'on' });
                        }
                      }

                      sections.push({ shiftType: shiftTypeCat, onDutyGroup, groupShiftType, members });
                    }

                    // 排序：白在前、夜在后；同类型按当班班组字母
                    sections.sort((a, b) => {
                      if (a.shiftType !== b.shiftType) return a.shiftType === 'white' ? -1 : 1;
                      return a.onDutyGroup.localeCompare(b.onDutyGroup);
                    });

                    if (sections.length === 0) {
                      return <div className="text-center py-6 text-sm text-gray-400">当天无排班</div>;
                    }

                    return sections.map(sec => {
                      const g = sec.onDutyGroup;
                      const isNight = sec.shiftType === 'night';
                      const shiftLabel = isNight ? '夜班' : '白班';
                      // 该班组当天对应的演练名称
                      const drills = currentDuty?.drills?.filter(d => d.date === selectedDate && d.group === g) || [];
                      const drillNames = drills.map(d => d.name);
                      return (
                        <div key={`${g}-${sec.shiftType}`} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`flex-shrink-0 w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center ${GROUP_COLOR[g] || 'bg-gray-400 text-white'}`}>
                              {g || '长'}
                            </span>
                            <span className="font-medium text-gray-800 dark:text-white text-sm">
                              {g ? `${g}班组` : '长白班'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isNight ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300'}`}>
                              {shiftLabel}
                            </span>
                          </div>
                          {!isNight && drillNames.length > 0 && (
                            <div className="mb-2 space-y-1">
                              {drillNames.map((name, i) => (
                                <DrillMarquee key={i} text={name} onClick={() => { setDrillClosing(false); setDrillModalText(drillNames.join('\n')); }} />
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5 pl-9">
                            {sec.members.map(m => {
                              const isRest = m.origin === 'rest' || isRestShiftText(m.shift.tasks[0]);
                              const isCross = m.origin === 'cross';
                              const name = m.shift.personInCharge || '未命名';
                              const originGroup = m.shift.group;
                              return (
                                <span key={m.shift.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors
                                  ${isRest
                                    ? 'bg-gray-100 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 line-through border-gray-200 dark:border-gray-600'
                                    : isCross
                                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                                  }`}>
                                  {isCross && originGroup && originGroup !== g && (
                                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                      {originGroup}→{g}
                                    </span>
                                  )}
                                  {name}
                                  {isRest && <span className="text-[9px] ml-0.5 opacity-70">休</span>}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg dark:bg-gray-800 dark:border-gray-700" style={{ paddingBottom: safeArea.bottom }}>
        <div className="max-w-lg mx-auto flex justify-around py-0.5">
          <button onClick={() => navigate('/')} className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            <span className="text-xs mt-0.5">首页</span>
          </button>
          <button className="flex flex-col items-center py-1 px-4 text-blue-600 dark:text-blue-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-xs mt-0.5 font-medium">值班表</span>
          </button>
          <button onClick={() => navigate('/placeholder')} className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
            <span className="text-xs mt-0.5">知识库</span>
          </button>
          <button onClick={() => navigate('/profile')} className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs mt-0.5">我的</span>
          </button>
        </div>
      </nav>

      {/* 添加/导入弹窗 */}
      {(showAddModal || modalVisible) && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'} bg-black/60`}
          onClick={closeAddModal}>
          <div
            className={`bg-white dark:bg-gray-800 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-semibold dark:text-white">导入值班表</h2>
              <button onClick={closeAddModal} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label htmlFor="duty-file-input" className="block border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-xl p-6 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors">
                  <input
                    id="duty-file-input"
                    ref={importFileRef}
                    type="file"
                    accept=".xlsx,.xls,.json"
                    multiple={false}
                    onChange={(e) => handleFileSelected(e.target.files)}
                    className="hidden" />
                  <div className="w-12 h-12 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-2">
                    <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-white">选择文件上传</p>
                  <p className="text-xs text-gray-400 mt-1">支持 Excel (.xlsx / .xls) · JSON</p>
                </label>
              </div>

              {importing && (
                <div className="text-center py-4 text-sm text-blue-500">
                  <svg className="w-5 h-5 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  {importProgress || '解析中...'}
                </div>
              )}

              {importError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
                  {importError}
                </div>
              )}

              {importPreview && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl space-y-2">
                  <div className="text-sm font-medium text-green-700 dark:text-green-300">✓ 解析成功</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">值班表名</div>
                      <div className="font-medium text-gray-800 dark:text-white truncate">{importPreview.schedule.name}</div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">日期范围</div>
                      <div className="font-medium text-gray-800 dark:text-white truncate">{importPreview.preview.dateRange}</div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">总人数</div>
                      <div className="font-medium text-gray-800 dark:text-white">{importPreview.preview.totalPeople} 人</div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">总班次</div>
                      <div className="font-medium text-gray-800 dark:text-white">{importPreview.preview.totalShifts} 条</div>
                    </div>
                  </div>
                  {Object.keys(importPreview.preview.shiftDistribution).length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      班次分布：
                      {Object.entries(importPreview.preview.shiftDistribution).map(([t, n]) => (
                        <span key={t} className="ml-2">{SHIFT_LABEL[t as DutyShiftType] || t} {n}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs text-gray-400">或</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              <button onClick={() => { closeAddModal(); setShowDownloadPanel(true); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white text-sm">从 GitHub 下载</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">获取云端值班表资源</div>
                </div>
              </button>
            </div>

            {importPreview && (
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
                <button onClick={handleConfirmImport}
                  className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
                  导入「{importPreview.schedule.name}」
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 推算未来排班 */}
      {showForecastModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" style={{ animation: forecastClosing ? 'modal-fade-out 0.18s ease-in forwards' : 'modal-fade 0.2s ease-out' }} onClick={closeForecastModal}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl" style={{ animation: forecastClosing ? 'modal-pop-out 0.18s ease-in forwards' : 'modal-pop 0.25s ease-out' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold dark:text-white">推算未来排班</h3>
              <button onClick={closeForecastModal} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              根据当前值班表「{currentDuty?.name || ''}」的已有排班，排除调休、判断各班组基准轮转规律，自动往后循环推算。
            </p>
            <label className="block mb-4">
              <span className="text-sm text-gray-600 dark:text-gray-300 mb-1.5 block">推算截止日期</span>
              <input
                type="date"
                value={forecastEndDate}
                onChange={(e) => setForecastEndDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </label>
            <div className="flex gap-2">
              <button onClick={closeForecastModal} className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium">取消</button>
              <button onClick={handleForecast} className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">开始推算</button>
            </div>
          </div>
        </div>
      )}

      {/* 演练名称弹窗（关闭带淡出/缩放动效） */}
      {drillModalText !== null && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
          style={{ animation: drillClosing ? 'modal-fade-out 0.18s ease-in forwards' : 'modal-fade 0.2s ease-out' }}
          onClick={closeDrillModal}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl"
            style={{ animation: drillClosing ? 'modal-pop-out 0.18s ease-in forwards' : 'modal-pop 0.25s ease-out' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold dark:text-white">演练名称</h3>
              <button onClick={closeDrillModal} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed break-words">
              {drillModalText}
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" style={{ animation: deleteClosing ? 'modal-fade-out 0.18s ease-in forwards' : 'modal-fade 0.2s ease-out' }} onClick={closeDeleteModal}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl" style={{ animation: deleteClosing ? 'modal-pop-out 0.18s ease-in forwards' : 'modal-pop 0.25s ease-out' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 dark:text-white">删除值班表</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">确定删除？此操作不可撤销。</p>
            <div className="flex gap-2">
              <button onClick={closeDeleteModal} className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium">取消</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DutySchedule;
