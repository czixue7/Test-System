import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useKnowledgeSummaryStore } from '../store/knowledgeSummaryStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useChatStore } from '../store/chatStore';
import { parseKnowledgeFile } from '../utils/knowledgeParser';
import { searchKnowledgeAI, classifyContentWithAI } from '../utils/knowledgeAI';
import {
  getOrCreateSummary,
  SummaryType,
  SummaryProgress,
  SummaryVersion,
  listSummaryVersions,
  getActiveSummaryId,
  activateSummaryVersion,
  deleteSummaryVersion,
} from '../utils/knowledgeSummary';
import { applyConversions, NoteConvertSettings } from '../utils/noteConverter';
import { useNoteStore } from '../store/noteStore';
import { useSettingsStore } from '../store/settingsStore';
import { apiGradingService } from '../utils/apiGradingService';
import MarkdownView from '../components/MarkdownView';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { KnowledgeSearchSource, KnowledgeItem } from '../types';

const SOURCE_OPTIONS: Array<{ value: KnowledgeSearchSource; label: string; icon: string }> = [
  { value: 'knowledge', label: '知识库', icon: '📚' },
  { value: 'questionBank', label: '题库', icon: '📝' },
  { value: 'combined', label: '综合', icon: '🔗' },
  { value: 'ai', label: '纯AI', icon: '✨' },
];

// 美化下拉选择器（带动效）
const SourceSelector: React.FC<{
  value: KnowledgeSearchSource;
  onChange: (v: KnowledgeSearchSource) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = SOURCE_OPTIONS.find((o) => o.value === value) || SOURCE_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
        <span className="text-sm leading-none">{selected.icon}</span>
        <span>{selected.label}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        className={`absolute top-full left-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden origin-top-left transition-all duration-200 z-50
          ${open ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
        {SOURCE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => { onChange(o.value); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700
              ${o.value === value ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-700 dark:text-gray-300'}`}>
            <span className="text-base leading-none">{o.icon}</span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// 分类折叠标签下的子条目列表（点击打开详情编辑页，hover 显示删除）
const ItemSubList: React.FC<{ items: KnowledgeItem[]; onDelete: (item: KnowledgeItem) => void }> = ({ items, onDelete }) => {
  const navigate = useNavigate();

  if (items.length === 0) {
    return <p className="px-6 py-2 text-xs text-gray-400">该分类下暂无内容</p>;
  }

  return (
    <div className="ml-4 border-l-2 border-gray-100 dark:border-gray-700 pb-1">
      {items.map((item) => (
        <div key={item.id} className="group flex items-center pr-2">
          <button
            onClick={() => navigate(`/knowledge-item/${item.id}`)}
            className="flex-1 min-w-0 text-left px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 truncate">
            {item.title || (item.content || '').slice(0, 20)}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-gray-400 hover:text-red-500 text-[11px]">删</button>
        </div>
      ))}
    </div>
  );
};

const KnowledgeBase: React.FC = () => {
  const navigate = useNavigate();
  const safeArea = useSafeArea();
  const { showSuccess, showError } = useToast();
  const { items, categories, loadItems, importItems, addItem, updateItem, deleteItem, addCategory, deleteCategory } = useKnowledgeStore();
  const { loadBanks: loadQuestionBanks } = useQuestionBankStore();
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const { createConversation, deleteConversation, switchConversation, addMessage, updateMessage } = useChatStore();
  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const messages = activeConversation?.messages || [];

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  // 删除确认弹窗（统一使用已有 modal-fade/pop 动效）
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: React.ReactNode; onConfirm: () => void } | null>(null);

  // 删除条目：打开确认弹窗
  const requestDeleteItem = (item: KnowledgeItem) => {
    const label = item.title || (item.content || '').slice(0, 20);
    setConfirmDialog({
      title: '删除知识条目',
      message: (
        <>
          确定删除「<span className="text-gray-800 dark:text-gray-100 font-medium">{label}</span>」？
          <br />删除后不可恢复。
        </>
      ),
      onConfirm: () => deleteItem(item.id),
    });
  };
  // 侧边栏中展开显示子条目的分类（点击分类标签切换展开，不关闭侧边栏）
  const [expandedCats, setExpandedCats] = useState<string[]>([]);
  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);
  };
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<KnowledgeSearchSource>('combined');
  const [searching, setSearching] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [chatManageOpen, setChatManageOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // 总结状态全局存储：切换 tab 卸载组件时后台生成不中断、状态不丢失
  const summaryContent = useKnowledgeSummaryStore((s) => s.summaryContent);
  const summaryProgress = useKnowledgeSummaryStore((s) => s.summaryProgress);
  const summaryViewMode = useKnowledgeSummaryStore((s) => s.summaryViewMode);
  const summaryRunning = useKnowledgeSummaryStore((s) => s.summaryRunning);
  const setSummaryContent = useKnowledgeSummaryStore((s) => s.setSummaryContent);
  const setSummaryProgress = useKnowledgeSummaryStore((s) => s.setSummaryProgress);
  const setSummaryViewMode = useKnowledgeSummaryStore((s) => s.setSummaryViewMode);
  const setSummaryRunning = useKnowledgeSummaryStore((s) => s.setSummaryRunning);
  const summaryScrollTop = useKnowledgeSummaryStore((s) => s.summaryScrollTop);
  const setSummaryScrollTop = useKnowledgeSummaryStore((s) => s.setSummaryScrollTop);
  const summaryHistory = useKnowledgeSummaryStore((s) => s.summaryHistory);
  const summaryActiveId = useKnowledgeSummaryStore((s) => s.summaryActiveId);
  const setSummaryHistory = useKnowledgeSummaryStore((s) => s.setSummaryHistory);
  const setSummaryActiveId = useKnowledgeSummaryStore((s) => s.setSummaryActiveId);
  const summaryScrollRef = useRef<HTMLDivElement>(null);
  // 准备中：弹窗已打开但内容和进度都还没出来
  const summaryLoading = summaryOpen && !summaryContent && !summaryProgress;
  // 总结类型由当前来源决定（纯 AI 以外的来源都映射为综合）
  const summaryType: SummaryType = source === 'knowledge' ? 'knowledge' : source === 'questionBank' ? 'questionBank' : 'combined';
  // 历史版本列表展开状态
  const [summaryHistoryOpen, setSummaryHistoryOpen] = useState(false);

  // 弹窗打开时恢复之前的滚动位置（全局记录，切换 tab 不丢失）
  useEffect(() => {
    if (summaryOpen && summaryScrollRef.current) {
      summaryScrollRef.current.scrollTop = summaryScrollTop;
    }
  }, [summaryOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 对话管理弹窗
  const closeChatManage = () => {
    setChatManageOpen(false);
  };

  // 知识总结弹窗
  const closeSummary = () => {
    setSummaryOpen(false);
  };

  // 导入分类选择
  const [importCategoryModalOpen, setImportCategoryModalOpen] = useState(false);
  const [newImportCategory, setNewImportCategory] = useState('');
  const pendingImportCategoryRef = useRef<string>('');

  // "帮我记"右侧边栏
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteSettingsOpen, setNoteSettingsOpen] = useState(false);

  // 转换设置弹窗
  const closeNoteSettings = () => {
    setNoteSettingsOpen(false);
  };
  const [noteText, setNoteText] = useState('');
  const [noteCategory, setNoteCategory] = useState('');
  const [noteNewCategory, setNoteNewCategory] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const convertSettings = useNoteStore((s) => s.convertSettings);
  const setConvertSettings = useNoteStore((s) => s.setConvertSettings);
  const setLastCategory = useNoteStore((s) => s.setLastCategory);
  const lastCategory = useNoteStore((s) => s.lastCategory);

  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 导入分类弹窗（关闭后可选触发文件选择）
  const closeImportCategoryModal = (thenPickFile = false) => {
    setImportCategoryModalOpen(false);
    if (thenPickFile) {
      fileRef.current?.click();
    } else {
      // 取消时清空暂存分类。
      // 旧实现只在 handleImport 的 finally 里清空，因此「选了分类 → 在系统文件
      // 对话框点取消」之后，引用里会一直留着旧分类，被下一次无关导入悄悄套用。
      pendingImportCategoryRef.current = '';
    }
  };

  // 侧边栏：开启动效
  const openSidebar = () => {
    setSidebarOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSidebarVisible(true));
    });
  };

  // 侧边栏：关闭动效（延迟卸载）
  const closeSidebar = () => {
    setSidebarVisible(false);
    setTimeout(() => setSidebarOpen(false), 280);
  };

  // "帮我记"右侧边栏：开启动效
  const openNote = () => {
    setNoteOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setNoteVisible(true));
    });
  };

  // "帮我记"右侧边栏：关闭动效（延迟卸载）
  const closeNote = () => {
    setNoteVisible(false);
    setTimeout(() => setNoteOpen(false), 280);
  };

  useEffect(() => {
    loadItems();
    loadQuestionBanks();
  }, [loadItems, loadQuestionBanks]);

  const hasMessages = messages.length > 0;

  // 对话更新时，若滚动区接近底部则自动跟随到底部（回看历史时不打扰）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 自动分类
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => { if (item.category) set.add(item.category); });
    categories.forEach((c) => set.add(c));
    return Array.from(set).sort();
  }, [items, categories]);

  // 各分类下的条目（用于侧边栏折叠标签展开显示）
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, typeof items>();
    items.forEach((item) => {
      if (!item.category) return;
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    });
    return map;
  }, [items]);

  // 未分类条目（category 为空的历史残留数据，需可显示、可删除）
  const uncategorizedItems = useMemo(() => items.filter((item) => !item.category), [items]);

  // 确保题库已加载（含内置题库与用户题库），未加载完成时等待
  const ensureBanksLoaded = async () => {
    const { isLoaded, loadBanks: doLoadBanks } = useQuestionBankStore.getState();
    if (!isLoaded) {
      await doLoadBanks();
    }
  };

  // 读取历史版本列表与当前启用项（用于历史面板）
  const refreshSummaryHistory = async () => {
    const [history, activeId] = await Promise.all([
      listSummaryVersions(summaryType),
      getActiveSummaryId(summaryType),
    ]);
    setSummaryHistory(history);
    setSummaryActiveId(activeId);
  };

  // 触发总结（首次调用生成，之后复用当前版本），返回总结内容供 AI 参考
  const triggerSummary = async (src: KnowledgeSearchSource, onProgress?: SummaryProgress): Promise<string | undefined> => {
    if (src === 'ai') return undefined;
    const type: SummaryType = src === 'knowledge' ? 'knowledge' : src === 'questionBank' ? 'questionBank' : 'combined';
    try {
      await ensureBanksLoaded();
      // 总结函数内部会实时读取 store 最新题库/知识库数据
      const result = await getOrCreateSummary(type, undefined, undefined, onProgress);
      return result.content;
    } catch (err) {
      console.warn('[知识库] 总结生成失败:', err);
      return undefined;
    }
  };

  // 启动一次总结生成（调用方负责判断「确实需要生成」）
  const startSummaryGeneration = async () => {
    if (summaryRunning) return; // 后台正在生成，等待进度/结果更新
    if (summaryProgress) return;
    setSummaryRunning(true);
    // 立即设置初始进度并切换到进度视图，避免"准备中"过久
    setSummaryProgress({ done: 0, total: 0, phase: 'split' });
    setSummaryViewMode('progress');
    try {
      await ensureBanksLoaded();
      // 总结函数内部会实时读取 store 最新题库/知识库数据
      const result = await getOrCreateSummary(summaryType, undefined, undefined, (done, total, phase) => {
        setSummaryProgress({ done, total, phase });
      });
      setSummaryContent(result.content);
      setSummaryProgress(null);
      setSummaryViewMode('content');
      await refreshSummaryHistory();
    } catch (err) {
      setSummaryContent(`总结生成失败：${err instanceof Error ? err.message : '未知错误'}`);
      setSummaryProgress(null);
    } finally {
      setSummaryRunning(false);
    }
  };

  // 查看/生成知识总结（弹窗展示，供用户参考）
  // 关闭弹窗/切换 tab 不中断后台生成；重新打开时：有文档显示文档，有进度显示进度，都没有才开始生成
  const handleViewSummary = async () => {
    if (summaryOpen) {
      closeSummary();
      return;
    }
    setSummaryOpen(true);
    // 保留全局 store 中的 summaryContent / summaryProgress，不清空
    if (summaryContent || summaryProgress || summaryRunning) return; // 已有文档 / 有进度 / 正在跑
    await startSummaryGeneration();
  };

  // 弹窗已打开、但既没有文档也没有进度、也没有在跑的生成任务时，主动补一次生成。
  // 旧实现只在 handleViewSummary 里判断一次：如果在「搜索触发的总结」进行中打开弹窗，
  // 那次判断会因为存在 summaryProgress 直接 return（而该路径并不会设置 summaryRunning），
  // 等搜索结束在 finally 里把进度清空后，弹窗就永久停在「准备中...」。
  useEffect(() => {
    if (!summaryOpen) return;
    if (summaryContent || summaryProgress || summaryRunning) return;
    void startSummaryGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryOpen, summaryContent, summaryProgress, summaryRunning]);

  // 弹窗打开（或来源切换）时读取历史版本列表
  useEffect(() => {
    if (!summaryOpen) return;
    void refreshSummaryHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryOpen, summaryType]);

  // 重新生成知识总结（用户主动触发：归档为新版本，旧版本保留）
  // 重新生成期间保留旧文档可查看；按钮在"查看进度"/"查看文档"间切换，点击切换显示模式
  const handleRegenerateSummary = () => {
    if (summaryProgress) {
      // 正在生成：切换查看模式（旧文档 ↔ 进度动画）
      setSummaryViewMode(summaryViewMode === 'content' ? 'progress' : 'content');
      return;
    }
    if (summaryRunning) return;
    // 重新生成：保留旧文档（不清空 summaryContent），立即显示进度动画，后台生成新总结
    setSummaryProgress({ done: 0, total: 0, phase: 'split' });
    setSummaryViewMode('progress');
    setSummaryScrollTop(0);
    setSummaryRunning(true);
    (async () => {
      try {
        await ensureBanksLoaded();
        const result = await getOrCreateSummary(summaryType, undefined, undefined, (done, total, phase) => {
          setSummaryProgress({ done, total, phase });
        }, true);
        setSummaryContent(result.content);
        setSummaryProgress(null);
        setSummaryViewMode('content');
        await refreshSummaryHistory();
      } catch (err) {
        setSummaryContent(`重新生成失败：${err instanceof Error ? err.message : '未知错误'}`);
        setSummaryProgress(null);
      } finally {
        setSummaryRunning(false);
      }
    })();
  };

  // 调用某个历史版本（仅切换启用项，不重新生成、不消耗 AI）
  const handleSwitchSummaryVersion = async (id: string) => {
    const entry = await activateSummaryVersion(summaryType, id);
    if (!entry) return;
    setSummaryContent(entry.content);
    setSummaryActiveId(id);
    setSummaryViewMode('content');
    setSummaryScrollTop(0);
    setSummaryHistoryOpen(false);
  };

  // 删除某个历史版本（用户主动删除）
  const handleDeleteSummaryVersion = async (id: string) => {
    // 先判断被删的是不是当前展示的版本，await 之后 state 可能已更新
    const wasDisplayed = id === summaryActiveId;
    const { history, activeId } = await deleteSummaryVersion(summaryType, id);
    setSummaryHistory(history);
    setSummaryActiveId(activeId);
    // 若删除的是当前展示版本，回退到新的当前版本；已无剩余版本则清空（下次查看会自动生成）
    if (wasDisplayed) {
      const next = history.find((h) => h.id === activeId);
      setSummaryContent(next ? next.content : '');
      setSummaryViewMode('content');
    }
  };

  const handleImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const category = pendingImportCategoryRef.current;
    try {
      const drafts = await parseKnowledgeFile(files[0]);
      // 用户选择的分类优先，覆盖文件解析时的自动分类
      const withCategory = category
        ? drafts.map((d) => ({ ...d, category }))
        : drafts;
      const count = importItems(withCategory);
      showSuccess(`成功导入 ${count} 篇知识内容${category ? `（分类：${category}）` : ''}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '导入失败');
    } finally {
      pendingImportCategoryRef.current = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setQuery('');
    setSearching(true);

    addMessage({ role: 'user', content: q, source });
    const assistantId = addMessage({ role: 'assistant', content: '', source });

    try {
      // 优先生成/获取题库与知识库总结，作为 AI 回答的完整上下文
      const summary = await triggerSummary(source, (done, total, phase) => {
        setSummaryProgress({ done, total, phase });
      });

      let accumulated = '';
      await searchKnowledgeAI(q, source, (chunk) => {
        accumulated += chunk;
        updateMessage(assistantId, accumulated);
      }, summary);
      if (!accumulated) {
        updateMessage(assistantId, '(未获取到解答内容)');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解答失败';
      updateMessage(assistantId, `解答失败：${msg}`);
      showError(msg);
    } finally {
      setSearching(false);
      setSummaryProgress(null);
      // 搜索过程中可能自动生成并归档了新版本，刷新历史面板保持一致
      void refreshSummaryHistory();
    }
  };

  // 对话管理辅助
  const handleNewConversation = () => {
    createConversation();
    closeChatManage();
  };

  const handleSwitchConversation = (id: string) => {
    switchConversation(id);
    closeChatManage();
  };

  const handleDeleteConversation = (id: string) => {
    deleteConversation(id);
  };

  // 会话时间显示
  const formatConversationTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    addCategory(name);
    setNewCategory('');
  };

  // "帮我记"：记录追加到分类的汇总条目（每分类一个条目，不重复新建）
  // 已存在该分类的汇总条目（kind==='note'）时追加新记录，否则新建一个
  const appendNoteToCategory = (category: string, content: string): string => {
    const target = items.find((i) => i.category === category && i.kind === 'note');
    const d = new Date();
    const stamp = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (target) {
      updateItem(target.id, {
        content: `${target.content}\n\n---\n\n### ${stamp}\n${content}`,
      });
      return target.id;
    }
    const id = addItem({ title: `${category}笔记`, category, content, kind: 'note' });
    return id;
  };

  // "帮我记"：识别转换并保存（有文本）
  const handleSaveNote = async () => {
    const raw = noteText.trim();
    if (!raw) {
      showError('请先粘贴要记录的内容');
      return;
    }
    setNoteBusy(true);
    try {
      // 1. 应用转换规则
      const content = applyConversions(raw, convertSettings);

      // 2. 分类：用户手动选择优先，未选择时调用 AI 自动识别
      let category = (noteCategory || noteNewCategory.trim() || '').trim();
      let aiClassified = false;
      if (!category) {
        const config = useSettingsStore.getState();
        if (config.apiKey) {
          try {
            const aiCat = await classifyContentWithAI(content, allCategories);
            if (aiCat) {
              category = aiCat;
              aiClassified = true;
            }
          } catch (e) {
            console.warn('[帮我记] AI 分类失败，回退未分类:', e);
          }
        }
        if (!category) category = '未分类';
      }

      // 3. 追加到对应分类的汇总条目（不存在则新建）
      if (!allCategories.includes(category)) addCategory(category);
      appendNoteToCategory(category, content);
      setLastCategory(category);
      showSuccess(aiClassified ? `该内容已识别为「${category}」分类并追加记录` : `已追加到「${category}」的汇总条目`);
      setNoteText('');
      setNoteCategory('');
      setNoteNewCategory('');
      closeNote();
    } finally {
      setNoteBusy(false);
    }
  };

  // "帮我记"：无文本时让 AI 按分类撰写并保存
  const handleAiWrite = async () => {
    const category = (noteCategory || noteNewCategory.trim() || '').trim();
    const config = useSettingsStore.getState();
    if (!config.apiKey) {
      showError('请先在「我的 → 设置」中配置 API Key');
      return;
    }
    apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel, endpoint: config.apiEndpoint });
    setNoteBusy(true);
    try {
      const prompt = category
        ? `你是数据中心运维知识库的撰写助手。请撰写一篇关于「${category}」的运维知识笔记。

要求：
1. 第一行输出标题，以 # 开头（如：# ${category}运维要点）；
2. 正文使用 Markdown 格式，包含关键要点、操作规范、常见注意事项、易错点；
3. 内容专业、准确、实用，面向数据中心一线运维人员；
4. 篇幅 300-600 字。`
        : `你是数据中心运维知识库的撰写助手。请撰写一篇数据中心运维知识笔记。

要求：
1. 第一行输出标题，以 # 开头；
2. 正文使用 Markdown 格式，包含关键要点、操作规范、常见注意事项、易错点；
3. 内容专业、准确、实用，面向数据中心一线运维人员，主题自选（如配电、暖通、消防、安防等任一方向）；
4. 篇幅 300-600 字。`;
      const result = await apiGradingService.callAPI(prompt, 2000);
      const trimmed = (result || '').trim();
      if (!trimmed) throw new Error('AI 未返回内容');
      const content = trimmed;

      // 分类：用户选择优先，否则 AI 识别
      let finalCategory = category;
      let aiClassified = false;
      if (!finalCategory) {
        try {
          const aiCat = await classifyContentWithAI(content, allCategories);
          if (aiCat) { finalCategory = aiCat; aiClassified = true; }
        } catch (e) {
          console.warn('[帮我记] AI 分类失败，回退未分类:', e);
        }
        if (!finalCategory) finalCategory = '未分类';
      }

      // 追加到对应分类的汇总条目（不存在则新建）
      if (!allCategories.includes(finalCategory)) addCategory(finalCategory);
      appendNoteToCategory(finalCategory, content);
      setLastCategory(finalCategory);
      showSuccess(aiClassified ? `该内容已识别为「${finalCategory}」分类并追加记录` : `AI 内容已追加到「${finalCategory}」的汇总条目`);
      setNoteText('');
      setNoteCategory('');
      setNoteNewCategory('');
      closeNote();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setNoteBusy(false);
    }
  };

  // 已开启的转换规则描述（用于面板底部提示）
  const activeConversions = useMemo(() => {
    const list: string[] = [];
    if (convertSettings.chineseToNumber) list.push('汉字转数字（叁→3）');
    if (convertSettings.lowerToUpper) list.push('小写转大写（abc→ABC）');
    if (convertSettings.removeSpaces) list.push('去除空格');
    return list;
  }, [convertSettings]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden" style={{ paddingTop: safeArea.top + 36, paddingBottom: safeArea.bottom + 70 }}>
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="relative max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={openSidebar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300" title="内容分类">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 14h6v6H4z" /></svg>
            </button>
            <button onClick={handleViewSummary} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300" title="查看知识总结">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </button>
          </div>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-800 dark:text-white pointer-events-none">知识库</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setChatManageOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300" title="对话管理">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m-2-2h4" /></svg>
            </button>
            <button onClick={openNote} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300" title="帮我记">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
            <button onClick={() => { pendingImportCategoryRef.current = ''; setNewImportCategory(''); setImportCategoryModalOpen(true); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300" title="导入知识内容（txt/markdown）">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".txt,.md" className="hidden" onChange={(e) => handleImport(e.target.files)} />
        </div>
      </header>

      {/* 左侧分类抽屉：全屏遮罩 + 侧边栏面板 */}
      {sidebarOpen && (
        <div
          className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={closeSidebar} />
      )}
      {sidebarOpen && (
        <div className={`fixed left-0 top-0 bottom-0 z-50 w-64 bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden transition-transform duration-300 ease-out ${sidebarVisible ? 'translate-x-0' : '-translate-x-full'}`} style={{ paddingTop: safeArea.top }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="font-medium text-gray-800 dark:text-white">内容分类</span>
            <button onClick={closeSidebar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

            <div className="flex-1 overflow-y-auto py-2">
              {/* 全部条目：折叠标签 */}
              <div>
                <button
                  onClick={() => toggleCat('__all__')}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between ${expandedCats.includes('__all__') ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                  <span className="flex items-center gap-1.5">
                    <svg className={`w-3.5 h-3.5 transition-transform ${expandedCats.includes('__all__') ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    全部条目
                  </span>
                  <span className="text-xs text-gray-400">{items.length}</span>
                </button>
                {expandedCats.includes('__all__') && (
                  <ItemSubList items={items} onDelete={requestDeleteItem} />
                )}
              </div>

              {/* 未分类残留条目：固定入口 */}
              {uncategorizedItems.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleCat('__uncategorized__')}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between ${expandedCats.includes('__uncategorized__') ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    <span className="flex items-center gap-1.5">
                      <svg className={`w-3.5 h-3.5 transition-transform ${expandedCats.includes('__uncategorized__') ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      未分类（残留）
                    </span>
                    <span className="text-xs text-gray-400">{uncategorizedItems.length}</span>
                  </button>
                  {expandedCats.includes('__uncategorized__') && (
                    <ItemSubList items={uncategorizedItems} onDelete={requestDeleteItem} />
                  )}
                </div>
              )}

              {allCategories.length === 0 && uncategorizedItems.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400 text-center">暂无内容</p>
              ) : (
                allCategories.map((cat) => {
                  const catItems = itemsByCategory.get(cat) || [];
                  const expanded = expandedCats.includes(cat);
                  return (
                    <div key={cat} className="group">
                      <div className="flex items-center">
                        <button
                          onClick={() => toggleCat(cat)}
                          className={`flex-1 text-left px-4 py-2.5 text-sm flex items-center justify-between ${expanded ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          <span className="flex items-center gap-1.5">
                            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            {cat}
                          </span>
                          <span className="text-xs text-gray-400">{catItems.length}</span>
                        </button>
                        <button
                          onClick={() => {
                            const count = catItems.length;
                            if (count > 0) {
                              setConfirmDialog({
                                title: '删除分类',
                                message: (
                                  <>
                                    确定删除「<span className="text-gray-800 dark:text-gray-100 font-medium">{cat}</span>」分类？
                                    <br />该分类下有 <span className="text-red-500 font-medium">{count}</span> 条内容，删除分类后这些内容将变为未分类（可在「未分类（残留）」中查看）。
                                  </>
                                ),
                                onConfirm: () => deleteCategory(cat),
                              });
                              return;
                            }
                            deleteCategory(cat);
                          }}
                          className="opacity-0 group-hover:opacity-100 px-2 py-1 text-gray-400 hover:text-red-500 text-xs">删</button>
                      </div>
                      {expanded && (
                        <ItemSubList items={catItems} onDelete={requestDeleteItem} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 p-3">
              <div className="flex gap-2">
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="新分类名"
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button onClick={handleAddCategory} className="flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg">添加</button>
              </div>
            </div>
          </div>
      )}
      {/* 主内容区：搜索框固定置顶，对话记录独立滚动 */}
      <div className="max-w-lg mx-auto w-full flex-1 flex flex-col min-h-0 px-4">
        {/* 搜索框（固定区域，不随对话滚动） */}
        <div className={`flex-shrink-0 transition-all duration-500 ease-in-out ${hasMessages ? 'pt-3' : 'pt-[26vh]'}`}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); }
              }}
              placeholder="输入问题，搜索知识库..."
              rows={hasMessages ? 1 : 3}
              className="w-full px-4 pt-3 text-sm text-gray-800 dark:text-white bg-transparent focus:outline-none resize-none placeholder-gray-400" />
            <div className="flex items-center gap-2 px-3 pb-3">
              <SourceSelector value={source} onChange={setSource} />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {searching
                  ? summaryProgress
                    ? summaryProgress.phase === 'merge'
                      ? '正在整合总结...'
                      : `正在总结 (${summaryProgress.done}/${summaryProgress.total})...`
                    : '解答中...'
                  : '搜索'}
              </button>
            </div>
          </div>
        </div>

        {/* 滚动区：对话记录 / 知识库内容列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-3" ref={listRef}>

        {/* 对话记录 */}
        {hasMessages && (
          <div className="mt-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words
                  ${m.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-sm whitespace-pre-wrap'
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-bl-sm'}`}>
                  {m.role === 'assistant' && m.content ? (
                    <MarkdownView content={m.content} />
                  ) : (
                    m.content
                  )}
                  {m.role === 'assistant' && searching && m.content === '' && (
                    <span className="inline-flex items-center gap-2 text-gray-400">
                      <span className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      思考中...
                    </span>
                  )}
                  {m.role === 'assistant' && searching && m.content !== '' && (
                    <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        </div>
      </div>

      {/* 对话管理弹窗 */}
      <Modal open={chatManageOpen} onClose={closeChatManage} containerClassName="items-end sm:items-center" className="w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">对话管理</h3>
              <button onClick={closeChatManage} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-400">
                  暂无对话记录<br />
                  <span className="text-xs">提问后将自动创建新的对话</span>
                </div>
              ) : (
                conversations.map((c) => (
                  <div key={c.id} className={`flex items-center gap-2 px-4 py-3 border-b border-gray-50 dark:border-gray-700/60 ${c.id === activeConversationId ? 'bg-blue-50/70 dark:bg-blue-900/30' : ''}`}>
                    <button
                      onClick={() => handleSwitchConversation(c.id)}
                      className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-gray-800 dark:text-white truncate">{c.title || '新对话'}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatConversationTime(c.updatedAt)} · {c.messages.length} 条消息
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteConversation(c.id)}
                      className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="删除该对话">
                      <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={handleNewConversation}
                className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors">
                新建对话
              </button>
            </div>
      </Modal>

      {/* 知识总结弹窗 */}
      <Modal open={summaryOpen} onClose={closeSummary} className="mt-12 w-full max-w-lg max-h-[75vh] flex flex-col rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
                知识总结
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSummaryHistoryOpen((o) => !o)}
                  className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg border ${summaryHistoryOpen ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                  title="历史版本">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <button
                  onClick={handleRegenerateSummary}
                  disabled={summaryLoading && !summaryProgress}
                  className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap px-2.5 h-8 text-xs text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                  title={summaryProgress ? (summaryViewMode === 'content' ? '查看当前生成进度' : '返回查看文档') : '重新生成并归档为新版本'}>
                  <svg className={`w-4 h-4 ${summaryProgress ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                  {summaryProgress ? (summaryViewMode === 'content' ? '查看进度' : '查看文档') : '重新生成'}
                </button>
                <button
                  onClick={closeSummary}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            {summaryHistoryOpen && (
              <div className="mb-3 flex-shrink-0 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-700/40">
                  历史版本（共 {summaryHistory.length} 个 · 点击调用，右侧删除）
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                  {summaryHistory.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-400 text-center">暂无历史版本</div>
                  ) : (
                    [...summaryHistory].reverse().map((v, i) => {
                      const ordinal = summaryHistory.length - i;
                      return (
                        <div key={v.id} className={`flex items-center gap-2 px-3 py-2 ${v.id === summaryActiveId ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <button
                            onClick={() => handleSwitchSummaryVersion(v.id)}
                            className="flex-1 min-w-0 text-left text-xs text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400"
                            title="调用该版本">
                            <span className="font-medium">第 {ordinal} 版</span>
                            <span className="ml-2 text-gray-400">规则 {v.version}</span>
                            <span className="ml-2 text-gray-400">{new Date(v.createdAt).toLocaleString()}</span>
                            {v.id === summaryActiveId && <span className="ml-2 text-blue-600 dark:text-blue-400">当前</span>}
                          </button>
                          <button
                            onClick={() => handleDeleteSummaryVersion(v.id)}
                            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="删除该版本">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            <div
              ref={summaryScrollRef}
              onScroll={(e) => setSummaryScrollTop(e.currentTarget.scrollTop)}
              className="summary-scroll-area flex-1 overflow-y-auto">
              {summaryProgress && summaryViewMode === 'progress' ? (
                <div className="py-6 px-2">
                  {/* 阶段标识 */}
                  <div className="flex items-center justify-center gap-1.5 mb-4 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-full ${summaryProgress.phase === 'split' ? 'bg-blue-500 text-white' : summaryProgress.phase === 'summarize' || summaryProgress.phase === 'merge' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-700'}`}>① 拆份</span>
                    <span className="text-gray-300 dark:text-gray-600">→</span>
                    <span className={`px-2 py-0.5 rounded-full ${summaryProgress.phase === 'summarize' ? 'bg-blue-500 text-white' : summaryProgress.phase === 'merge' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-700'}`}>② 逐份总结</span>
                    <span className="text-gray-300 dark:text-gray-600">→</span>
                    <span className={`px-2 py-0.5 rounded-full ${summaryProgress.phase === 'merge' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-700'}`}>③ 合并</span>
                  </div>
                  {/* 进度条 */}
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${summaryProgress.phase === 'merge' ? 100 : Math.round((summaryProgress.done / Math.max(summaryProgress.total, 1)) * 100)}%` }}
                    />
                  </div>
                  {/* 直白文案 */}
                  <div className="text-center text-sm text-gray-600 dark:text-gray-300">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      {summaryProgress.phase === 'merge'
                        ? `${summaryProgress.total} 份总结已生成，正在合并...`
                        : summaryProgress.total === 0
                          ? '正在分析内容...'
                          : summaryProgress.done === 0
                            ? `内容已分为 ${summaryProgress.total} 份，即将开始总结...`
                            : `正在总结第 ${summaryProgress.done} 份内容（共 ${summaryProgress.total} 份）`}
                    </span>
                  </div>
                </div>
              ) : summaryContent ? (
                <MarkdownView content={summaryContent} className="text-gray-700 dark:text-gray-200" />
              ) : (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">准备中...</div>
              )}
            </div>
      </Modal>

      {/* 导入分类选择弹窗 */}
      <Modal open={importCategoryModalOpen} onClose={() => closeImportCategoryModal()} className="w-full max-w-sm rounded-2xl p-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white mb-3">选择导入分类</h2>

            {allCategories.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      pendingImportCategoryRef.current = cat;
                      closeImportCategoryModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-4 mb-3">暂无分类，请新建分类</p>
            )}

            {/* 新建分类 */}
            <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
              <input
                type="text"
                value={newImportCategory}
                onChange={(e) => setNewImportCategory(e.target.value)}
                placeholder="输入新分类名称"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newImportCategory.trim()) {
                    const name = newImportCategory.trim();
                    addCategory(name);
                    pendingImportCategoryRef.current = name;
                    setNewImportCategory('');
                    closeImportCategoryModal(true);
                  }
                }}
              />
              <button
                onClick={() => {
                  const name = newImportCategory.trim();
                  if (!name) return;
                  addCategory(name);
                  pendingImportCategoryRef.current = name;
                  setNewImportCategory('');
                  closeImportCategoryModal(true);
                }}
                disabled={!newImportCategory.trim()}
                className="flex-shrink-0 px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                新建
              </button>
            </div>

            <button
              onClick={() => closeImportCategoryModal()}
              className="w-full mt-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              取消
            </button>
      </Modal>

      {/* "帮我记"右侧边栏：全屏遮罩 + 右侧面板 */}
      {noteOpen && (
        <div
          className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ${noteVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={closeNote} />
      )}
      {noteOpen && (
        <div className={`fixed right-0 top-0 bottom-0 z-50 w-72 max-w-[85vw] bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden transition-transform duration-300 ease-out ${noteVisible ? 'translate-x-0' : 'translate-x-full'}`} style={{ paddingTop: safeArea.top, paddingBottom: safeArea.bottom }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800 dark:text-white">帮我记</span>
              <button
                onClick={() => setNoteSettingsOpen(true)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-300"
                title="转换设置">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
            </div>
            <button onClick={closeNote} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* 分类选择 */}
          <div className="px-4 pt-3">
            <div className="text-xs text-gray-400 mb-1.5">保存到分类</div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {allCategories.length === 0 && !noteNewCategory.trim() && (
                <span className="text-xs text-gray-400 py-1">暂无分类，请在下方新建</span>
              )}
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setNoteCategory(noteCategory === cat ? '' : cat)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors flex-shrink-0
                    ${noteCategory === cat
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300'}`}>
                  {cat}
                </button>
              ))}
            </div>
            <input
              value={noteNewCategory}
              onChange={(e) => { setNoteNewCategory(e.target.value); setNoteCategory(''); }}
              placeholder="新建分类名（可选）"
              className="mt-2 w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400" />
          </div>

          {/* 文本输入区 */}
          <div className="flex-1 min-h-0 px-4 pt-3 pb-2 flex flex-col">
            <div className="text-xs text-gray-400 mb-1.5">粘贴识别/记录的内容（留空则让 AI 撰写；不选分类时 AI 自动识别分类）</div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={'例如：叁号机柜 UPS 容量 500KVA，备注 pdu 供电正常'}
              className="flex-1 min-h-0 w-full p-3 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>

          {/* 已开启转换提示 */}
          {activeConversions.length > 0 ? (
            <div className="px-4 pb-2">
              <div className="text-[11px] text-gray-400">
                转换已开启：{activeConversions.join('、')}
              </div>
            </div>
          ) : (
            <div className="px-4 pb-2">
              <button
                onClick={() => setNoteSettingsOpen(true)}
                className="text-[11px] text-amber-500 hover:text-amber-600">
                ⚠ 未开启转换规则，内容将原样保存（点击开启）
              </button>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
            {noteText.trim() ? (
              <button
                onClick={handleSaveNote}
                disabled={noteBusy}
                className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
                {noteBusy ? '处理中...' : '识别转换并保存'}
              </button>
            ) : (
              <button
                onClick={handleAiWrite}
                disabled={noteBusy}
                className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
                {noteBusy ? 'AI 撰写中...' : '让 AI 帮我写'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* "帮我记"转换设置弹窗 */}
      <Modal open={noteSettingsOpen} onClose={closeNoteSettings} zIndex={60} className="w-full max-w-sm rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-800 dark:text-white">转换设置</h3>
              <button onClick={closeNoteSettings} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-3">
              {([
                ['chineseToNumber', '汉字转数字', '叁 → 3（用于识别文本中的大写中文数字）'],
                ['lowerToUpper', '小写转大写', 'abc → ABC（英文小写字母转大写）'],
                ['removeSpaces', '去除空格', '移除半角/全角空格（保留换行）'],
              ] as Array<[keyof NoteConvertSettings, string, string]>).map(([key, label, desc]) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={convertSettings[key]}
                    onChange={(e) => setConvertSettings({ ...convertSettings, [key]: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-blue-500" />
                  <span className="flex-1">
                    <span className="block text-sm text-gray-800 dark:text-white">{label}</span>
                    <span className="block text-xs text-gray-400 mt-0.5">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={closeNoteSettings}
              className="w-full mt-4 py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors">
              完成
            </button>
      </Modal>

      {/* 底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg dark:bg-gray-800 dark:border-gray-700" style={{ paddingBottom: safeArea.bottom }}>
        <div className="max-w-lg mx-auto flex justify-around py-0.5">
          <button onClick={() => navigate('/')} className="flex flex-col items-center py-1 px-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            <span className="text-xs mt-0.5">首页</span>
          </button>
          <button onClick={() => navigate('/duty')} className="flex flex-col items-center py-1 px-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-xs mt-0.5">值班表</span>
          </button>
          <button className="flex flex-col items-center py-1 px-4 text-blue-600 dark:text-blue-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
            <span className="text-xs mt-0.5 font-medium">知识库</span>
          </button>
          <button onClick={() => navigate('/profile')} className="flex flex-col items-center py-1 px-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs mt-0.5">我的</span>
          </button>
        </div>
      </nav>

      {/* 删除确认弹窗（复用已有 modal-fade/pop 动效） */}
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message}
        onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
};

export default KnowledgeBase;
