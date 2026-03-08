import React, { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { validateJsonBank, convertJsonToBank, parseJsonFile } from '../utils/jsonImporter';
import { JsonBankData } from '../types';

interface ParsedFile {
  fileName: string;
  data: JsonBankData;
  error?: string;
  selected: boolean;
}

const Import: React.FC = () => {
  const navigate = useNavigate();
  const { importBank } = useQuestionBankStore();
  const [dragActive, setDragActive] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [errors, setErrors] = useState<{ fileName: string; error: string }[]>([]);
  const [importing, setImporting] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const processFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newParsedFiles: ParsedFile[] = [];
    const newErrors: { fileName: string; error: string }[] = [];

    let processedCount = 0;
    const totalFiles = fileArray.length;

    fileArray.forEach((file) => {
      if (!file.name.endsWith('.json')) {
        newErrors.push({ fileName: file.name, error: '不是 JSON 格式的文件' });
        processedCount++;
        if (processedCount === totalFiles) {
          setParsedFiles(prev => [...prev, ...newParsedFiles]);
          setErrors(prev => [...prev, ...newErrors]);
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        
        const parseResult = parseJsonFile(content);
        if (!parseResult.success) {
          newErrors.push({ fileName: file.name, error: parseResult.error || '解析失败' });
        } else {
          const validationResult = validateJsonBank(parseResult.data);
          if (!validationResult.valid) {
            newErrors.push({ fileName: file.name, error: validationResult.error || '验证失败' });
          } else if (parseResult.data) {
            newParsedFiles.push({
              fileName: file.name,
              data: parseResult.data,
              selected: true
            });
          }
        }
        
        processedCount++;
        if (processedCount === totalFiles) {
          setParsedFiles(prev => [...prev, ...newParsedFiles]);
          setErrors(prev => [...prev, ...newErrors]);
        }
      };
      reader.onerror = () => {
        newErrors.push({ fileName: file.name, error: '读取文件失败' });
        processedCount++;
        if (processedCount === totalFiles) {
          setParsedFiles(prev => [...prev, ...newParsedFiles]);
          setErrors(prev => [...prev, ...newErrors]);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const toggleFileSelection = (index: number) => {
    setParsedFiles(prev => prev.map((f, i) => 
      i === index ? { ...f, selected: !f.selected } : f
    ));
  };

  const selectAll = () => {
    setParsedFiles(prev => prev.map(f => ({ ...f, selected: true })));
  };

  const deselectAll = () => {
    setParsedFiles(prev => prev.map(f => ({ ...f, selected: false })));
  };

  const removeFile = (index: number) => {
    setParsedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setParsedFiles([]);
    setErrors([]);
  };

  const handleImport = () => {
    const selectedFiles = parsedFiles.filter(f => f.selected);
    if (selectedFiles.length === 0) return;
    
    setImporting(true);
    try {
      const importedIds: string[] = [];
      selectedFiles.forEach((file) => {
        const bank = convertJsonToBank(file.data);
        const id = importBank(bank);
        importedIds.push(id);
      });
      navigate('/');
    } catch (err) {
      setErrors([{ fileName: '导入', error: '导入失败: ' + (err as Error).message }]);
    } finally {
      setImporting(false);
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'fill-in-blank': '填空题',
      'single-choice': '单选题',
      'multiple-choice': '多选题',
      'subjective': '主观题'
    };
    return labels[type] || type;
  };

  const selectedCount = parsedFiles.filter(f => f.selected).length;
  const totalQuestions = parsedFiles.filter(f => f.selected).reduce((sum, f) => sum + f.data.questions.length, 0);

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="mb-3 sm:mb-4">
          <Link to="/" className="btn-back">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回首页
          </Link>
        </div>

        <h1 className="title-primary mb-3 sm:mb-4">导入题库</h1>

        <div className="card mb-3 sm:mb-4">
          <div
            className={`upload-zone ${dragActive ? 'upload-zone-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <svg className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-400 mb-2 sm:mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-gray-600 mb-2 text-sm sm:text-base">拖拽 JSON 文件到此处，或</p>
            <label className="cursor-pointer">
              <span className="text-blue-500 hover:text-blue-600 text-sm sm:text-base">点击选择文件（支持多选）</span>
              <input
                type="file"
                accept=".json"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="card bg-red-50 border border-red-200 mb-3 sm:mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium text-red-700 text-sm sm:text-base">错误信息 ({errors.length})</h3>
              <button
                onClick={() => setErrors([])}
                className="text-xs sm:text-sm text-red-500 hover:text-red-700"
              >
                清除
              </button>
            </div>
            <div className="space-y-1">
              {errors.map((err, index) => (
                <div key={index} className="flex items-center gap-2 text-red-600 text-xs sm:text-sm">
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">{err.fileName}:</span>
                  <span>{err.error}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {parsedFiles.length > 0 && (
          <div className="card">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-2 sm:gap-4 mb-3 sm:mb-4">
              <div>
                <h2 className="title-secondary">预览 ({parsedFiles.length} 个文件)</h2>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">
                  已选择 {selectedCount} 个题库，共 {totalQuestions} 道题目
                </p>
              </div>
              <div className="flex gap-1 sm:gap-2 text-xs sm:text-sm">
                <button onClick={selectAll} className="text-blue-500 hover:text-blue-600">
                  全选
                </button>
                <span className="text-gray-300">|</span>
                <button onClick={deselectAll} className="text-blue-500 hover:text-blue-600">
                  取消全选
                </button>
                <span className="text-gray-300">|</span>
                <button onClick={clearAll} className="text-red-500 hover:text-red-600">
                  清空
                </button>
              </div>
            </div>

            <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4 max-h-[50vh] overflow-y-auto">
              {parsedFiles.map((file, index) => (
                <div 
                  key={index} 
                  className={`border-2 rounded-xl transition-all ${file.selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
                >
                  <div 
                    className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 cursor-pointer"
                    onClick={() => toggleFileSelection(index)}
                  >
                    <input
                      type="checkbox"
                      checked={file.selected}
                      onChange={() => toggleFileSelection(index)}
                      className="checkbox-styled"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800 text-sm sm:text-base">{file.data.name}</h3>
                        <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 sm:px-2 rounded">
                          {file.fileName}
                        </span>
                      </div>
                      {file.data.description && (
                        <p className="text-xs sm:text-sm text-gray-500 truncate">{file.data.description}</p>
                      )}
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        共 {file.data.questions.length} 道题目
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="p-1 sm:p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  {file.selected && (
                    <div className="px-2 sm:px-3 pb-2 sm:pb-3 pt-0">
                      <div className="border-t border-gray-200 pt-2 sm:pt-3">
                        <div className="max-h-32 sm:max-h-40 overflow-y-auto space-y-1.5 sm:space-y-2">
                          {file.data.questions.slice(0, 10).map((question, qIndex) => (
                            <div key={qIndex} className="p-1.5 sm:p-2 bg-white rounded-lg text-xs sm:text-sm">
                              <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                                <span className="badge badge-info text-xs">{qIndex + 1}</span>
                                <span className="badge badge-success text-xs">{getQuestionTypeLabel(question.type)}</span>
                                <span className="text-xs text-gray-500">{question.score || 10} 分</span>
                              </div>
                              <p className="text-gray-800 truncate">{question.content}</p>
                            </div>
                          ))}
                          {file.data.questions.length > 10 && (
                            <p className="text-center text-xs sm:text-sm text-gray-500 py-1">
                              还有 {file.data.questions.length - 10} 道题目...
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 sm:gap-3 pt-2 sm:pt-3 border-t">
              <button
                onClick={clearAll}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={importing || selectedCount === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? '导入中...' : `确认导入 (${selectedCount} 个)`}
              </button>
            </div>
          </div>
        )}

        <div className="card mt-3 sm:mt-4">
          <h2 className="title-secondary mb-2 sm:mb-3">JSON 格式说明</h2>
          <pre className="bg-gray-50 p-2 sm:p-3 rounded-lg text-xs sm:text-sm overflow-x-auto whitespace-pre-wrap">
{`{
  "name": "题库名称",
  "description": "题库描述（可选）",
  "questions": [
    {
      "type": "single-choice",
      "content": "题目内容",
      "options": [
        { "id": "A", "content": "选项A" },
        { "id": "B", "content": "选项B" }
      ],
      "correctAnswer": "A",
      "score": 10,
      "explanation": "解析说明（可选）",
      "images": ["/images/xxx.jpg"]
    }
  ]
}`}
          </pre>
          <div className="mt-2 sm:mt-3 text-xs sm:text-sm text-gray-500 space-y-2">
            <div>
              <p className="font-medium text-gray-700">题型说明：</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 sm:space-y-1 ml-2">
                <li><code>single-choice</code> - 单选题，correctAnswer 为字符串（如 "A"）</li>
                <li><code>multiple-choice</code> - 多选题，correctAnswer 为数组（如 ["A", "B"]）</li>
                <li><code>fill-in-blank</code> - 填空题，correctAnswer 为字符串数组</li>
                <li><code>subjective</code> - 主观题，correctAnswer 为字符串或对象</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-700">填空题特殊字段：</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 sm:space-y-1 ml-2">
                <li><code>allowDisorder</code> - 是否允许答案乱序（默认 false）</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-700">主观题答案格式：</p>
              <pre className="bg-gray-100 p-2 rounded mt-1 text-xs overflow-x-auto">
{`// 纯文本答案
"correctAnswer": "答案内容"

// 带图片的答案
"correctAnswer": {
  "text": "答案内容",
  "images": ["/images/xxx.jpg"]
}`}
              </pre>
            </div>
            <div>
              <p className="font-medium text-gray-700">可选字段：</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 sm:space-y-1 ml-2">
                <li><code>explanation</code> - 题目解析</li>
                <li><code>images</code> - 题目配图（路径数组）</li>
                <li><code>score</code> - 题目分值（默认 10 分）</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Import;
