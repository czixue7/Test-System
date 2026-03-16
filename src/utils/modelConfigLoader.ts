export interface ProviderModel {
  id: string;
  name: string;
  maxTokens: number;
  encryptedKey: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  endpoint: string;
  models: ProviderModel[];
}

export interface ModelsConfig {
  providers: ProviderConfig[];
}

// 将字符串转换为 Uint8Array
function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xFF;
  }
  return bytes;
}

// 将 Uint8Array 转换为字符串
function bytesToString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

// XOR 加密（使用密码对数据进行异或）
function xorEncrypt(data: Uint8Array, password: string): Uint8Array {
  const result = new Uint8Array(data.length);
  const passBytes = stringToBytes(password);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ passBytes[i % passBytes.length];
  }
  return result;
}

// Base64 解码
function base64Decode(str: string): Uint8Array | null {
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

class ModelConfigLoader {
  private config: ModelsConfig | null = null;
  private decryptedKeys: Map<string, string> = new Map();

  async loadConfig(): Promise<ModelsConfig | null> {
    try {
      const response = await fetch('/models.json');
      if (!response.ok) {
        throw new Error('Failed to load models config');
      }
      this.config = await response.json();
      return this.config;
    } catch (error) {
      console.error('Failed to load models config:', error);
      return null;
    }
  }

  getConfig(): ModelsConfig | null {
    return this.config;
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.config?.providers.find(p => p.id === providerId);
  }

  getModel(providerId: string, modelId: string): ProviderModel | undefined {
    const provider = this.getProvider(providerId);
    return provider?.models.find(m => m.id === modelId);
  }

  getAllModels(): { provider: ProviderConfig; model: ProviderModel }[] {
    const result: { provider: ProviderConfig; model: ProviderModel }[] = [];
    this.config?.providers.forEach(provider => {
      provider.models.forEach(model => {
        result.push({ provider, model });
      });
    });
    return result;
  }

  getModelsByProvider(providerId: string): ProviderModel[] {
    const provider = this.getProvider(providerId);
    return provider?.models || [];
  }

  // 使用密码解密 API Key
  decryptApiKey(encryptedKey: string, password: string): string {
    if (!encryptedKey) return '';

    const cacheKey = `${encryptedKey}_${password}`;
    if (this.decryptedKeys.has(cacheKey)) {
      return this.decryptedKeys.get(cacheKey)!;
    }

    // Base64 解码
    const encrypted = base64Decode(encryptedKey);
    if (!encrypted) return '';

    // XOR 解密
    const decrypted = xorEncrypt(encrypted, password);

    // 转换回字符串
    const result = bytesToString(decrypted);
    this.decryptedKeys.set(cacheKey, result);
    return result;
  }

  // 获取解密的 API Key
  getDecryptedApiKey(providerId: string, modelId: string, password: string): string {
    const model = this.getModel(providerId, modelId);
    if (!model?.encryptedKey) return '';
    return this.decryptApiKey(model.encryptedKey, password);
  }

  // 验证密码是否正确（通过尝试解密）
  verifyPassword(password: string): boolean {
    // 尝试解密第一个模型的 key 来验证密码
    const allModels = this.getAllModels();
    for (const { model } of allModels) {
      if (model.encryptedKey) {
        const decrypted = this.decryptApiKey(model.encryptedKey, password);
        // 如果解密结果看起来像一个有效的 API Key（长度大于10），则认为密码正确
        if (decrypted.length > 10) {
          return true;
        }
      }
    }
    return false;
  }
}

export const modelConfigLoader = new ModelConfigLoader();
