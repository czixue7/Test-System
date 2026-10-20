import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDutyScheduleStore, buildShifts } from '../store/dutyScheduleStore';
import { DutyShift, DutyShiftType, DutyRoleAssignment, DutyDrill, JsonDutyScheduleData } from '../types';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { useLongPress } from '../hooks/useLongPress';
import Modal from '../components/Modal';
import DrillEditModal from './duty/DrillEditModal';
import RoleEditModal from './duty/RoleEditModal';
import SwapPersonnelModal from './duty/SwapPersonnelModal';
import { fetchDutyIndex, checkDutyStatus } from '../utils/dutyScheduleIndex';
import { fetchRemoteText, rawUrlCandidates } from '../utils/remoteRepo';
import { assertSourceAvailable } from '../utils/dataSourceRequest';
import { parseDutyExcelFile, parseJsonDutyText, isRestShiftText, DutyParseResult } from '../utils/dutyParsers';
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

// 本页「小元素」局部关闭毛玻璃（不改全局样式，不影响其他页面）：
// 全局 [data-theme="immersive"] .bg-white / .dark:bg-gray-800 等规则会给每个白底元素加一层
// backdrop-filter，而本页日历格子的数量随日期数增长（最多 30+ 个）、人名标签随当日人数增长，
// 于是加载表格数据后会同时出现几十个独立模糊图层，每帧都要回读背景并重新模糊，打满移动端 GPU。
// 这里只去掉 backdrop-filter，半透明白底与细边框仍由全局规则提供，视觉几乎无差别——这些小色块
// 背后只是一层平滑渐变，18px 模糊本来就看不出差异。header / 底部导航 / 详情卡片等大块面照旧保留毛玻璃。
const NO_BLUR: React.CSSProperties = { backdropFilter: 'none', WebkitBackdropFilter: 'none' };

const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 只在实际溢出时滚动；两份等宽内容按精确像素距离循环，宽屏不显示重复副本。
const DrillMarquee: React.FC<{ text: string; onClick: () => void }> = ({ text, onClick }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [metrics, setMetrics] = useState({ overflow: false, distance: 0 });

  useEffect(() => {
    const viewport = ref.current;
    const label = textRef.current;
    if (!viewport || !label) return;
    const measure = () => {
      const width = label.getBoundingClientRect().width;
      const next = { overflow: width > viewport.clientWidth + 1, distance: width + 32 };
      setMetrics(previous => previous.overflow === next.overflow && Math.abs(previous.distance - next.distance) < 0.5 ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(label);
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <button
      type="button"
      ref={ref}
      className="duty-drill"
      onClick={onClick}
      title={text}
      aria-label={text}
    >
      <span className={`duty-drill-track ${metrics.overflow ? 'duty-drill-track--scroll' : ''}`}
        style={{
          '--duty-scroll-distance': `${metrics.distance}px`,
          animationDuration: `${Math.max(8, metrics.distance / 28)}s`,
          animationPlayState: visible ? 'running' : 'paused',
        } as React.CSSProperties}>
        <span className="duty-drill-copy"><span ref={textRef}>{text}</span></span>
        {metrics.overflow && <span className="duty-drill-copy" aria-hidden="true">{text}</span>}
      </span>
    </button>
  );
};

interface RemoteDutyInfo {
  name: string; filename: string; downloadUrl: string; sha: string; sourceId?: string;
  source: 'system' | 'user'; exists: boolean; hasUpdate: boolean;
  downloading: boolean; progress: number;
}

// 详情面板分组:某班次类别(白/夜)下的当班班组及其成员
interface DutySection {
  shiftType: 'white' | 'night';
  onDutyGroup: string;      // 当班班组字母,如"D"
  groupShiftType: DutyShiftType;
  members: Array<{
    shift: DutyShift;
    origin: 'on' | 'cross' | 'rest'; // on=本班组正常上班, cross=跨班组来援, rest=本班组但当日休
  }>;
}

const DutySchedule: React.FC = () => {
  const navigate = useNavigate();
  const safeArea = useSafeArea();
  const { showSuccess, showError, showInfo } = useToast();
  const { duties, loadDuties, importDuty, importDutyWithSha, updateDuty, updateDutyWithSha, deleteDuty } = useDutyScheduleStore();
  const isLoaded = useDutyScheduleStore((s) => s.isLoaded);

  // 直接以 localStorage 记忆的当前值班表 id 初始化（而非挂载后再异步 set），
  // 这样首帧就能命中数据，避免每次切回值班表 tab 先渲染一帧「空态」再跳变到完整布局的闪动
  const [currentDutyId, setCurrentDutyId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_CURRENT_DUTY));
  const [showDutySheet, setShowDutySheet] = useState(false);

  const now = new Date();
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(() => formatDate(now));

  const [showAddModal, setShowAddModal] = useState(false);

  const [showForecastModal, setShowForecastModal] = useState(false);
  const [forecastEndDate, setForecastEndDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-12-31`;
  });

  // 演练名称弹窗
  // drillModalText 只作开关（非空=打开）；drillModalDisplay 缓存当前文案，
  // 打开时同步写入、关闭时保留，这样退场动画期间文字不提前消失
  const [drillModalText, setDrillModalText] = useState<string | null>(null);
  const [drillModalDisplay, setDrillModalDisplay] = useState('');
  const openDrillModal = (text: string) => {
    setDrillModalDisplay(text);
    setDrillModalText(text);
  };
  const closeDrillModal = () => {
    setDrillModalText(null);
  };

  // 长按日历格 → 操作面板（内容改写 / 人员交换 / 岗位改写）
  const [longPressDate, setLongPressDate] = useState<string | null>(null);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [drillEditOpen, setDrillEditOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapPickTarget, setSwapPickTarget] = useState(false);
  const [swapTargetDate, setSwapTargetDate] = useState<string | null>(null);
  const [roleEditOpen, setRoleEditOpen] = useState(false);

  const longPressHandlers = useLongPress({
    onLongPress: (e, target) => {
      const d = target?.dataset.date;
      if (d) {
        setSwapPickTarget(false);
        setSwapTargetDate(null);
        setSelectedDate(d);
        setLongPressDate(d);
        setShowActionPanel(true);
      }
    },
    onClick: (e) => {
      const el = e.currentTarget as HTMLElement;
      const d = el.dataset.date;
      if (!d) return;
      if (swapPickTarget) {
        // 人员交换待选换入目标：直接点选已有日历上有排班的日期，只对该日期对应的班组进行交换
        if (d === longPressDate || !shiftsByDate.has(d)) return;
        setSwapTargetDate(d);
        setSelectedDate(d);
        setSwapPickTarget(false);
        setSwapOpen(true);
      } else {
        setSelectedDate(d);
      }
    },
  });

  // 内容改写：替换 longPressDate 当天的演练条目
  const handleSaveDrills = (date: string | null, rows: DutyDrill[]) => {
    if (!currentDuty || !date) return;
    updateDuty(currentDuty.id, {
      drills: [...(currentDuty.drills || []).filter((d) => d.date !== date), ...rows.map((r) => ({ ...r, date }))]
    });
    setDrillEditOpen(false);
    setLongPressDate(null);
    showSuccess('演练内容已更新');
  };

  // 岗位改写：替换 longPressDate 当天的岗位划分
  const handleSaveRoles = (date: string | null, roles: DutyRoleAssignment[]) => {
    if (!currentDuty || !date) return;
    updateDuty(currentDuty.id, {
      roles: [...(currentDuty.roles || []).filter((r) => r.date !== date), ...roles.map((r) => ({ ...r, date }))]
    });
    setRoleEditOpen(false);
    setLongPressDate(null);
    showSuccess('岗位划分已更新');
  };

  // 人员交换：整体替换班次列表（swapPersonnel 已在弹窗内完成对调）
  const handleApplySwap = (newShifts: DutyShift[]) => {
    if (!currentDuty) return;
    updateDuty(currentDuty.id, { shifts: newShifts });
    setSwapOpen(false);
    setLongPressDate(null);
    setSwapTargetDate(null);
    setSwapPickTarget(false);
    showSuccess('人员交换成功');
  };

  // 推算未来排班弹窗
  const closeForecastModal = () => {
    setShowForecastModal(false);
  };

  // 删除确认弹窗
  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDutyToDelete(null);
  };

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [importPreview, setImportPreview] = useState<DutyParseResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [remoteDuties, setRemoteDuties] = useState<RemoteDutyInfo[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dutyToDelete, setDutyToDelete] = useState<string | null>(null);

  // 仅当 store 尚未从存储恢复时才重载；已加载则直接复用已有数据，
  // 避免每次切回值班表 tab 都重新异步读取并触发 duties 引用变化 → 多一次布局重排
  useEffect(() => {
    if (!isLoaded) loadDuties();
  }, [loadDuties, isLoaded]);
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


  // 兜底：首帧 currentDutyId 尚未经 effect 校正时，直接回退到第一张值班表，
  // 避免「空态 → 完整布局」的跳变闪动（effect 随后会把 currentDutyId 校正并写回 localStorage）
  const currentDuty = duties.find((d) => d.id === currentDutyId) || duties[0] || undefined;
  const todayStr = formatDate(now);

  // 每个值班表的班次/人数统计:一次遍历全部值班表,仅在 duties 变化时重算
  // (写在 render body 里会导致每次交互都对数千条 shifts 重算 map+filter+Set)
  const dutyListStats = useMemo(() => {
    const map = new Map<string, { count: number; people: number }>();
    for (const d of duties) {
      const people = new Set<string>();
      for (const s of d.shifts) {
        if (s.personInCharge) people.add(s.personInCharge);
      }
      map.set(d.id, { count: d.shifts.length, people: people.size });
    }
    return map;
  }, [duties]);

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

  // 详情用:保留休在内,用于标注休和跨班组调班
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

  // 岗位划分查表(date+group → 岗位分配),仅导入岗位表后才存在
  const rolesByDateGroup = useMemo(() => {
    const map = new Map<string, DutyRoleAssignment>();
    if (!currentDuty?.roles) return map;
    for (const r of currentDuty.roles) {
      map.set(`${r.date}-${r.group}`, r);
    }
    return map;
  }, [currentDuty]);

  // 日历格班组字母(date → 各类别当班班组,白前夜后),提前算好供渲染查表,
  // 避免每次渲染对 42 个格子重复做 Map 统计。
  // 规则(必须与详情"当班班组"一致):
  //   对每个班次类别(白/夜),人数最多的归属组 = 当班班组 = 显示字母;
  //   跨班组来援的人不改变该类别的当班班组归属。
  // ⚠️ 统计人数时必须剔除"休",否则非当班且休的班组(5人/组)会比实际当班(4人)的班组人数多,
  //    导致 Day 1 白班被 B(5个休) 胜 D(4人),选出错的当班班组!
  //    —— shiftsByDate 构建时已过滤休和非班组数据,此处无需再调 isRestShiftText。
  const dateGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [date, cellShifts] of shiftsByDate) {
      const catCount = new Map<string, Map<string, number>>(); // cat(white/night) -> group -> count
      for (const s of cellShifts) {
        const cat: 'white' | 'night' = s.shiftType === 'night' ? 'night' : 'white';
        if (!catCount.has(cat)) catCount.set(cat, new Map());
        const gm = catCount.get(cat)!;
        gm.set(s.group!, (gm.get(s.group!) || 0) + 1);
      }
      const groups: string[] = [];
      for (const catStr of ['white', 'night'] as const) { // 循环顺序即保证白在前、夜在后
        const gm = catCount.get(catStr);
        if (!gm || gm.size === 0) continue;
        let bestG = '';
        let bestN = 0;
        for (const [g, n] of gm.entries()) {
          if (n > bestN || (n === bestN && g < bestG)) { bestN = n; bestG = g; }
        }
        if (bestG) groups.push(bestG);
      }
      if (groups.length > 0) map.set(date, groups);
    }
    return map;
  }, [shiftsByDate]);

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
    // 只补齐最后一周,不再强制补满 6 行(避免月末出现整行空白)
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, day: 0, isToday: false, inMonth: false });
    }
    return cells;
  }, [viewYear, viewMonth, todayStr]);

  // 详情面板分组(白/夜 → 当班班组 → 成员 on/cross/rest),提取到 useMemo 避免每次渲染重算
  const selectedSections = useMemo<DutySection[]>(() => {
    const dayShifts = selectedDate ? allShiftsByDate.get(selectedDate) || [] : [];
    const sections: DutySection[] = [];

    // 遍历 shiftType:white first, then night
    for (const shiftTypeCat of ['white' as const, 'night' as const]) {
      // 该 shiftType 下,统计「实际当班」的每组人数(休的不计入 bucket,否则长白班会污染统计)
      const bucket = new Map<string, DutyShift[]>(); // group -> 该类别正常当班的人
      for (const s of dayShifts) {
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

      // 找主班组:当班人数最多的归属班组
      let onDutyGroup = '';
      let maxCount = 0;
      for (const [g, list] of bucket.entries()) {
        if (list.length > maxCount || (list.length === maxCount && g < onDutyGroup)) {
          maxCount = list.length;
          onDutyGroup = g;
        }
      }
      if (!onDutyGroup) continue;

      // 该当班班组的 groupShiftType:取 bucket 里第一个有班的 shiftType
      const first = bucket.get(onDutyGroup)?.[0];
      if (!first) continue;
      const groupShiftType: DutyShiftType = first.shiftType;

      // 成员收集:
      //   on    = 本班组正常当班(shiftTypeCat 匹配 & 非休)
      //   cross = 非本班组但 shiftTypeCat 匹配 & 非休(跨班组来援)
      //   rest  = 本班组但当日休/其它类型上班(标注灰删除线+休)
      // 注意:只把「当班班组休的人」放进该卡片;其他班组休的人不归入(否则会出现多余"援班")
      const added = new Set<string>();
      const members: DutySection['members'] = [];

      // 先加跨班组来援的(shiftTypeCat 匹配且非休,但归属组 ≠ 当班班组)
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
      // 最后补:当班班组里,休/或其它 shiftType 当班的(标注休或其它)
      for (const s of dayShifts) {
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

    // 排序:白在前、夜在后;同类型按当班班组字母
    sections.sort((a, b) => {
      if (a.shiftType !== b.shiftType) return a.shiftType === 'white' ? -1 : 1;
      return a.onDutyGroup.localeCompare(b.onDutyGroup);
    });
    return sections;
  }, [selectedDate, allShiftsByDate]);

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
    setShowDutySheet(false);
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
      let result: DutyParseResult;
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

    showSuccess(`「${importPreview.schedule.name}」导入成功！共 ${importPreview.preview.totalShifts} 条班次，${importPreview.preview.totalPeople} 人${importPreview.preview.totalDrills ? `，演练 ${importPreview.preview.totalDrills} 条` : ''}`);
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

  // ===== 远程下载（优先 Gitee，失败回退 GitHub） =====
  const fetchRemoteDutyList = async () => {
    setLoadingRemote(true);
    setRemoteError(null);
    try {
      const index = await fetchDutyIndex();
      if (!index) { setRemoteError('无法获取值班表索引文件'); showError('获取值班表列表失败'); return; }
      const all: RemoteDutyInfo[] = [];
      for (const d of index.systemDuties) {
        const s = checkDutyStatus(d.name, d.sha, d.filename, 'system', duties);
        all.push({ sourceId: d.sourceId, name: d.name, filename: d.filename, downloadUrl: d.downloadUrl, sha: d.sha, source: 'system', exists: s.exists, hasUpdate: s.hasUpdate, downloading: false, progress: 0 });
      }
      for (const d of index.userDuties) {
        const s = checkDutyStatus(d.name, d.sha, d.filename, 'user', duties);
        all.push({ sourceId: d.sourceId, name: d.name, filename: d.filename, downloadUrl: d.downloadUrl, sha: d.sha, source: 'user', exists: s.exists, hasUpdate: s.hasUpdate, downloading: false, progress: 0 });
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
      // 优先 Gitee，失败回退 GitHub（Tauri 环境由 Rust 后端抓取，绕过 CORS）
      assertSourceAvailable(duty.sourceId, duty.downloadUrl);
      const text = await fetchRemoteText(rawUrlCandidates(duty.downloadUrl));
      let data: JsonDutyScheduleData;
      try { data = JSON.parse(text); } catch { throw new Error('文件格式无效'); }
      if (!data.shifts) throw new Error('缺少 shifts 字段');

      const newDuty = { name: data.name || duty.name, description: data.description, shifts: buildShifts(data), drills: data.drills, roles: data.roles, sourceType: duty.source };
      const localExist = duties.find(d => d.sourceFilename === duty.filename && d.sourceType === duty.source);
      if (localExist && duty.hasUpdate) {
        // 已被本地编辑（长按改写/人员交换）的记录：整体覆盖会丢失本地改动，改为导入为新记录以保留编辑
        if (localExist.locallyEdited) {
          importDutyWithSha(newDuty, duty.sha, duty.filename);
          showSuccess(`「${newDuty.name}」最新数据已作为新记录导入，含本地编辑的原记录已保留`);
        } else {
          updateDutyWithSha(localExist.id, newDuty, duty.sha);
          showSuccess(`「${newDuty.name}」更新成功`);
        }
      } else if (localExist) {
        // 已存在且无更新的记录：避免重复新建
        showInfo(`「${newDuty.name}」已是最新，无需重复下载`);
      } else {
        importDutyWithSha(newDuty, duty.sha, duty.filename);
        showSuccess(`「${newDuty.name}」下载成功`);
      }
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
          <div className="max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" style={{ paddingTop: safeArea.top + 36, paddingBottom: safeArea.bottom + 70 }}>
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="relative max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => (duties.length > 0 ? setShowDutySheet(true) : setShowAddModal(true))}
            className="absolute left-1/2 -translate-x-1/2 max-w-[55%] flex items-center gap-1 px-2 py-1 rounded-lg text-base font-semibold text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800">
            <span className="truncate">{currentDuty ? currentDuty.name : '值班表'}</span>
            {duties.length > 1 && (
              <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            )}
          </button>
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

      <div className="max-w-lg mx-auto px-4 pt-3">
        {/* 空状态：未导入任何值班表 */}
        {!currentDuty && (
          <div className="mb-3 bg-gray-100 dark:bg-gray-800 rounded-xl p-6 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-3 text-sm">暂无值班表</p>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm">导入值班表</button>
          </div>
        )}

        {/* 人员交换：待选择换入目标 —— 直接在已有日历上点选当天班组 */}
        {swapPickTarget && longPressDate && (
          <div style={{ top: safeArea.top + 40 }} className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-800 shadow-md w-[calc(100%-2rem)] max-w-[30rem]">
            <div className="flex-1 min-w-0 text-xs text-blue-700 dark:text-blue-200">
              <div className="flex items-center gap-1.5 font-semibold leading-none">
                <span className="shrink-0">换出：{longPressDate}</span>
                {(dateGroups.get(longPressDate) || []).map((g) => (
                  <span key={g} className={`w-6 h-5 flex items-center justify-center rounded-md text-[10px] font-bold ${GROUP_COLOR[g] || 'bg-gray-400 text-white'}`}>{g}</span>
                ))}
              </div>
              <div className="mt-1 leading-snug whitespace-normal">→ 请点击日历上有排班的日期作为换入目标</div>
            </div>
            <button onClick={() => setSwapPickTarget(false)} className="shrink-0 px-3 py-1.5 rounded-lg bg-white/70 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300 border border-blue-200 dark:border-blue-700">
              取消
            </button>
          </div>
        )}

        {/* 人员交换聚焦遮罩：日历区域与顶部盒子之外全部暗淡模糊且不可点击，凸显日历范围 */}
        {swapPickTarget && longPressDate && (
          <div className="pointer-events-auto fixed inset-0 z-50 bg-black/40 dark:bg-black/55 backdrop-blur-[3px]" />
        )}

        {/* 年月作为完整标题同行展示，与右侧操作垂直居中。 */}
        <div className={`duty-month-toolbar ${swapPickTarget ? 'relative z-[60] mt-20' : ''}`}>
          <h2 className="duty-month-title" aria-live="polite" aria-atomic="true">
            {viewYear} 年 {viewMonth + 1} 月
          </h2>
          <div className="duty-month-actions">
            <button type="button" onClick={goToday} className="duty-month-today" title={`回到今天：${todayStr}`} aria-label={`回到今天，${todayStr}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /><circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" /></svg>
              回到今天
            </button>
            <div className="duty-month-paging" role="group" aria-label="切换月份">
              <button type="button" onClick={goPrevMonth} className="duty-month-arrow" title="上个月" aria-label="上个月">
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button type="button" onClick={goNextMonth} className="duty-month-arrow" title="下个月" aria-label="下个月">
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </div>

        {!currentDuty && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-xs text-yellow-700 dark:text-yellow-300 mb-2 text-center">
            请先导入值班表 · 支持 Excel (.xlsx/.xls) 格式
          </div>
        )}

        {/* 星期表头 */}
        <div className="duty-weekdays grid grid-cols-7 mb-1">
          {WEEKDAYS_CN.map((w, i) => (
            <div key={w} className={`text-center text-xs py-1 ${i === 0 || i === 6 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {w}
            </div>
          ))}
        </div>

        {/* 日历网格 */}
        <div className={`grid grid-cols-7 gap-1.5 mb-4 ${swapPickTarget ? 'relative z-[60]' : ''}`}>
          {calendarCells.map((cell, i) => {
            if (!cell.date) return <div key={i} className="h-12" />;
            const hasDuty = shiftsByDate.has(cell.date);
            // 班组字母直接查表(计算规则见上方 dateGroups 的注释,与详情"当班班组"一致)
            const groups = dateGroups.get(cell.date) || [];
            const isSelected = selectedDate === cell.date;
            const isWeekend = new Date(cell.date).getDay() === 0 || new Date(cell.date).getDay() === 6;
            const dayOfMonth = cell.day;
            // 状态类由 .duty-day 系列样式接管(见 index.css"日历日格"分节):
            // 不走全局 .bg-white / .rounded-* —— 那些会被沉浸式主题统一改写成半透明白卡片。
            const dayStateClass = [
              hasDuty ? 'duty-day--has' : '',
              cell.date < todayStr ? 'duty-day--past' : cell.date > todayStr ? 'duty-day--future' : '',
              cell.isToday ? 'duty-day--today' : '',
              isWeekend ? 'duty-day--weekend' : '',
              isSelected ? 'duty-day--selected' : ''
            ].filter(Boolean).join(' ');

            return (
              <button key={i}
                data-date={cell.date || ''}
                aria-current={cell.isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                aria-label={`${cell.date}${cell.isToday ? '，今天' : ''}${groups.length ? `，班组 ${groups.join('、')}` : '，无排班'}`}
                {...longPressHandlers}
                style={NO_BLUR}
                className={`duty-day h-12 w-full touch-manipulation select-none ${dayStateClass}`}>
                <span className="duty-day-num">{cell.inMonth ? dayOfMonth : ''}</span>
                {cell.inMonth && hasDuty && (
                  <span className="duty-day-badges" style={{
                    gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, minmax(0, 1fr))`,
                    // 一张背景只横向分色，共用上下边缘，不再逐块栅格化 SVG 矩形。
                    backgroundImage: groups.length ? `linear-gradient(to right, ${groups.map((g, index) => {
                      const color = `var(--band-${['A', 'B', 'C', 'D'].includes(g) ? g : 'other'})`;
                      return `${color} ${index * 100 / groups.length}%, ${color} ${(index + 1) * 100 / groups.length}%`;
                    }).join(', ')})` : undefined,
                  }}>
                    {groups.map((g, index) => (
                      <span key={`${g}-${index}`} className="duty-day-badge" data-group={g}>
                        {g}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 选中日期详情 */}
        {selectedDate && (
          <div className="mt-2 mb-4">
            <div style={NO_BLUR} className="duty-detail-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-2xl font-bold text-gray-800 dark:text-white">{selectedDayOfMonth}</span>
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{selectedDateObj ? `${selectedDateObj.getFullYear()}年${selectedDateObj.getMonth() + 1}月` : `${viewYear}年${viewMonth + 1}月`} · 周{selectedWeekday}</span>
                </div>
              </div>
              {selectedDayShifts.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">当天无排班</div>
              ) : (
                <div className="space-y-3">
                  {selectedSections.length === 0 ? (
                    <div className="text-center py-6 text-sm text-gray-400">当天无排班</div>
                  ) : selectedSections.map(sec => {
                      const g = sec.onDutyGroup;
                      const isNight = sec.shiftType === 'night';
                      const shiftLabel = isNight ? '夜班' : '白班';
                      // 该班组当天对应的演练名称
                      const drills = currentDuty?.drills?.filter(d => d.date === selectedDate && d.group === g) || [];
                      const drillNames = drills.map(d => d.name);
                      // 按日期和班组读取岗位表信息，白班、夜班均可展示。
                      const role = g ? rolesByDateGroup.get(`${selectedDate}-${g}`) : undefined;
                      // 岗位划分(值班长+各岗位)已展示的姓名:下方成员标签不再重复展示
                      const roleNames = role
                        ? new Set<string>([
                            ...(role.leader ? [role.leader] : []),
                            ...role.posts.map(p => p.person)
                          ])
                        : null;
                      const shownNames = new Set<string>();
                      const visibleMembers = sec.members.filter(m => {
                        const name = m.shift.personInCharge || '未命名';
                        if (roleNames && roleNames.has(name)) return false;
                        if (shownNames.has(name)) return false;
                        shownNames.add(name);
                        return true;
                      });
                      return (
                        <div key={`${g}-${sec.shiftType}`} style={NO_BLUR} className={`duty-detail-section duty-detail-section--${g || 'L'} p-3`}>
                          <div className="duty-section-heading">
                            <div className="flex items-center gap-2">
                            <span className={`duty-detail-badge duty-detail-badge--${g || 'L'}`}>
                              <span className="duty-detail-badge-letter">{g || '长'}</span>
                            </span>
                            <span className="duty-group-title">{g ? `${g} 班组` : '长白班'}</span>
                            </div>
                            <span className={`duty-shift-label ${isNight ? 'duty-shift-label--night' : 'duty-shift-label--day'}`}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                {isNight ? <path d="M20.6 13.1A8.6 8.6 0 0 1 10.9 3.4 8.7 8.7 0 1 0 20.6 13.1Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
                              </svg>
                              {shiftLabel}
                            </span>
                          </div>
                          {!isNight && drillNames.length > 0 && (
                            <div className="mb-2 space-y-1">
                              {drillNames.map((name, i) => (
                                <DrillMarquee key={i} text={name} onClick={() => { openDrillModal(drillNames.join('\n')); }} />
                              ))}
                            </div>
                          )}
                          {(visibleMembers.length > 0 || (role && (role.leader || role.posts.length > 0))) && (
                            <div className="duty-people">
                              {role && <>
                                {role.leader && <span className="duty-person-chip duty-person-chip--leader">
                                  <span className="duty-person-role">值班长</span><span className="font-medium">{role.leader}</span>
                                </span>}
                                {role.posts.map((post, index) => <span key={`post-${index}`} className="duty-person-chip duty-person-chip--post">
                                  <span className="duty-person-role">{post.name}</span><span className="font-medium">{post.person}</span>
                                </span>)}
                              </>}
                              {visibleMembers.map(m => {
                                const isRest = m.origin === 'rest' || isRestShiftText(m.shift.tasks[0]);
                                // 来源组:优先取人员交换后记录的 originGroup,无交换时取所在组
                                const originGroup = m.shift.originGroup || m.shift.group;
                                // 跨组支援:原 plan 里在别的班组当班(m.origin==='cross'),
                                // 或人员交换后来源组≠当前当班班组 → 标黄并显示「由几号→X班」
                                const isCross = m.origin === 'cross' || (!!m.shift.originGroup && m.shift.originGroup !== g);
                                // 人员交换调入:点击名字可查看「由几号转到某班」完整信息
                                const swapped = !!m.shift.originGroup && m.shift.originGroup !== g && !isRest;
                                const swapDay = m.shift.originDate ? m.shift.originDate.slice(8) : '';
                                const name = m.shift.personInCharge || '未命名';
                                return (
                                  <span
                                    key={m.shift.id}
                                    onClick={swapped ? () => showInfo(m.shift.originDate ? `该人员由 ${m.shift.originDate} 转到 ${g} 班` : `该人员由 ${originGroup} 转到 ${g} 班`) : undefined}
                                    style={NO_BLUR}
                                    className={`duty-person-chip ${swapped ? 'cursor-pointer' : ''} ${isRest ? 'duty-person-chip--rest' : isCross ? 'duty-person-chip--cross' : ''}`}>
                                    {swapped && (
                                      <span className="duty-person-role">
                                        由{swapDay}→{g}班
                                      </span>
                                    )}
                                    <span className={isRest ? 'line-through' : ''}>{name}</span>
                                    {isRest && <span className="duty-person-role">休</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
      <Modal open={showAddModal} onClose={closeAddModal} className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
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
                  <p className="text-xs text-gray-400 mt-1">支持 Excel (.xlsx / .xls) / JSON (.json)</p>
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
                    <div style={NO_BLUR} className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">值班表名</div>
                      <div className="font-medium text-gray-800 dark:text-white truncate">{importPreview.schedule.name}</div>
                    </div>
                    <div style={NO_BLUR} className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">日期范围</div>
                      <div className="font-medium text-gray-800 dark:text-white truncate">{importPreview.preview.dateRange}</div>
                    </div>
                    <div style={NO_BLUR} className="bg-white dark:bg-gray-800 rounded-lg p-2">
                      <div className="text-gray-500">总人数</div>
                      <div className="font-medium text-gray-800 dark:text-white">{importPreview.preview.totalPeople} 人</div>
                    </div>
                    <div style={NO_BLUR} className="bg-white dark:bg-gray-800 rounded-lg p-2">
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
                  {importPreview.preview.totalDrills ? (
                    <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                      演练条目：{importPreview.preview.totalDrills} 条
                    </div>
                  ) : (
                    <div className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                      未识别到演练条目：请在 Excel 中确认存在含「序号 / 演练场景」表头的演练工作表
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
                  <div className="font-medium text-gray-800 dark:text-white text-sm">从数据来源下载</div>
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
      </Modal>

      {/* 推算未来排班 */}
      <Modal open={showForecastModal} onClose={closeForecastModal} className="rounded-2xl p-5 w-full max-w-sm shadow-2xl">
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
      </Modal>

      {/* 演练名称弹窗 */}
      <Modal open={drillModalText !== null} onClose={closeDrillModal} zIndex={60} className="rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold dark:text-white">演练名称</h3>
              <button onClick={closeDrillModal} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed break-words">
              {drillModalDisplay}
            </div>
      </Modal>

      {/* 值班表切换抽屉（点击顶栏标题打开） */}
      <Modal open={showDutySheet} onClose={() => setShowDutySheet(false)} containerClassName="items-end" className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-800 dark:text-white">切换值班表</h3>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">共 {duties.length} 个值班表</p>
              </div>
              <button onClick={() => setShowDutySheet(false)} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3 overflow-y-auto space-y-2">
              {duties.map(duty => {
                const active = duty.id === currentDutyId;
                const st = dutyListStats.get(duty.id);
                return (
                  <div key={duty.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}>
                    <button onClick={() => handleSelectDuty(duty.id)} style={NO_BLUR} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate text-sm font-medium ${active ? 'text-blue-600 dark:text-blue-300' : 'text-gray-800 dark:text-gray-100'}`}>{duty.name}</span>
                        {active && <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] leading-none bg-blue-500 text-white">当前</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{st ? st.count : duty.shifts.length} 条班次 · {st ? st.people : 0} 人</div>
                    </button>
                    <button onClick={() => { setDutyToDelete(duty.id); setShowDeleteModal(true); }}
                      className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除该值班表">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                );
              })}
            </div>
      </Modal>

      {/* 删除确认 */}
      <Modal open={showDeleteModal} onClose={closeDeleteModal} className="rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold mb-2 dark:text-white">删除值班表</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">确定删除？此操作不可撤销。</p>
            <div className="flex gap-2">
              <button onClick={closeDeleteModal} className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium">取消</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">删除</button>
            </div>
      </Modal>

      {/* 长按操作面板（底部抽屉） */}
      <Modal open={showActionPanel} onClose={() => setShowActionPanel(false)} containerClassName="items-end" className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-lg font-semibold dark:text-white">操作 · {longPressDate}</h3>
              <button onClick={() => setShowActionPanel(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <button onClick={() => { setShowActionPanel(false); setDrillEditOpen(true); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white text-sm">内容改写</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">修改、新增当日卡片中的演练条目</div>
                </div>
              </button>
              <button onClick={() => { setShowActionPanel(false); setSwapTargetDate(null); setSwapPickTarget(true); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20 transition-colors">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white text-sm">人员交换</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">与另一日期的人员对调（支持多选、数量可不等）</div>
                </div>
              </button>
              <button onClick={() => { setShowActionPanel(false); setRoleEditOpen(true); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white text-sm">岗位改写</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">编辑当日值班长与岗位分工</div>
                </div>
              </button>
            </div>
      </Modal>

      {/* 内容改写：演练条目编辑 */}
      <DrillEditModal
        open={drillEditOpen}
        date={longPressDate}
        initialRows={currentDuty?.drills?.filter((d) => d.date === longPressDate) || []}
        defaultGroup={dateGroups.get(longPressDate || '')?.[0] || 'A'}
        onSave={(rows) => handleSaveDrills(longPressDate, rows)}
        onClose={() => setDrillEditOpen(false)}
      />

      {/* 岗位改写：岗位划分编辑 */}
      <RoleEditModal
        open={roleEditOpen}
        date={longPressDate}
        roles={currentDuty?.roles?.filter((r) => r.date === longPressDate) || []}
        onSave={(roles) => handleSaveRoles(longPressDate, roles)}
        onClose={() => setRoleEditOpen(false)}
      />

      {/* 人员交换：跨日期对调向导 */}
      <SwapPersonnelModal
        open={swapOpen}
        date={longPressDate}
        targetDate={swapTargetDate}
        shifts={currentDuty?.shifts || []}
        onApply={handleApplySwap}
        onClose={() => setSwapOpen(false)}
      />
    </div>
  );
};

export default DutySchedule;
