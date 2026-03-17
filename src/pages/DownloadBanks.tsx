import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { QuestionBank, BankIndex, BankImageInfo } from '../types';
import { useToast } from '../hooks/useToast';
import { useSafeArea } from '../hooks/useSafeArea';
import { fetchBankIndex, checkBankStatus, findBankInIndex } from '../utils/bankIndex';

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: string;
}

interface BankInfo {
  name: string;
  filename: string;
  downloadUrl: string;
  imagePath?: string;
  sha: string;
  images?: BankImageInfo[];
  source: 'system' | 'user';
  exists: boolean;
  hasUpdate: boolean;
  hasImageUpdate: boolean;
  isBuiltIn: boolean;
  missingImages: string[];
  changedImages: string[];
  downloading: boolean;
  progress: number;
}

// 按名称排序函数
const sortByName = (a: BankInfo, b: BankInfo) => a.name.localeCompare(b.name, 'zh-CN');

const DownloadBanks: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { importBankWithSha, updateBankWithSha, banks } = useQuestionBankStore();
  const { showSuccess, showError, showInfo } = useToast();
  const safeArea = useSafeArea();

  const [bankList, setBankList] = useState<BankInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<{ system: boolean; user: boolean }>({
    system: true,
    user: true
  });
  const [bankIndex, setBankIndex] = useState<BankIndex | null>(null);

  const GITHUB_REPO = 'czixue7/Test-System';

  // 使用统一的 bank-index.json 获取题库列表
  const fetchBankList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const index = await fetchBankIndex();
      
      if (index) {
        setBankIndex(index);
        const allBanks: BankInfo[] = [];
        
        // 处理系统题库
        for (const bank of index.systemBanks) {
          const status = checkBankStatus(bank.name, bank.sha, bank.images, bank.filename, 'system', banks);
          allBanks.push({
            name: bank.name,
            filename: bank.filename,
            downloadUrl: bank.downloadUrl,
            imagePath: bank.imagePath,
            sha: bank.sha,
            images: bank.images,
            source: 'system',
            exists: status.exists,
            hasUpdate: status.hasUpdate,
            hasImageUpdate: status.hasImageUpdate,
            isBuiltIn: status.isBuiltIn,
            missingImages: status.missingImages,
            changedImages: status.changedImages,
            downloading: false,
            progress: 0
          });
        }
        
        // 处理用户题库
        for (const bank of index.userBanks) {
          const status = checkBankStatus(bank.name, bank.sha, bank.images, bank.filename, 'user', banks);
          allBanks.push({
            name: bank.name,
            filename: bank.filename,
            downloadUrl: bank.downloadUrl,
            imagePath: bank.imagePath,
            sha: bank.sha,
            images: bank.images,
            source: 'user',
            exists: status.exists,
            hasUpdate: status.hasUpdate,
            hasImageUpdate: status.hasImageUpdate,
            isBuiltIn: false,
            missingImages: status.missingImages,
            changedImages: status.changedImages,
            downloading: false,
            progress: 0
          });
        }
        
        // 按名称排序
        allBanks.sort(sortByName);
        
        setBankList(allBanks);
      } else {
        setError('无法获取题库索引文件');
        showError('获取题库列表失败，请检查网络连接');
      }
    } catch (err) {
      console.error('获取题库列表失败:', err);
      setError('获取题库列表失败');
      showError('获取题库列表失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, [banks, showError, showInfo]);

  useEffect(() => {
    fetchBankList();
  }, [fetchBankList]);

  // 当本地题库变化时，重新检测状态并排序
  useEffect(() => {
    if (!bankIndex || bankList.length === 0) return;
    
    setBankList(prev => {
      const updated = prev.map(bank => {
        const status = checkBankStatus(bank.name, bank.sha, bank.images, bank.filename, bank.source, banks);
        return {
          ...bank,
          exists: status.exists,
          hasUpdate: status.hasUpdate,
          hasImageUpdate: status.hasImageUpdate,
          isBuiltIn: status.isBuiltIn,
          missingImages: status.missingImages,
          changedImages: status.changedImages
        };
      });
      // 重新排序
      updated.sort(sortByName);
      return updated;
    });
  }, [banks, bankIndex]);

  const downloadImageAsBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download image: ${url}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const downloadAndProcessImages = async (imagePath: string, totalProgress: (progress: number) => void): Promise<Map<string, string[]>> => {
    const questionImagesMap = new Map<string, string[]>();
    
    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${imagePath}`);
      if (!response.ok) return questionImagesMap;
      
      const imageFiles: GitHubFile[] = await response.json();
      const validImages = imageFiles.filter(f => f.type === 'file' && (f.name.endsWith('.jpg') || f.name.endsWith('.jpeg') || f.name.endsWith('.png') || f.name.endsWith('.gif')));
      
      let processedCount = 0;
      const totalImages = validImages.length;
      
      for (const imageFile of validImages) {
        try {
          const match = imageFile.name.match(/^(\d+)-(\d+)\.(jpg|jpeg|png|gif)$/);
          if (match && imageFile.download_url) {
            const questionIndex = parseInt(match[1]) - 1;
            const base64Image = await downloadImageAsBase64(imageFile.download_url);
            
            if (!questionImagesMap.has(questionIndex.toString())) {
              questionImagesMap.set(questionIndex.toString(), []);
            }
            questionImagesMap.get(questionIndex.toString())?.push(base64Image);
          }
        } catch (err) {
          console.warn(`Failed to process image ${imageFile.name}:`, err);
        }
        
        processedCount++;
        if (totalImages > 0) {
          totalProgress(processedCount / totalImages * 50);
        }
      }
    } catch (err) {
      console.warn('Error downloading images:', err);
    }
    
    return questionImagesMap;
  };

  // 获取本地题库ID（用于更新）
  const getLocalBankId = (filename: string, source: 'system' | 'user'): string | undefined => {
    const localBank = banks.find(b => b.sourceFilename === filename && b.sourceType === source);
    return localBank?.id;
  };

  const handleDownload = async (bank: BankInfo, index: number) => {
    if (!bank.downloadUrl) {
      showError('下载链接不可用');
      return;
    }

    setBankList(prev => prev.map((b, i) => 
      i === index ? { ...b, downloading: true, progress: 0 } : b
    ));

    if (bank.hasUpdate || bank.hasImageUpdate) {
      showInfo(`正在更新「${bank.name}」...`);
    } else {
      showInfo(`正在下载「${bank.name}」...`);
    }

    try {
      let currentProgress = 0;
      const updateProgress = (newProgress: number) => {
        currentProgress = newProgress;
        setBankList(prev => prev.map((b, i) => 
          i === index ? { ...b, progress: currentProgress } : b
        ));
      };

      const response = await fetch(bank.downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`);
      }

      const text = await response.text();
      if (!text || text.trim().length === 0) {
        throw new Error('下载的文件内容为空');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('JSON 解析错误:', parseError);
        console.error('文件内容前100字符:', text.substring(0, 100));
        throw new Error('文件格式无效，不是有效的 JSON');
      }

      if (!data.questions || !Array.isArray(data.questions)) {
        throw new Error('题库格式无效，缺少 questions 字段');
      }
      
      if (data.questions.length === 0) {
        throw new Error('题库为空，没有题目');
      }
      
      updateProgress(20);
      
      let questionImagesMap = new Map<string, string[]>();
      if (bank.imagePath) {
        questionImagesMap = await downloadAndProcessImages(bank.imagePath, updateProgress);
        updateProgress(70);
      }
      
      const localBankId = getLocalBankId(bank.filename, bank.source);
      
      if (localBankId && (bank.hasUpdate || bank.hasImageUpdate)) {
        // 更新现有题库
        const updatedBank: Partial<QuestionBank> = {
          name: data.name || bank.name,
          description: data.description,
          questions: data.questions.map((q: any, qIndex: number) => ({
            id: `updated-${Date.now()}-${qIndex}`,
            type: q.type,
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            score: q.score || 1,
            explanation: q.explanation,
            images: questionImagesMap.has(qIndex.toString()) ? questionImagesMap.get(qIndex.toString()) : q.images,
            allowDisorder: q.allowDisorder
          })),
          sourceSha: bank.sha,
          images: bank.images,
          updatedAt: new Date().toISOString()
        };
        
        updateBankWithSha(localBankId, updatedBank, bank.sha, bank.images);
        showSuccess(`题库「${updatedBank.name}」更新成功！`);
      } else {
        // 新下载题库
        const newBank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'> = {
          name: data.name || bank.name,
          description: data.description,
          questions: data.questions.map((q: any, qIndex: number) => ({
            id: `downloaded-${Date.now()}-${qIndex}`,
            type: q.type,
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            score: q.score || 1,
            explanation: q.explanation,
            images: questionImagesMap.has(qIndex.toString()) ? questionImagesMap.get(qIndex.toString()) : q.images,
            allowDisorder: q.allowDisorder
          })),
          sourceSha: bank.sha,
          sourceFilename: bank.filename,
          sourceType: bank.source,
          images: bank.images
        };

        importBankWithSha(newBank as QuestionBank, bank.sha, bank.filename, bank.images);
        showSuccess(`题库「${newBank.name}」下载并导入成功！`);
      }

      updateProgress(100);

      setBankList(prev => prev.map((b, i) => 
        i === index ? { ...b, downloading: false, progress: 100, exists: true, hasUpdate: false, hasImageUpdate: false, missingImages: [], changedImages: [] } : b
      ));
    } catch (err) {
      setBankList(prev => prev.map((b, i) => 
        i === index ? { ...b, downloading: false, progress: 0 } : b
      ));
      showError(`下载失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const toggleSection = (section: 'system' | 'user') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // 使用 useMemo 确保排序后的列表
  const sortedBankList = useMemo(() => {
    return [...bankList].sort(sortByName);
  }, [bankList]);

  const systemBanks = sortedBankList.filter(b => b.source === 'system');
  const userBanks = sortedBankList.filter(b => b.source === 'user');

  const systemExistingCount = systemBanks.filter(b => b.exists && !b.hasUpdate && !b.hasImageUpdate).length;
  const systemUpdateCount = systemBanks.filter(b => b.hasUpdate || b.hasImageUpdate).length;
  const userExistingCount = userBanks.filter(b => b.exists && !b.hasUpdate && !b.hasImageUpdate).length;
  const userUpdateCount = userBanks.filter(b => b.hasUpdate || b.hasImageUpdate).length;

  const renderBankList = (
    banks: BankInfo[],
    title: string,
    link: string,
    existingCount: number,
    updateCount: number,
    section: 'system' | 'user'
  ) => {
    const isExpanded = expandedSections[section];

    return (
      <div className="mb-4">
        <button
          onClick={() => toggleSection(section)}
          className="w-full flex items-center justify-between mb-2 px-1"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {title} ({banks.length})
            </h2>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              查看源
            </a>
          </div>
          <div className="flex items-center gap-3">
            {updateCount > 0 && (
              <span className="text-sm text-orange-500">
                {updateCount} 个可更新
              </span>
            )}
            {existingCount > 0 && (
              <span className="text-sm text-green-500">
                已有 {existingCount} 个
              </span>
            )}
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        
        {isExpanded && (
          <>
            {banks.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 text-center">
                <p className="text-sm text-gray-400 dark:text-gray-500">暂无题库</p>
              </div>
            ) : (
              <div className="space-y-3">
                {banks.map((bank, index) => {
                  const needsUpdate = bank.hasUpdate || bank.hasImageUpdate;
                  const canDownload = !bank.exists || needsUpdate;
                  
                  return (
                    <div
                      key={`${bank.source}-${bank.filename}`}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 border border-gray-100 dark:border-gray-700"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="font-medium text-gray-800 dark:text-white truncate text-sm">
                            {bank.name}
                          </h3>
                          {bank.isBuiltIn && (
                            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded flex-shrink-0">
                              内置
                            </span>
                          )}
                          {needsUpdate && (
                            <span className="px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs rounded flex-shrink-0">
                              有更新
                            </span>
                          )}
                          {bank.exists && !needsUpdate && (
                            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded flex-shrink-0">
                              已存在
                            </span>
                          )}
                        </div>
                        
                        {needsUpdate ? (
                          <button
                            onClick={() => handleDownload(bank, bankList.findIndex(b => b.filename === bank.filename && b.source === bank.source))}
                            disabled={bank.downloading}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                              bank.downloading
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 cursor-wait'
                                : 'bg-orange-500 text-white hover:bg-orange-600'
                            }`}
                          >
                            {bank.downloading ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                更新中 {bank.progress}%
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                更新
                              </>
                            )}
                          </button>
                        ) : bank.exists ? (
                          <span className="flex-shrink-0 px-3 py-1.5 text-sm text-gray-400 flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            已存在
                          </span>
                        ) : (
                          <button
                            onClick={() => handleDownload(bank, bankList.findIndex(b => b.filename === bank.filename && b.source === bank.source))}
                            disabled={bank.downloading}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                              bank.downloading
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-500 cursor-wait'
                                : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                          >
                            {bank.downloading ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                下载中 {bank.progress}%
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                下载
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow dark:shadow-gray-700 transition-colors border-b border-gray-200 dark:border-gray-700"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">下载题库</h1>
          <button
            onClick={fetchBankList}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="刷新题库列表"
          >
            <svg
              className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl py-2 px-4 mb-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p>题库来源：GitHub 开源项目</p>
              <a 
                href={`https://github.com/${GITHUB_REPO}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                github.com/{GITHUB_REPO}
              </a>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <svg className="w-10 h-10 text-blue-500 animate-spin mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">正在获取题库列表...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
            <svg className="w-10 h-10 text-red-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
            <button
              onClick={fetchBankList}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {renderBankList(
              systemBanks,
              '系统题库',
              `https://github.com/${GITHUB_REPO}/tree/main/public/banks`,
              systemExistingCount,
              systemUpdateCount,
              'system'
            )}
            {renderBankList(
              userBanks,
              '用户题库',
              `https://github.com/${GITHUB_REPO}/tree/main/Question_bank`,
              userExistingCount,
              userUpdateCount,
              'user'
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DownloadBanks;
