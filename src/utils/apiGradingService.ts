import { APIModelConfig } from '../types';
import { modelConfigLoader } from './modelConfigLoader';

export interface APIGradingConfig {
  apiKey: string;
  model: string;
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

  // 根据模型ID查找提供商
  private findProviderByModel(modelId: string): { providerId: string; endpoint: string } | null {
    const config = modelConfigLoader.getConfig();
    if (!config) return null;

    for (const provider of config.providers) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        return { providerId: provider.id, endpoint: provider.endpoint };
      }
    }
    return null;
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

    // 从配置文件获取端点
    const providerInfo = this.findProviderByModel(this.config.model);
    if (!providerInfo) {
      throw new Error('未找到模型配置');
    }

    const endpoint = providerInfo.endpoint;
    const modelId = this.config.model;

    console.log('[API判题] 发送流式请求到:', endpoint);
    console.log('[API判题] 使用模型:', modelId);

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
              // 支持 content 和 reasoning_content 两种字段
              const content = parsed.choices?.[0]?.delta?.content || '';
              const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content || '';
              const actualContent = content || reasoningContent;
              if (actualContent) {
                fullResponse += actualContent;
                callbacks?.onChunk?.(actualContent);
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

    // 从配置文件获取端点
    const providerInfo = this.findProviderByModel(this.config.model);
    if (!providerInfo) {
      throw new Error('未找到模型配置');
    }

    const endpoint = providerInfo.endpoint;
    const modelId = this.config.model;

    console.log('[API判题] 发送请求到:', endpoint);
    console.log('[API判题] 使用模型:', modelId);

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
