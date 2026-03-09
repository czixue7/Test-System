import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore, ModelState } from '../store/settingsStore';
import { webllmDownloadManager, WebLLMDownloadTask } from '../utils/webllmDownloadManager';
import { initializeModel, isModelReady } from '../utils/aiGrading';
import { SUPPORTED_MODELS, ModelConfig, modelLoader } from '../utils/modelLoader';
import { useToast } from '../hooks/useToast';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo, showWarning } = useToast();
  const {
    gradingMode,
    setGradingMode,
    modelState,
    modelLoadProgress,
    modelError: _modelError,
    downloadedModelId,
    setModelState,
    setModelLoadProgress,
    setModelError,
    setDownloadedModelId,
  } = useSettingsStore();
  const [gradingExpanded, setGradingExpanded] = useState(false);
  const [webllmExpanded, setWebllmExpanded] = useState(false);
  const [webllmDownloadTasks, setWebllmDownloadTasks] = useState<Map<string, WebLLMDownloadTask>>(new Map());
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadStatusText, setLoadStatusText] = useState<string>('');
  const [cachedWebLLMModels, setCachedWebLLMModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = webllmDownloadManager.subscribe((tasks) => {
      const taskMap = new Map<string, WebLLMDownloadTask>();
      tasks.forEach(task => taskMap.set(task.id, task));
      setWebllmDownloadTasks(taskMap);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const checkCachedModels = async () => {
      const cachedModels = await modelLoader.getCachedModels();
      setCachedWebLLMModels(new Set(cachedModels));
    };
    checkCachedModels();
  }, []);

  useEffect(() => {
    const checkModelState = async () => {
      const ready = await isModelReady();
      if (ready) {
        const currentModelId = modelLoader.getCurrentModelId();
        if (currentModelId) {
          setDownloadedModelId(currentModelId);
          setModelState('ready');
        }
      }
    };
    checkModelState();
  }, [setDownloadedModelId, setModelState]);

  const getGradingModeLabel = () => {
    return gradingMode === 'fixed' ? '固定判断' : 'AI判断';
  };

  const handleSelectGradingMode = (mode: 'fixed' | 'ai') => {
    setGradingMode(mode);
    setGradingExpanded(false);
    if (mode === 'ai') {
      showSuccess('已切换到 AI 判题模式', 3000);
    } else {
      showSuccess('已切换到固定判题模式', 3000);
    }
  };

  const handleToggleGrading = () => {
    setGradingExpanded(!gradingExpanded);
  };

  const handleLoadModel = useCallback(async (modelId: string) => {
    if (modelLoader.isModelLoading()) {
      const currentLoadingId = modelLoader.getCurrentLoadingModelId();
      const currentLoadingModel = SUPPORTED_MODELS.find(m => m.modelId === currentLoadingId);
      const currentLoadingName = currentLoadingModel?.displayName || currentLoadingId;

      const isNewModelCached = cachedWebLLMModels.has(modelId);

      if (isNewModelCached) {
        showWarning(`「${currentLoadingName}」正在加载中，请等待加载完成后再切换模型`, 4000);
        return;
      } else {
        showInfo(`「${currentLoadingName}」正在加载中，「${SUPPORTED_MODELS.find(m => m.modelId === modelId)?.displayName || modelId}」将在当前加载完成后开始下载`, 5000);
      }
    }

    if (loadingModelId === modelId && modelState === 'loading') return;

    const modelConfig = SUPPORTED_MODELS.find(m => m.modelId === modelId);
    const modelName = modelConfig?.displayName || modelId;

    const downloadId = webllmDownloadManager.startDownload(modelId);

    showInfo(`正在加载模型「${modelName}」...`, 5000);

    setLoadingModelId(modelId);
    setModelState('loading');
    setModelLoadProgress(0);
    setModelError(null);
    setLoadStatusText('正在初始化...');

    try {
      const success = await initializeModel(modelId, (progress, status) => {
        setModelLoadProgress(progress);
        setLoadStatusText(status);
        webllmDownloadManager.updateProgress(downloadId, progress, status);
      });

      if (success) {
        setDownloadedModelId(modelId);
        setModelState('ready');
        setModelLoadProgress(100);
        setLoadingModelId(null);
        webllmDownloadManager.completeDownload(downloadId);
        setCachedWebLLMModels(prev => new Set([...prev, modelId]));
        showSuccess(`模型「${modelName}」加载成功！`, 4000);
      } else {
        setModelState('error');
        setModelError('模型加载失败');
        webllmDownloadManager.failDownload(downloadId, '模型加载失败');
        showError('模型加载失败，请重试', 5000);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '模型加载失败';
      setModelState('error');
      setModelError(errorMsg);
      webllmDownloadManager.failDownload(downloadId, errorMsg);
      showError(`模型加载失败：${errorMsg}`, 6000);
    }
  }, [modelState, loadingModelId, cachedWebLLMModels, setModelState, setModelLoadProgress, setModelError, setDownloadedModelId, setLoadingModelId, setCachedWebLLMModels, showInfo, showSuccess, showError, showWarning]);

  const handleDeleteWebLLMModel = useCallback(async (modelId: string) => {
    const modelConfig = SUPPORTED_MODELS.find(m => m.modelId === modelId);
    const modelName = modelConfig?.displayName || modelId;

    showInfo(`正在删除模型「${modelName}」...`, 3000);

    const success = await modelLoader.deleteModel(modelId);

    if (success) {
      if (downloadedModelId === modelId) {
        setDownloadedModelId(null);
        setModelState('not-downloaded');
      }

      setCachedWebLLMModels(prev => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });

      showSuccess(`模型「${modelName}」已删除`, 4000);
    } else {
      showError(`删除模型「${modelName}」失败`, 4000);
    }
  }, [downloadedModelId, setDownloadedModelId, setModelState, setCachedWebLLMModels, showInfo, showSuccess, showError]);

  const getModelCurrentState = (model: ModelConfig): ModelState => {
    if (loadingModelId === model.modelId) {
      return modelState;
    }
    if (modelLoader.isModelLoaded(model.modelId)) {
      return 'ready';
    }
    if (downloadedModelId === model.modelId && modelState === 'ready') {
      return 'ready';
    }
    if (downloadedModelId === model.modelId && modelState === 'downloaded') {
      return 'downloaded';
    }
    return 'not-downloaded';
  };

  const renderWebLLMModelButtons = (model: ModelConfig, downloadTask: WebLLMDownloadTask | undefined, isCached: boolean, currentState: ModelState) => {
    if (currentState === 'loading') {
      return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-sm rounded-lg ml-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          加载中
        </div>
      );
    }

    if (currentState === 'ready') {
      return (
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              showInfo('该模型已在运行中', 3000);
            }}
            className="p-1.5 bg-green-500 text-white rounded-lg"
            title="已启用"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteWebLLMModel(model.modelId);
            }}
            className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 rounded-lg"
            title="删除"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      );
    }

    if (isCached) {
      return (
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleLoadModel(model.modelId);
            }}
            className="p-1.5 text-gray-500 hover:text-green-500 hover:bg-green-50 dark:text-gray-400 dark:hover:text-green-400 dark:hover:bg-green-900/20 rounded-lg"
            title="启用"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteWebLLMModel(model.modelId);
            }}
            className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 rounded-lg"
            title="删除"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      );
    }

    if (downloadTask?.status === 'error') {
      return (
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-red-500 dark:text-red-400 max-w-[150px] truncate" title={downloadTask.error}>
            {downloadTask.error || '下载失败'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleLoadModel(model.modelId);
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重试
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleLoadModel(model.modelId);
        }}
        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 ml-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        下载
      </button>
    );
  };

  const renderWebLLMModelDetails = (model: ModelConfig, downloadTask: WebLLMDownloadTask | undefined, _isCached: boolean, currentState: ModelState) => {
    const isLoading = currentState === 'loading';
    const isDownloading = downloadTask?.status === 'downloading';
    const isPaused = downloadTask?.status === 'paused';
    const hasError = downloadTask?.status === 'error';

    if (!isLoading && !isDownloading && !isPaused && !hasError) {
      return (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-center gap-4 text-xs mb-2">
            <span className="text-gray-500 dark:text-gray-400">模型大小</span>
            <span className="text-gray-700 dark:text-gray-200 font-medium">{model.estimatedSize}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-500 dark:text-gray-400">运存要求</span>
            <span className="text-gray-700 dark:text-gray-200 font-medium">≥{model.minMemory}GB</span>
            {model.recommended && (
              <>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span className="text-green-500 font-medium">推荐</span>
              </>
            )}
          </div>
          {model.downloadUrl && (
            <a
              href={model.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              查看模型详情
            </a>
          )}
        </div>
      );
    }

    if (isLoading || isDownloading || isPaused) {
      const progress = isLoading ? modelLoadProgress : (downloadTask?.progress || 0);
      const statusText = isLoading ? loadStatusText : (downloadTask?.statusText || '准备中...');

      return (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isPaused ? 'bg-yellow-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 w-10 text-right">
              {progress}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{statusText}</span>
            <div className="flex items-center gap-2">
              {isDownloading && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    webllmDownloadManager.pauseDownload(`webllm-${model.modelId}`);
                  }}
                  className="p-1.5 text-gray-500 hover:text-yellow-500 dark:text-gray-400 dark:hover:text-yellow-400"
                  title="暂停"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
              {isPaused && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    webllmDownloadManager.resumeDownload(`webllm-${model.modelId}`);
                    handleLoadModel(model.modelId);
                  }}
                  className="p-1.5 text-gray-500 hover:text-green-500 dark:text-gray-400 dark:hover:text-green-400"
                  title="继续"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  webllmDownloadManager.cancelDownload(`webllm-${model.modelId}`);
                }}
                className="p-1.5 text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                title="取消"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (hasError) {
      return (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-start gap-2 text-red-500 dark:text-red-400">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs">{downloadTask.error || '模型加载失败'}</span>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">设置</h1>
          <div className="w-8" />
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
          <div
            onClick={handleToggleGrading}
            className="px-4 pt-3 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">判题模式</span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{getGradingModeLabel()}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 pb-3">
              {gradingMode === 'fixed' ? '使用预设答案进行精确匹配' : '使用 AI 智能分析答案语义'}
            </p>
          </div>

          {gradingExpanded && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectGradingMode('fixed');
                }}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                  gradingMode === 'fixed'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                    : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  gradingMode === 'fixed' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {gradingMode === 'fixed' && (
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">固定判断</span>
              </div>

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectGradingMode('ai');
                }}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                  gradingMode === 'ai'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                    : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  gradingMode === 'ai' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {gradingMode === 'ai' && (
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">AI判断</span>
              </div>
            </div>
          )}
        </div>

        {gradingMode === 'ai' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
            <div
              onClick={() => setWebllmExpanded(!webllmExpanded)}
              className="px-4 py-3 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">WebLLM 模型</span>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${webllmExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                在线加载模型，需要 WebGPU 支持
              </p>
            </div>
            {webllmExpanded && (
              <div className="p-3 space-y-2 border-t border-gray-200 dark:border-gray-600">
                {SUPPORTED_MODELS.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">暂无预设 WebLLM 模型</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">请联系开发者添加模型支持</p>
                  </div>
                ) : (
                  SUPPORTED_MODELS.map((model) => {
                    const currentState = getModelCurrentState(model);
                    const downloadTask = webllmDownloadTasks.get(`webllm-${model.modelId}`);
                    const isCached = cachedWebLLMModels.has(model.modelId);
                    const isLoading = currentState === 'loading';
                    const isDownloading = downloadTask?.status === 'downloading';
                    const isPaused = downloadTask?.status === 'paused';
                    const hasError = downloadTask?.status === 'error';

                    return (
                      <details
                        key={model.modelId}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-xl overflow-hidden"
                        open={isLoading || isDownloading || isPaused || hasError}
                      >
                        <summary className="px-4 py-3 cursor-pointer flex items-center justify-between list-none">
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                              {model.displayName}
                            </span>
                            {currentState === 'ready' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                                已就绪
                              </span>
                            )}
                          </div>
                          {renderWebLLMModelButtons(model, downloadTask, isCached, currentState)}
                        </summary>
                        {renderWebLLMModelDetails(model, downloadTask, isCached, currentState)}
                      </details>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {gradingMode === 'ai' && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">AI 判题说明</h4>
                <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                  <li>• AI 判题需要设备支持 WebGPU</li>
                  <li>• 首次使用需要下载模型（约 400MB - 1.2GB）</li>
                  <li>• 模型下载后会缓存在本地，下次无需重复下载</li>
                  <li>• 如遇到 WebGPU 错误，请尝试使用支持 WebGPU 的浏览器</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
