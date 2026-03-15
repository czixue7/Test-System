import { APIModelConfig, API_MODELS } from '../types';

export interface APIGradingConfig {
  apiKey: string;
  model: string;
  endpoint?: string;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
}

const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

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

  getAvailableModels(): APIModelConfig[] {
    return API_MODELS;
  }

  getModelConfig(modelId: string): APIModelConfig | undefined {
    return API_MODELS.find(m => m.id === modelId);
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

    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const model = this.getModelConfig(this.config.model);
    const actualMaxTokens = Math.min(maxTokens, model?.maxTokens || 4096);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: actualMaxTokens,
          temperature: 0.1,
          stream: true,
        }),
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
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                callbacks?.onChunk?.(content);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      callbacks?.onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('未知错误');
      callbacks?.onError?.(err);
      throw err;
    }
  }

  async callAPI(prompt: string, maxTokens: number): Promise<string> {
    if (!this.config) {
      throw new Error('API未配置');
    }

    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const model = this.getModelConfig(this.config.model);
    const actualMaxTokens = Math.min(maxTokens, model?.maxTokens || 4096);

    console.log('[API判题] 发送请求到:', endpoint);
    console.log('[API判题] 使用模型:', this.config.model);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: actualMaxTokens,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API判题] 请求失败:', response.status, errorText);
      throw new Error(`API请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('[API判题] 响应内容:', content.substring(0, 200) + '...');
    
    return content;
  }

  async callAPIBatch(prompts: string[], maxTokens: number): Promise<string> {
    if (!this.config) {
      throw new Error('API未配置');
    }

    // 如果只有一个prompt，直接调用callAPI
    if (prompts.length === 1) {
      console.log('[API批量判题] 只有1个prompt，直接调用callAPI');
      return this.callAPI(prompts[0], maxTokens);
    }

    // 多个prompt合并为一个
    console.log(`[API批量判题] 合并 ${prompts.length} 个prompt为一次请求`);

    const separator = '\n\n========== 批量请求分隔线 ==========\n\n';
    const combinedPrompt = prompts.map((prompt, index) => {
      return `【请求 ${index + 1}】\n${prompt}`;
    }).join(separator);

    const finalPrompt = `以下包含 ${prompts.length} 个独立的判题请求，请分别处理并返回每个请求的结果。\n\n${combinedPrompt}\n\n请确保返回所有 ${prompts.length} 个请求的结果，每个请求的结果用【请求 X 结果】标识。`;

    const response = await this.callAPI(finalPrompt, maxTokens * prompts.length);

    return response;
  }
}

export const apiGradingService = new APIGradingService();
