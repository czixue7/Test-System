import React, { useState, useEffect, useMemo } from 'react';
import { useBackNavigation } from '../hooks/useBackNavigation';
import { useNavigate, useParams } from 'react-router-dom';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { useKnowledgeStore } from '../store/knowledgeStore';
import ConfirmDialog from '../components/ConfirmDialog';
import SafeMarkdownView from '../components/SafeMarkdownView';

/**
 * 超长文档分段：先按二级标题切段，再把小段合并成约 3000 字的块。
 * 手机上一次性渲染两万多像素高的整篇文档会让 WebView 卡死甚至整页空白，
 * 分段后可以逐块渲染，首屏只挂载第一块。
 */
function splitIntoSections(markdown: string): string[] {
  const parts = markdown.split(/\n(?=##\s)/);
  const blocks: string[] = [];
  let buffer = '';
  for (const part of parts) {
    if (buffer && buffer.length + part.length > 3000) {
      blocks.push(buffer);
      buffer = part;
    } else {
      buffer = buffer ? `${buffer}\n${part}` : part;
    }
  }
  if (buffer) blocks.push(buffer);
  return blocks;
}

const KnowledgeItemView: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const safeArea = useSafeArea();
  const { showSuccess, showError } = useToast();
  const { items, categories, loadItems, updateItem, deleteItem, addCategory } = useKnowledgeStore();

  /**
   * 知识条目 id 可能是「同步来源地址:条目id」，地址里带冒号、斜杠甚至百分号编码。
   * 路由参数只保留一段，因此比较时统一解码，兼容原始地址与已编码的两种存储形式。
   */
  const decodeId = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const routeId = decodeId(id || '');
  const item = items.find((i) => i.id === id || decodeId(i.id) === routeId);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  // md 文档默认按渲染结果查看，需要改内容时再切到编辑
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  // 长文档分段渲染：默认只挂载第一段，点“继续阅读”再逐段加载
  const [visibleSections, setVisibleSections] = useState(1);
  // 分类以胶囊标签展示，加号展开输入框新增；新增项先留在本地，保存时再入库
  const [addingCategory, setAddingCategory] = useState(false);
  const [draftCategory, setDraftCategory] = useState('');
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const sections = useMemo(
    () => (content.trim() ? splitIntoSections(content) : []),
    [content],
  );

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setCategory(item.category);
      setContent(item.content);
    }
  }, [item]);

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center" style={{ paddingTop: safeArea.top }}>
        <p className="text-sm text-gray-400 mb-4">未找到该知识条目</p>
        <button
          onClick={() => navigate('/placeholder')}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg">
          返回知识库
        </button>
      </div>
    );
  }

  const allCategories = Array.from(new Set([
    ...categories,
    ...items.map((i) => i.category).filter(Boolean),
    ...newCategories,
  ])).sort();
  // 已入库的分类（不含本次临时新增），保存时据此判断是否需要登记
  const savedCategories = new Set([...categories, ...items.map((i) => i.category).filter(Boolean)]);

  // 确认新增分类：留空或重复则直接收起，否则加入本地列表并选中
  const commitNewCategory = () => {
    const name = draftCategory.trim();
    if (name && !allCategories.includes(name)) setNewCategories((list) => [...list, name]);
    if (name) setCategory(name);
    setDraftCategory('');
    setAddingCategory(false);
  };

  // 上一级是知识库列表：从列表点进来时退回列表，无历史时同样落到知识库 tab
  const handleGoBack = useBackNavigation('/placeholder');

  const handleSave = () => {
    const finalTitle = title.trim() || content.trim().slice(0, 30) || '未命名';
    const finalCategory = category.trim() || '未分类';
    if (!content.trim()) {
      showError('内容不能为空');
      return;
    }
    if (!savedCategories.has(finalCategory)) addCategory(finalCategory);
    updateItem(item.id, { title: finalTitle, category: finalCategory, content: content.trim() });
    showSuccess('已保存修改');
  };

  const handleDelete = () => {
    deleteItem(item.id);
    showSuccess('已删除');
    navigate('/placeholder');
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div
      className={`bg-gray-50 dark:bg-gray-900 ${mode === 'edit' ? 'h-screen flex flex-col' : 'min-h-screen'}`}
      style={{ paddingTop: safeArea.top + 36, paddingBottom: safeArea.bottom + (mode === 'edit' ? 8 : 30) }}>
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="relative max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-800 dark:text-white pointer-events-none">知识详情</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
              className="flex-shrink-0 whitespace-nowrap px-2.5 h-8 text-sm text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
              {mode === 'edit' ? '预览' : '编辑'}
            </button>
            {mode === 'edit' && (
              <button onClick={handleSave} className="flex-shrink-0 whitespace-nowrap px-3 h-8 text-sm text-blue-600 dark:text-blue-400 font-medium rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
                保存
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 编辑模式撑满整屏，内容框自己占满剩余空间，不需要手动下拉 */}
      <div
        className={`w-full max-w-lg mx-auto px-4 pt-4 ${mode === 'edit' ? 'flex flex-col gap-2 flex-1 min-h-0' : 'space-y-4'}`}>
        {mode === 'preview' ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 px-4 py-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white break-words">
              {title.trim() || content.trim().slice(0, 30) || '未命名'}
            </h2>
            {category.trim() && (
              <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                {category}
              </span>
            )}
            <div className="mt-3 text-gray-700 dark:text-gray-200">
              {sections.length > 0 ? (
                <>
                  {sections.slice(0, visibleSections).map((section, index) => (
                    <SafeMarkdownView key={index} content={section} />
                  ))}
                  {visibleSections < sections.length && (
                    <button
                      onClick={() => setVisibleSections((count) => count + 1)}
                      className="mt-3 w-full h-10 text-sm text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-900/20">
                      继续阅读（还剩 {sections.length - visibleSections} 段）
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-400">暂无内容</p>
              )}
            </div>
          </div>
        ) : (
          <>
        {/* 标题 + 分类：标签与输入同行，压缩纵向占用 */}
        <div className="space-y-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <label className="w-8 flex-shrink-0 text-xs text-gray-400">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入标题"
              className="flex-1 min-w-0 h-9 px-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400" />
          </div>

          <div className="flex items-start gap-2">
            <label className="w-8 flex-shrink-0 text-xs text-gray-400 leading-6">分类</label>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-1">
                <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                  {allCategories.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(category === c ? '' : c)}
                      className={`h-6 px-2 text-[11px] rounded-full border transition-colors flex-shrink-0
                        ${category === c
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                {/* 右侧加号：点开后在下方展开输入框新增分类 */}
                {!addingCategory && (
                  <button
                    onClick={() => setAddingCategory(true)}
                    aria-label="新增分类"
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-blue-500 hover:border-blue-300">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                )}
              </div>
              {addingCategory && (
                <input
                  autoFocus
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value)}
                  onBlur={commitNewCategory}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitNewCategory();
                    if (e.key === 'Escape') { setDraftCategory(''); setAddingCategory(false); }
                  }}
                  placeholder="输入新分类，回车确认"
                  className="mt-1 w-full h-7 px-2.5 text-[11px] rounded-full border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none" />
              )}
            </div>
          </div>
        </div>

        {/* 内容：编辑模式自动占满剩余高度，无需手动拖拽 */}
        <div className="flex-1 min-h-0 flex flex-col">
          <label className="block text-xs text-gray-400 mb-1">内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 min-h-0 w-full p-3 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 resize-none" />
        </div>
          </>
        )}

        {/* 元信息 + 删除：压缩上下留白，编辑模式下直接贴底 */}
        <div className={`flex items-center justify-between flex-shrink-0 ${mode === 'edit' ? '' : 'pt-1'}`}>
          <span className="text-[11px] text-gray-400">创建 {fmtTime(item.createdAt)} · 更新 {fmtTime(item.updatedAt)}</span>
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex-shrink-0 px-3 h-8 text-xs text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
            删除
          </button>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteOpen}
        title="删除知识条目"
        message={<>确定删除「<span className="text-gray-800 dark:text-gray-100 font-medium">{item.title || (item.content || '').slice(0, 20)}</span>」？<br />删除后不可恢复。</>}
        onConfirm={() => { setDeleteOpen(false); handleDelete(); }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
};

export default KnowledgeItemView;
