import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { QuestionBank } from '../types';
import { useSafeArea } from '../hooks/useSafeArea';

const Import: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { importBank } = useQuestionBankStore();
  const safeArea = useSafeArea();

  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importPreviews, setImportPreviews] = useState<{ name: string; questionCount: number }[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);

  const JSON_TEMPLATE = `{
  "name": "题库名称",
  "description": "题库描述（可选）",
  "questions": [
    {
      "type": "single-choice",
      "content": "题目内容",
      "options": [
        {"id": "A", "content": "选项 A 内容"},
        {"id": "B", "content": "选项 B 内容"},
        {"id": "C", "content": "选项 C 内容"},
        {"id": "D", "content": "选项 D 内容"}
      ],
      "correctAnswer": "A",
      "score": 10,
      "explanation": "答案解析（可选）"
    },
    {
      "type": "multiple-choice",
      "content": "多选题题目内容",
      "options": [
        {"id": "A", "content": "选项 A"},
        {"id": "B", "content": "选项 B"},
        {"id": "C", "content": "选项 C"},
        {"id": "D", "content": "选项 D"}
      ],
      "correctAnswer": ["A", "B"],
      "score": 10,
      "explanation": "答案解析"
    },
    {
      "type": "fill-in-blank",
      "content": "填空题题目内容",
      "correctAnswer": ["答案 1", "答案 2"],
      "score": 10,
      "explanation": "答案解析"
    },
    {
      "type": "subjective",
      "content": "主观题题目内容",
      "correctAnswer": {
        "text": "参考答案",
        "images": ["图片 URL（可选）"]
      },
      "score": 10,
      "explanation": "答案解析"
    }
  ]
}`;

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);
    setImportFiles(fileArray);
    const previews: { name: string; questionCount: number }[] = [];
    for (const file of fileArray) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        previews.push({
          name: data.name || file.name.replace('.json', ''),
          questionCount: data.questions?.length || 0
        });
      } catch {
        previews.push({ name: file.name, questionCount: 0 });
      }
    }
    setImportPreviews(previews);
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      for (let i = 0; i < importFiles.length; i++) {
        const file = importFiles[i];
        const text = await file.text();
        const data = JSON.parse(text);
        const bank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'> = {
          name: data.name || importPreviews[i]?.name || '未命名题库',
          description: data.description,
          questions: data.questions.map((q: any) => ({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            type: q.type,
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            score: q.score || 1,
            explanation: q.explanation,
            images: q.images,
            allowDisorder: q.allowDisorder
          }))
        };
        importBank(bank as QuestionBank);
      }
      navigate('/');
    } finally {
      setIsImporting(false);
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON_TEMPLATE);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">导入题库</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-6 text-center bg-white dark:bg-gray-800">
          <input type="file" accept=".json" multiple onChange={e => handleImportFiles(e.target.files)} className="hidden" id="import-file" />
          <label htmlFor="import-file" className="cursor-pointer inline-block">
            <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <p className="text-gray-500 dark:text-gray-400 mb-1">点击选择 JSON 文件</p>
            <p className="text-xs text-gray-400">支持多文件导入</p>
          </label>
        </div>

        {importPreviews.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">待导入题库</h3>
            {importPreviews.map((preview, idx) => (
              <div key={idx} className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm flex justify-between items-center">
                <div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">{preview.name}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{preview.questionCount} 题</div>
                </div>
                <button onClick={() => {
                  setImportFiles(importFiles.filter((_, i) => i !== idx));
                  setImportPreviews(importPreviews.filter((_, i) => i !== idx));
                }} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-400">JSON 格式说明</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsJsonExpanded(!isJsonExpanded)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/30 rounded transition-colors"
                title={isJsonExpanded ? '收起' : '展开'}
              >
                {isJsonExpanded ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    <span>收起</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <span>展开</span>
                  </>
                )}
              </button>
              <button
                onClick={handleCopyJson}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/30 rounded transition-colors"
                title="一键复制"
              >
                {copySuccess ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    <span>复制</span>
                  </>
                )}
              </button>
            </div>
          </div>
          <div className={`overflow-hidden transition-all duration-300 ${isJsonExpanded ? 'max-h-[1000px]' : 'max-h-32'}`}>
            <pre className="text-xs text-blue-600 dark:text-blue-400 overflow-x-auto selectable bg-white/50 dark:bg-gray-800/50 p-3 rounded-lg -mx-3">
{JSON_TEMPLATE}
            </pre>
          </div>
          {!isJsonExpanded && (
            <div className="mt-2 text-xs text-blue-500 dark:text-blue-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              <span>点击"展开"查看完整格式</span>
            </div>
          )}
        </div>
      </div>

      {importFiles.length > 0 && (
        <div 
          className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4"
          style={{ paddingBottom: safeArea.bottom }}
        >
          <div className="max-w-lg mx-auto">
            <button onClick={handleImport} disabled={isImporting} className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50">
              {isImporting ? '导入中...' : `导入 ${importFiles.length} 个题库`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Import;
