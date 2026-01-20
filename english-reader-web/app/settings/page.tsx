'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAIConfig, saveAIConfig, hasAIConfig, getAIConfigForAPI, type AIConfig } from '../../lib/aiConfig';

// API 基础地址
const API_BASE = 'http://127.0.0.1:8000';

// 类型定义
interface Provider {
  [key: string]: {
    name: string;
    provider_type: string;
    base_url: string;
    model_name: string;
    needs_api_key: boolean;
  };
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [providers, setProviders] = useState<Provider>({});
  const [config, setConfig] = useState<AIConfig>({
    provider: 'openai',
    api_key: '',
    base_url: '',
    model_name: '',
    gemini_api_key: '',
    gemini_model_name: 'gemini-1.5-flash',
    use_proxy: false,
    http_proxy: 'http://127.0.0.1:7897',
    https_proxy: 'http://127.0.0.1:7897'
  });

  // 加载提供商列表和本地配置
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 从服务器获取提供商列表
      const providersRes = await fetch(`${API_BASE}/api/config/providers`);
      if (!providersRes.ok) {
        throw new Error('加载提供商列表失败');
      }

      const providersData = await providersRes.json();
      setProviders(providersData.providers);

      // 从 localStorage 加载用户的配置
      const savedConfig = getAIConfig();
      setConfig(savedConfig);
    } catch (error) {
      showMessage('error', `加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleProviderChange = (providerId: string) => {
    const preset = providers[providerId];
    if (preset) {
      setConfig({
        ...config,
        provider: providerId,
        base_url: preset.base_url || '',
        model_name: preset.model_name || ''
      });
    }
  };

  const handleSave = () => {
    try {
      // 验证必填字段
      if (config.provider === 'gemini') {
        if (!config.gemini_api_key) {
          showMessage('error', '请输入 Gemini API Key');
          return;
        }
      } else {
        if (!config.api_key) {
          showMessage('error', '请输入 API Key');
          return;
        }
        if (!config.base_url) {
          showMessage('error', '请输入 Base URL');
          return;
        }
        if (!config.model_name) {
          showMessage('error', '请输入模型名称');
          return;
        }
      }

      // 保存到 localStorage
      saveAIConfig(config);
      showMessage('success', '配置已保存！配置保存在您的浏览器中，随时可用。');
    } catch (error) {
      showMessage('error', `保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);

      // 验证必填字段
      if (config.provider === 'gemini') {
        if (!config.gemini_api_key) {
          showMessage('error', '请输入 Gemini API Key');
          return;
        }
      } else {
        if (!config.api_key) {
          showMessage('error', '请输入 API Key');
          return;
        }
        if (!config.base_url) {
          showMessage('error', '请输入 Base URL');
          return;
        }
        if (!config.model_name) {
          showMessage('error', '请输入模型名称');
          return;
        }
      }

      // 使用当前配置进行测试
      const res = await fetch(`${API_BASE}/api/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || '测试失败');
      }

      showMessage('success', `连接成功！测试翻译: ${data.test_result}`);
    } catch (error) {
      showMessage('error', `测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = hasAIConfig();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">AI 模型配置</h1>
            {isConfigured && (
              <p className="text-green-400 text-sm mt-1">✓ 已配置 - 配置保存在您的浏览器中</p>
            )}
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
          >
            返回首页
          </button>
        </div>

        {/* 消息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-6">
          {/* AI 提供商选择 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-white mb-4">选择 AI 服务提供商</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(providers).map(([id, provider]) => (
                <button
                  key={id}
                  onClick={() => handleProviderChange(id)}
                  className={`p-4 rounded-lg text-left transition ${
                    config.provider === id
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <div className="font-medium">{provider.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* OpenAI 兼容 API 配置 */}
          {config.provider !== 'gemini' && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">API 配置</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 mb-2">API Key *</label>
                  <input
                    type="password"
                    value={config.api_key}
                    onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="输入你的 API Key"
                  />
                </div>

                <div>
                  <label className="block text-gray-300 mb-2">Base URL *</label>
                  <input
                    type="text"
                    value={config.base_url}
                    onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="https://api.example.com/v1"
                  />
                </div>

                <div>
                  <label className="block text-gray-300 mb-2">模型名称 *</label>
                  <input
                    type="text"
                    value={config.model_name}
                    onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="gpt-3.5-turbo"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Gemini 配置 */}
          {config.provider === 'gemini' && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Gemini API 配置</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 mb-2">Gemini API Key *</label>
                  <input
                    type="password"
                    value={config.gemini_api_key}
                    onChange={(e) => setConfig({ ...config, gemini_api_key: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="输入你的 Gemini API Key"
                  />
                </div>

                <div>
                  <label className="block text-gray-300 mb-2">模型名称</label>
                  <input
                    type="text"
                    value={config.gemini_model_name}
                    onChange={(e) => setConfig({ ...config, gemini_model_name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="gemini-1.5-flash"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 代理配置 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-white mb-4">代理设置（仅后端使用）</h2>
            <div className="space-y-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="use_proxy"
                  checked={config.use_proxy}
                  onChange={(e) => setConfig({ ...config, use_proxy: e.target.checked })}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="use_proxy" className="ml-2 text-gray-300">使用代理</label>
              </div>

              {config.use_proxy && (
                <>
                  <div>
                    <label className="block text-gray-300 mb-2">HTTP Proxy</label>
                    <input
                      type="text"
                      value={config.http_proxy}
                      onChange={(e) => setConfig({ ...config, http_proxy: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                      placeholder="http://127.0.0.1:7897"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-300 mb-2">HTTPS Proxy</label>
                    <input
                      type="text"
                      value={config.https_proxy}
                      onChange={(e) => setConfig({ ...config, https_proxy: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                      placeholder="http://127.0.0.1:7897"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-4">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex-1 px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? '测试中...' : '测试连接'}
            </button>

            <button
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              保存配置
            </button>
          </div>

          {/* 提示信息 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-yellow-400 mb-2">提示</h3>
            <ul className="text-gray-400 space-y-1 text-sm">
              <li>• 配置保存在您的浏览器中，安全且私密</li>
              <li>• 保存后立即生效，无需重启后端服务</li>
              <li>• 每次翻译和查词时会自动使用你的配置</li>
              <li>• 点击"测试连接"可以验证 API 配置是否正确</li>
              <li>• 清除浏览器数据会删除配置，请妥善保存</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
