export interface WebLLMDownloadTask {
  id: string;
  modelId: string;
  progress: number;
  status: 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled';
  statusText: string;
  error?: string;
}

class WebLLMDownloadManager {
  private tasks: Map<string, WebLLMDownloadTask> = new Map();
  private listeners: Set<(tasks: WebLLMDownloadTask[]) => void> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();

  subscribe(listener: (tasks: WebLLMDownloadTask[]) => void): () => void {
    this.listeners.add(listener);
    listener(Array.from(this.tasks.values()));
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const tasks = Array.from(this.tasks.values());
    this.listeners.forEach(listener => listener(tasks));
  }

  startDownload(modelId: string): string {
    const id = `webllm-${modelId}`;
    const existing = this.tasks.get(id);
    
    if (existing) {
      if (existing.status === 'downloading') {
        return id;
      }
      if (existing.status === 'paused') {
        existing.status = 'downloading';
        this.tasks.set(id, existing);
        this.notify();
        return id;
      }
      if (existing.status === 'completed') {
        return id;
      }
    }

    const task: WebLLMDownloadTask = {
      id,
      modelId,
      progress: 0,
      status: 'downloading',
      statusText: '准备下载...'
    };

    this.tasks.set(id, task);
    this.notify();

    return id;
  }

  updateProgress(id: string, progress: number, statusText: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'downloading') {
      task.progress = progress;
      task.statusText = statusText;
      this.tasks.set(id, task);
      this.notify();
    }
  }

  completeDownload(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.progress = 100;
      task.status = 'completed';
      task.statusText = '下载完成';
      this.tasks.set(id, task);
      this.notify();
    }
  }

  failDownload(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'error';
      task.error = error;
      task.statusText = '下载失败';
      this.tasks.set(id, task);
      this.notify();
    }
  }

  pauseDownload(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'downloading') {
      task.status = 'paused';
      task.statusText = '已暂停';
      this.tasks.set(id, task);
      
      // 触发中止信号
      const controller = this.abortControllers.get(id);
      if (controller) {
        controller.abort();
      }
      
      this.notify();
    }
  }

  resumeDownload(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'paused') {
      task.status = 'downloading';
      task.statusText = '继续下载...';
      this.tasks.set(id, task);
      this.notify();
    }
  }

  cancelDownload(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      // 触发中止信号
      const controller = this.abortControllers.get(id);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(id);
      }
      
      task.status = 'cancelled';
      task.statusText = '已取消';
      this.tasks.set(id, task);
      this.notify();
    }
  }

  deleteDownload(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      // 如果正在下载，先取消
      if (task.status === 'downloading') {
        this.cancelDownload(id);
      }
      
      this.tasks.delete(id);
      this.abortControllers.delete(id);
      this.notify();
    }
  }

  getTask(id: string): WebLLMDownloadTask | undefined {
    return this.tasks.get(id);
  }

  getTaskByModelId(modelId: string): WebLLMDownloadTask | undefined {
    return this.tasks.get(`webllm-${modelId}`);
  }

  setAbortController(id: string, controller: AbortController): void {
    this.abortControllers.set(id, controller);
  }

  getAbortController(id: string): AbortController | undefined {
    return this.abortControllers.get(id);
  }
}

export const webllmDownloadManager = new WebLLMDownloadManager();
