import {
  CreateMLCEngine,
  MLCEngine,
  InitProgressReport,
} from '@mlc-ai/web-llm';

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export interface ModelConfig {
  modelId: string;
  displayName: string;
  contextLength: number;
  estimatedSize: string;
  minMemory: number;
  recommended: boolean;
  downloadUrl?: string;
}

export const SUPPORTED_MODELS: ModelConfig[] = [
  {
    modelId: 'Qwen3-1.7B-q4f16_1-MLC',
    displayName: 'Qwen3 1.7B (推荐)',
    contextLength: 4096,
    estimatedSize: '~1.2GB',
    minMemory: 4,
    recommended: true,
    downloadUrl: 'https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC',
  },
  {
    modelId: 'Qwen3-0.6B-q4f16_1-MLC',
    displayName: 'Qwen3 0.6B (轻量)',
    contextLength: 4096,
    estimatedSize: '~400MB',
    minMemory: 2,
    recommended: false,
    downloadUrl: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
  },

];

interface LoadQueueItem {
  modelId: string;
  onProgress?: (progress: number, status: string) => void;
  resolve: (value: boolean) => void;
  reject: (reason: Error) => void;
}

class ModelLoaderService {
  private engine: MLCEngine | null = null;
  private currentModelId: string | null = null;
  private isLoading: boolean = false;
  private loadProgress: number = 0;
  private loadStatus: string = '';
  private deviceMemory: number = 4;
  private loadQueue: LoadQueueItem[] = [];
  private currentLoadingModelId: string | null = null;
  private lastUsedModelKey = 'last-used-webllm-model';

  async initialize(): Promise<void> {
    await this.detectDeviceCapabilities();
  }

  // 保存上次使用的模型ID
  private saveLastUsedModel(modelId: string): void {
    try {
      localStorage.setItem(this.lastUsedModelKey, modelId);
      console.log(`[ModelLoader] 已保存上次使用的模型: ${modelId}`);
    } catch (error) {
      console.error('[ModelLoader] 保存上次使用的模型失败:', error);
    }
  }

  // 获取上次使用的模型ID
  getLastUsedModel(): string | null {
    try {
      const modelId = localStorage.getItem(this.lastUsedModelKey);
      console.log(`[ModelLoader] 上次使用的模型: ${modelId}`);
      return modelId;
    } catch (error) {
      console.error('[ModelLoader] 获取上次使用的模型失败:', error);
      return null;
    }
  }

  // 自动加载上次使用的模型
  async autoLoadLastModel(onProgress?: (progress: number, status: string) => void): Promise<boolean> {
    const lastModelId = this.getLastUsedModel();
    if (!lastModelId) {
      console.log('[ModelLoader] 没有上次使用的模型记录');
      return false;
    }

    // 检查模型是否在支持的列表中
    const modelConfig = this.getModelConfig(lastModelId);
    if (!modelConfig) {
      console.log(`[ModelLoader] 上次使用的模型 ${lastModelId} 不在支持列表中`);
      return false;
    }

    // 检查模型是否已缓存
    const isCached = await this.isModelCached(lastModelId);
    if (!isCached) {
      console.log(`[ModelLoader] 上次使用的模型 ${lastModelId} 未缓存，跳过自动加载`);
      return false;
    }

    console.log(`[ModelLoader] 自动加载上次使用的模型: ${lastModelId}`);
    return this.loadModel(lastModelId, onProgress);
  }

  private async detectDeviceCapabilities(): Promise<void> {
    if ('deviceMemory' in navigator) {
      this.deviceMemory = (navigator as Navigator & { deviceMemory: number }).deviceMemory || 4;
    }

    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          console.log('WebGPU adapter available');
        }
      } catch {
        console.log('WebGPU adapter info not available');
      }
    }
  }

  getDeviceMemory(): number {
    return this.deviceMemory;
  }

  getRecommendedModel(): ModelConfig {
    const availableModels = SUPPORTED_MODELS.filter(
      (m) => m.minMemory <= this.deviceMemory
    );

    const recommended = availableModels.find((m) => m.recommended);
    if (recommended) return recommended;

    return availableModels.sort((a, b) => a.minMemory - b.minMemory)[0] || SUPPORTED_MODELS[0];
  }

  async checkWebGPUSupport(): Promise<{ supported: boolean; reason?: string }> {
    if (!navigator.gpu) {
      return {
        supported: false,
        reason: '您的浏览器不支持 WebGPU。请使用最新版本的 Chrome、Edge 或 Firefox 浏览器。',
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return {
          supported: false,
          reason: '无法获取 GPU 适配器。您的设备可能不支持 WebGPU 或 GPU 被禁用。',
        };
      }

      const device = await adapter.requestDevice();
      if (!device) {
        return {
          supported: false,
          reason: '无法创建 GPU 设备。请检查您的 GPU 驱动程序是否为最新版本。',
        };
      }

      // 测试基本操作 - 创建缓冲区
      try {
        const testBuffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM,
        });
        testBuffer.destroy();
      } catch (bufferError) {
        device.destroy();
        return {
          supported: false,
          reason: 'WebGPU 缓冲区操作失败，您的设备可能不完全兼容 WebGPU。',
        };
      }

      device.destroy();

      return { supported: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 检测特定的 WebGPU 错误
      if (errorMessage.includes('not captured') || errorMessage.includes('internal')) {
        return {
          supported: false,
          reason: 'WebGPU 内部错误，此设备可能存在兼容性问题。请尝试更换设备或使用支持 WebGPU 的浏览器。',
        };
      }

      return {
        supported: false,
        reason: `WebGPU 初始化失败: ${errorMessage}`,
      };
    }
  }

  async loadModel(
    modelId: string,
    onProgress?: (progress: number, status: string) => void
  ): Promise<boolean> {
    // 如果请求的模型已经加载，直接返回成功
    if (this.engine && this.currentModelId === modelId) {
      onProgress?.(100, '模型已加载');
      return true;
    }

    // 如果当前有模型正在加载，将新请求加入队列
    if (this.isLoading) {
      return new Promise((resolve, reject) => {
        // 检查队列中是否已有相同模型的请求
        const existingIndex = this.loadQueue.findIndex(item => item.modelId === modelId);
        if (existingIndex >= 0) {
          // 替换现有的请求，使用新的回调
          this.loadQueue[existingIndex] = { modelId, onProgress, resolve, reject };
        } else {
          // 添加新请求到队列
          this.loadQueue.push({ modelId, onProgress, resolve, reject });
        }
        onProgress?.(0, '等待当前模型加载完成...');
      });
    }

    // 执行实际加载
    return this.doLoadModel(modelId, onProgress);
  }

  private async doLoadModel(
    modelId: string,
    onProgress?: (progress: number, status: string) => void
  ): Promise<boolean> {
    // 如果有其他模型已加载，先卸载
    if (this.engine && this.currentModelId !== modelId) {
      await this.unloadModel();
    }

    const gpuCheck = await this.checkWebGPUSupport();
    if (!gpuCheck.supported) {
      onProgress?.(0, gpuCheck.reason || 'WebGPU 不支持');
      throw new Error(gpuCheck.reason);
    }

    this.isLoading = true;
    this.currentLoadingModelId = modelId;
    this.loadProgress = 0;
    this.loadStatus = '正在初始化...';
    onProgress?.(0, this.loadStatus);

    try {
      const modelConfig = this.getModelConfig(modelId);
      if (!modelConfig) {
        throw new Error(`不支持的模型: ${modelId}`);
      }

      if (modelConfig.minMemory > this.deviceMemory) {
        console.warn(
          `设备内存 (${this.deviceMemory}GB) 可能不足以运行此模型 (建议 ${modelConfig.minMemory}GB)`
        );
        onProgress?.(0, `警告: 设备内存可能不足，建议至少 ${modelConfig.minMemory}GB`);
      }

      this.loadStatus = '正在创建引擎...';
      onProgress?.(5, this.loadStatus);

      this.engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report: InitProgressReport) => {
          this.loadProgress = Math.round(report.progress * 100);
          // 汉化加载状态信息
          this.loadStatus = this.translateLoadingStatus(report.text);
          onProgress?.(this.loadProgress, this.loadStatus);
        },
        logLevel: 'INFO',
      });

      this.currentModelId = modelId;
      this.isLoading = false;
      this.currentLoadingModelId = null;
      this.loadProgress = 100;
      this.loadStatus = '模型加载完成';
      onProgress?.(100, this.loadStatus);

      // 保存上次使用的模型
      this.saveLastUsedModel(modelId);

      // 处理队列中的下一个请求
      this.processQueue();

      return true;
    } catch (error) {
      this.isLoading = false;
      this.currentLoadingModelId = null;
      this.engine = null;
      this.currentModelId = null;

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      if (errorMessage.includes('memory') || errorMessage.includes('OOM')) {
        onProgress?.(0, '内存不足，请尝试使用更小的模型或关闭其他应用程序');
        throw new Error('内存不足，无法加载模型。建议使用更小的模型或关闭其他应用程序以释放内存。');
      }

      onProgress?.(0, `加载失败: ${errorMessage}`);
      
      // 处理队列中的下一个请求（即使当前失败也继续）
      this.processQueue();
      
      throw new Error(`模型加载失败: ${errorMessage}`);
    }
  }

  private processQueue(): void {
    if (this.loadQueue.length === 0) return;

    // 取出队列中的下一个请求
    const nextItem = this.loadQueue.shift();
    if (!nextItem) return;

    const { modelId, onProgress, resolve, reject } = nextItem;

    // 延迟执行，让当前操作完成
    setTimeout(async () => {
      try {
        const result = await this.doLoadModel(modelId, onProgress);
        resolve(result);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 100);
  }

  getCurrentLoadingModelId(): string | null {
    return this.currentLoadingModelId;
  }

  isModelLoading(): boolean {
    return this.isLoading;
  }

  async unloadModel(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch (error) {
        console.error('卸载模型时出错:', error);
      }
      this.engine = null;
      this.currentModelId = null;
    }
    this.isLoading = false;
    this.loadProgress = 0;
    this.loadStatus = '';
  }

  async deleteModel(modelId: string): Promise<boolean> {
    try {
      // 如果当前正在运行这个模型，先卸载
      if (this.currentModelId === modelId && this.engine) {
        await this.unloadModel();
      }

      // 从缓存中删除模型文件
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        
        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          
          // 找出该模型的所有缓存文件
          const modelIdLower = modelId.toLowerCase();
          const modelIdParts = modelIdLower.split('-');
          const modelBaseName = modelIdParts[0];
          
          const modelRequests = requests.filter(req => {
            const url = req.url.toLowerCase();
            return url.includes(modelIdLower) ||
                   url.includes(modelBaseName) ||
                   url.includes(modelId.replace(/-/g, '').toLowerCase()) ||
                   url.includes(modelId.replace(/-/g, '_').toLowerCase());
          });

          // 删除匹配的缓存
          for (const request of modelRequests) {
            await cache.delete(request);
          }
        }
      }

      return true;
    } catch (error) {
      console.error('删除模型失败:', error);
      return false;
    }
  }

  isModelReady(): boolean {
    return this.engine !== null && !this.isLoading;
  }

  isModelLoaded(modelId: string): boolean {
    return this.engine !== null && this.currentModelId === modelId;
  }

  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  async isModelCached(modelId: string): Promise<boolean> {
    try {
      // WebLLM 缓存机制：
      // 1. 使用 Cache Storage 存储模型权重文件
      // 2. 缓存键通常是模型文件的 URL
      // 3. 需要检查是否包含该模型的关键文件

      if (!('caches' in window)) {
        return false;
      }

      const cacheNames = await caches.keys();
      
      // WebLLM 通常使用包含模型ID的缓存名
      // 或者使用默认的 "webllm-cache" 等名称
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        
        // 检查缓存中是否有该模型的文件
        // 模型文件通常包含模型ID或模型名称
        const modelFiles = requests.filter(req => {
          const url = req.url.toLowerCase();
          const modelIdLower = modelId.toLowerCase();
          const modelIdParts = modelIdLower.split('-');
          
          // 检查 URL 是否包含模型ID或其部分
          return url.includes(modelIdLower) ||
                 url.includes(modelIdParts[0]) || // 模型系列名如 "qwen3", "llama"
                 url.includes(modelId.replace(/-/g, '').toLowerCase()) ||
                 url.includes(modelId.replace(/-/g, '_').toLowerCase());
        });

        // 如果找到多个相关文件，认为模型已缓存
        if (modelFiles.length > 5) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  async getCachedModels(): Promise<string[]> {
    const cachedModels: string[] = [];
    
    try {
      if (!('caches' in window)) {
        return cachedModels;
      }

      const cacheNames = await caches.keys();
      const allRequests: Request[] = [];

      // 收集所有缓存中的请求
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        allRequests.push(...requests);
      }

      // 检查每个支持的模型
      for (const model of SUPPORTED_MODELS) {
        const modelId = model.modelId;
        const modelIdLower = modelId.toLowerCase();
        const modelIdParts = modelIdLower.split('-');
        const modelBaseName = modelIdParts[0]; // 如 "qwen3", "llama"

        // 统计该模型的缓存文件数量
        const modelFiles = allRequests.filter(req => {
          const url = req.url.toLowerCase();
          return url.includes(modelIdLower) ||
                 url.includes(modelBaseName) ||
                 url.includes(modelId.replace(/-/g, '').toLowerCase()) ||
                 url.includes(modelId.replace(/-/g, '_').toLowerCase());
        });

        // 如果缓存文件数量足够（WebLLM 模型通常有几十个文件），认为已缓存
        if (modelFiles.length > 10) {
          cachedModels.push(model.modelId);
        }
      }
    } catch {
      // 忽略错误
    }
    
    return cachedModels;
  }

  getLoadProgress(): { progress: number; status: string } {
    return {
      progress: this.loadProgress,
      status: this.loadStatus,
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.engine) {
      throw new Error('模型未加载，请先调用 loadModel()');
    }

    const maxTokens = options?.maxTokens ?? 512;
    const temperature = options?.temperature ?? 0.7;
    // 手机端需要更长的超时时间，默认 120 秒
    const timeout = options?.timeout ?? 120000;

    const generatePromise = (async () => {
      const completion = await this.engine!.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: 0.9,
      });

      const choice = completion.choices[0];
      return choice?.message?.content || '';
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`生成超时 (${timeout}ms)`));
      }, timeout);
    });

    try {
      return await Promise.race([generatePromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('超时')) {
        throw error;
      }
      throw new Error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async generateStream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: GenerateOptions
  ): Promise<string> {
    if (!this.engine) {
      throw new Error('模型未加载，请先调用 loadModel()');
    }

    const maxTokens = options?.maxTokens ?? 512;
    const temperature = options?.temperature ?? 0.7;

    try {
      const stream = await this.engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: 0.9,
        stream: true,
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullResponse += delta;
          onChunk(delta);
        }
      }

      return fullResponse;
    } catch (error) {
      throw new Error(`流式生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  getModelConfig(modelId: string): ModelConfig | undefined {
    return SUPPORTED_MODELS.find((m) => m.modelId === modelId);
  }

  getSupportedModels(): ModelConfig[] {
    return SUPPORTED_MODELS.filter((m) => m.minMemory <= this.deviceMemory);
  }

  getAllModels(): ModelConfig[] {
    return SUPPORTED_MODELS;
  }

  getMemoryOptimizedConfig(modelId: string): { contextLength: number } {
    const config = this.getModelConfig(modelId);
    if (!config) {
      return { contextLength: 2048 };
    }

    if (this.deviceMemory <= 2) {
      return { contextLength: Math.min(config.contextLength, 1024) };
    } else if (this.deviceMemory <= 4) {
      return { contextLength: Math.min(config.contextLength, 2048) };
    }

    return { contextLength: config.contextLength };
  }

  private translateLoadingStatus(englishStatus: string): string {
    // WebLLM 加载状态汉化映射
    const statusMap: Record<string, string> = {
      'Downloading model weights': '正在下载模型权重',
      'Downloading': '正在下载',
      'Loading model weights': '正在加载模型权重',
      'Loading': '正在加载',
      'Initializing': '正在初始化',
      'Initializing WebGPU': '正在初始化 WebGPU',
      'Initializing model': '正在初始化模型',
      'Fetching': '正在获取',
      'Start to fetch params': '开始获取模型参数',
      'Fetching params': '正在获取模型参数',
      'Compiling': '正在编译',
      'Ready': '就绪',
      'Finish': '完成',
      'Finished': '已完成',
    };

    // 尝试匹配前缀
    for (const [key, value] of Object.entries(statusMap)) {
      if (englishStatus.includes(key)) {
        // 保留进度信息（如果有）
        const progressMatch = englishStatus.match(/(\d+)%/);
        if (progressMatch) {
          return `${value} (${progressMatch[1]}%)`;
        }
        return value;
      }
    }

    // 如果无法匹配，返回原文
    return englishStatus;
  }
}

export const modelLoader = new ModelLoaderService();

export async function initializeModelLoader(): Promise<void> {
  await modelLoader.initialize();
}

export type { ModelLoaderService };
