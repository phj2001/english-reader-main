/**
 * AI 配置管理工具
 * 将配置保存在浏览器的 localStorage 中
 */

export interface AIConfig {
  provider: string;
  api_key: string;
  base_url: string;
  model_name: string;
  gemini_api_key: string;
  gemini_model_name: string;
  use_proxy: boolean;
  http_proxy: string;
  https_proxy: string;
}

const CONFIG_KEY = 'english_reader_ai_config';

// 默认配置
const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  api_key: '',
  base_url: '',
  model_name: '',
  gemini_api_key: '',
  gemini_model_name: 'gemini-1.5-flash',
  use_proxy: false,
  http_proxy: 'http://127.0.0.1:7897',
  https_proxy: 'http://127.0.0.1:7897'
};

/**
 * 获取保存的配置
 */
export function getAIConfig(): AIConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.error('Error loading AI config:', error);
  }

  return DEFAULT_CONFIG;
}

/**
 * 保存配置到 localStorage
 */
export function saveAIConfig(config: AIConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Error saving AI config:', error);
  }
}

/**
 * 清除保存的配置
 */
export function clearAIConfig(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch (error) {
    console.error('Error clearing AI config:', error);
  }
}

/**
 * 检查是否已配置
 */
export function hasAIConfig(): boolean {
  const config = getAIConfig();

  if (config.provider === 'gemini') {
    return !!config.gemini_api_key;
  } else {
    return !!config.api_key && !!config.base_url && !!config.model_name;
  }
}

/**
 * 获取用于 API 请求的配置参数
 * 返回需要传递给后端的参数对象
 */
export function getAIConfigForAPI() {
  const config = getAIConfig();

  // 如果没有配置，返回空对象（使用后端默认配置）
  if (!hasAIConfig()) {
    return {};
  }

  if (config.provider === 'gemini') {
    return {
      ai_provider: 'gemini',
      gemini_api_key: config.gemini_api_key,
      gemini_model_name: config.gemini_model_name
    };
  } else {
    return {
      ai_provider: config.provider,
      ai_api_key: config.api_key,
      ai_base_url: config.base_url,
      ai_model_name: config.model_name
    };
  }
}
