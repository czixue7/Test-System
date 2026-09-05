import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useChatStore } from '../store/chatStore';
import { parseKnowledgeFile } from '../utils/knowledgeParser';
import { searchKnowledgeAI } from '../utils/knowledgeAI';
import { getOrCreateSummary, SummaryType } from '../utils/knowledgeSummary';
import { KnowledgeSearchSource } from '../types';

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

const KnowledgeBase: React.FC = () => {
  const navigate = useNavigate();
  const safeArea = useSafeArea();
  const { showSuccess, showError } = useToast();
  const { items, categories, loadItems, importItems, deleteItem, addCategory, deleteCategory } = useKnowledgeStore();
  const { banks, loadBanks } = useQuestionBankStore();
  const { messages, addMessage, updateMessage, clearMessages } = useChatStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<KnowledgeSearchSource>('combined');
  const [searching, setSearching] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [clearingChat, setClearingChat] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    loadItems();
    loadBanks();
  }, [loadItems, loadBanks]);

  const hasMessages = messages.length > 0;

  // 自动分类
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => { if (item.category) set.add(item.category); });
    categories.forEach((c) => set.add(c));
    return Array.from(set).sort();
  }, [items, categories]);

  const categoryCount = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const key = item.category || '未分类';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!selectedCategory) return items;
    return items.filter((item) => item.category === selectedCategory);
  }, [items, selectedCategory]);

  // 触发总结（首次调用生成，之后复用缓存），返回总结内容供 AI 参考
  const triggerSummary = async (src: KnowledgeSearchSource): Promise<string | undefined> => {
    if (src === 'ai') return undefined;
    const type: SummaryType = src === 'knowledge' ? 'knowledge' : src === 'questionBank' ? 'questionBank' : 'combined';
    try {
      const result = await getOrCreateSummary(type, items, banks);
      return result.content;
    } catch (err) {
      console.warn('[知识库] 总结生成失败:', err);
      return undefined;
    }
  };

  const handleImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const drafts = await parseKnowledgeFile(files[0]);
      const count = importItems(drafts);
      showSuccess(`成功导入 ${count} 篇知识内容`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '导入失败');
    }
    if (fileRef.current) fileRef.current.value = '';
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
      const summary = await triggerSummary(source);

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
    }
  };

  // 清空对话（带退出动效）
  const handleClearMessages = () => {
    if (clearingChat) return;
    setClearingChat(true);
    setTimeout(() => {
      clearMessages();
      setClearingChat(false);
    }, 300);
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    addCategory(name);
    setNewCategory('');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" style={{ paddingTop: safeArea.top + 44, paddingBottom: safeArea.bottom + 70 }}>
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="max-w-lg mx-auto px-4 h-11 flex items-center justify-between">
          <button onClick={openSidebar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <h1 className="text-base font-semibold text-gray-800 dark:text-white">知识库</h1>
          <div className="flex items-center gap-1">
            {hasMessages && (
              <button onClick={handleClearMessages} disabled={clearingChat} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300 disabled:opacity-40" title="清空对话">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
            <button onClick={() => fileRef.current?.click()} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.json,.txt,.md" className="hidden" onChange={(e) => handleImport(e.target.files)} />
        </div>
      </header>

      {/* 左侧分类抽屉 */}
      {sidebarOpen && (
        <div className={`fixed inset-0 z-50 flex transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0'}`} style={{ paddingTop: safeArea.top }}>
          <div className={`w-64 h-full bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden transition-transform duration-300 ease-out ${sidebarVisible ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <span className="font-medium text-gray-800 dark:text-white">内容分类</span>
              <button onClick={closeSidebar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <button
                onClick={() => { setSelectedCategory(''); closeSidebar(); }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between ${selectedCategory === '' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                <span>全部</span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </button>

              {allCategories.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400">暂无分类，导入知识内容后自动按专业领域分类</p>
              ) : (
                allCategories.map((cat) => (
                  <div key={cat} className="group flex items-center">
                    <button
                      onClick={() => { setSelectedCategory(cat); closeSidebar(); }}
                      className={`flex-1 text-left px-4 py-2.5 text-sm flex items-center justify-between ${selectedCategory === cat ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      <span>{cat}</span>
                      <span className="text-xs text-gray-400">{categoryCount.get(cat) || 0}</span>
                    </button>
                    <button
                      onClick={() => deleteCategory(cat)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-gray-400 hover:text-red-500 text-xs">删</button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 p-3">
              <div className="flex gap-2">
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="新分类名"
                  className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button onClick={handleAddCategory} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg">添加</button>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-black/40" onClick={closeSidebar} />
        </div>
      )}

      {/* 主内容区 */}
      <div className={`max-w-lg mx-auto px-4 transition-all duration-500 ease-in-out ${hasMessages ? 'pt-3' : 'pt-[26vh]'}`}>
        {/* 搜索框 */}
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
              {searching ? '解答中...' : '搜索'}
            </button>
          </div>
        </div>

        {/* 对话记录 */}
        {hasMessages && (
          <div className={`mt-4 space-y-3 transition-all duration-300 ${clearingChat ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`} ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed break-words
                  ${m.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-sm'
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-bl-sm'}`}>
                  {m.content}
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

        {/* 知识库内容列表（选中分类时，且无对话） */}
        {!hasMessages && selectedCategory && (
          <div className="mt-4 space-y-2">
            {filteredItems.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">该分类下暂无内容</p>
            ) : (
              filteredItems.map((item) => (
                <div key={item.id} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-start justify-between">
                    <div className="font-medium text-sm text-gray-800 dark:text-white">{item.title}</div>
                    <button onClick={() => deleteItem(item.id)} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0 ml-2">删除</button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-3">{item.content}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

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
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
            <span className="text-xs mt-0.5 font-medium">知识库</span>
          </button>
          <button onClick={() => navigate('/profile')} className="flex flex-col items-center py-1 px-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs mt-0.5">我的</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default KnowledgeBase;
