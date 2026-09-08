import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSafeArea } from '../hooks/useSafeArea';
import { useToast } from '../hooks/useToast';
import { useKnowledgeStore } from '../store/knowledgeStore';
import ConfirmDialog from '../components/ConfirmDialog';

const KnowledgeItemView: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const safeArea = useSafeArea();
  const { showSuccess, showError } = useToast();
  const { items, categories, loadItems, updateItem, deleteItem, addCategory } = useKnowledgeStore();

  const item = items.find((i) => i.id === id);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const allCategories = Array.from(new Set([...categories, ...items.map((i) => i.category).filter(Boolean)])).sort();

  const handleSave = () => {
    const finalTitle = title.trim() || content.trim().slice(0, 30) || '未命名';
    const finalCategory = category.trim() || '未分类';
    if (!content.trim()) {
      showError('内容不能为空');
      return;
    }
    if (!allCategories.includes(finalCategory)) addCategory(finalCategory);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" style={{ paddingTop: safeArea.top + 48, paddingBottom: safeArea.bottom + 30 }}>
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: safeArea.top }}>
        <div className="relative max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <button onClick={() => navigate('/placeholder')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-800 dark:text-white pointer-events-none">知识详情</h1>
          <button onClick={handleSave} className="flex-shrink-0 whitespace-nowrap px-3 h-8 text-sm text-blue-600 dark:text-blue-400 font-medium rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
            保存
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* 标题 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入标题"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400" />
        </div>

        {/* 分类 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">分类</label>
          <div className="flex flex-wrap gap-1.5">
            {allCategories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(category === c ? '' : c)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors flex-shrink-0
                  ${category === c
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300'}`}>
                {c}
              </button>
            ))}
          </div>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="输入或选择分类（留空为未分类）"
            className="mt-2 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400" />
        </div>

        {/* 内容 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            className="w-full p-3 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 resize-y" />
        </div>

        {/* 元信息 + 删除 */}
        <div className="flex items-center justify-between pt-1">
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
