export interface APIGradingConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
}

// 流式判题回调，支持逐题解析完成通知
export interface GradingStreamCallbacks {
  onQuestionParsed?: (questionIndex: number, questionContent: string) => void;
  onQuestionComplete?: (questionIndex: number, result: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
}

export type APIProvider = 'zhipu' | 'volcengine' | 'unknown';

/** 单次请求总超时 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * 带超时的 AbortSignal。
 * 之前所有请求都没有超时/取消：API 端连接被中间设备静默丢弃时 await 永不 settle，
 * 交卷界面会永久卡在「AI 判题中」（catch/finally 都不执行），
 * 知识库问答的 searching 也永远是 true，用户只能强杀应用。
 */
function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
    timedOut: () => didTimeout,
  };
}

function toAbortError(error: unknown, timedOut: boolean, timeoutMs: number): Error {
  if (timedOut) {
    return new Error(`API 请求超时（${Math.round(timeoutMs / 1000)} 秒无响应），已中止`);
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return new Error('API 请求已被中止');
    return error;
  }
  return new Error('未知错误');
}

class APIGradingService {
  private config: APIGradingConfig | null = null;

  setConfig(config: APIGradingConfig): void {
    this.config = config;
  }

  getConfig(): APIGradingConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.apiKey.length > 0;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'API未配置' };
    }

    try {
      await this.callAPI('测试连接', 50);
      return { success: true, message: 'API连接成功' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      return { success: false, message: `连接失败: ${errorMessage}` };
    }
  }

  async warmUp(): Promise<boolean> {
    const result = await this.testConnection();
    return result.success;
  }

  async gradeWithStream(
    prompt: string,
    maxTokens: number,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    if (!this.config) {
      throw new Error('API未配置');
    }

    const endpoint = this.config.endpoint;
    const modelId = this.config.model;

    console.log('[API判题] 发送流式请求到:', endpoint);
    console.log('[API判题] 使用模型:', modelId);

    const guard = createTimeoutSignal(REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.1,
          stream: true,
        }),
        signal: guard.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let contentAcc = '';
      let reasoningAcc = '';
      // ⚠️ 跨 chunk 的行缓冲：SSE 帧不保证与网络分片对齐，
      // 旧实现直接 chunk.split('\n')，被切断的 data: 行会 JSON.parse 失败
      // 并被 catch{} 静默丢弃（回答缺字、判题降级且无从察觉）。
      let buffer = '';

      const handleLine = (rawLine: string) => {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        // SSE 规范允许 "data:" 后不带空格
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trimStart();
        if (!data || data === '[DONE]') return;

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          console.warn('[API判题] 跳过无法解析的 SSE 数据块:', data.slice(0, 120));
          return;
        }

        const delta = parsed?.choices?.[0]?.delta;
        const content: string = delta?.content || '';
        const reasoning: string = delta?.reasoning_content || '';

        if (content) {
          contentAcc += content;
          callbacks?.onChunk?.(content);
        } else if (reasoning) {
          // 推理内容先单独累积：只有当最终没有任何正式内容时才作为兜底返回，
          // 避免把推理过程当作答案去做正则判分
          reasoningAcc += reasoning;
          callbacks?.onChunk?.(reasoning);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最后一段可能是不完整的行，留到下一次读取
        buffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      }

      // 冲刷解码器与残留缓冲
      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split('\n')) handleLine(line);
      }

      const fullResponse = contentAcc || reasoningAcc;
      if (!fullResponse) {
        throw new Error('API 流式响应为空（未收到任何内容）');
      }

      callbacks?.onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      const err = toAbortError(error, guard.timedOut(), REQUEST_TIMEOUT_MS);
      callbacks?.onError?.(err);
      throw err;
    } finally {
      guard.clear();
    }
  }

  async callAPI(prompt: string, maxTokens: number): Promise<string> {
    if (!this.config) {
      throw new Error('API未配置');
    }

    const endpoint = this.config.endpoint;
    const modelId = this.config.model;

    console.log('[API判题] 发送请求到:', endpoint);
    console.log('[API判题] 使用模型:', modelId);

    const guard = createTimeoutSignal(REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.1,
        }),
        signal: guard.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[API判题] 请求失败:', response.status, errorText);
        throw new Error(`API请求失败: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      // 与流式路径保持一致地兜底 reasoning_content
      const content: string = message?.content || message?.reasoning_content || '';

      console.log('[API判题] 响应内容:', content.substring(0, 200) + '...');

      if (!content) {
        // 不能再静默返回 ''：知识库总结会把空串 filter 掉并缓存出一份空文档
        throw new Error('API 返回了空内容（模型未作答或响应结构异常）');
      }

      return content;
    } catch (error) {
      throw toAbortError(error, guard.timedOut(), REQUEST_TIMEOUT_MS);
    } finally {
      guard.clear();
    }
  }
}

export const apiGradingService = new APIGradingService();
