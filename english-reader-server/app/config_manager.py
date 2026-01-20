"""
AI Configuration Manager
========================
管理 AI 模型配置的读取、更新和持久化
"""

import os
from pathlib import Path
from typing import Optional, Dict
from dotenv import load_dotenv, set_key


class AIConfigManager:
    """AI 配置管理器"""

    # 支持的 AI 提供商预设配置
    PROVIDER_PRESETS = {
        "doubao": {
            "name": "豆包 (Doubao)",
            "provider_type": "openai",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "model_name": "doubao-pro-4k",
            "needs_api_key": True
        },
        "qwen": {
            "name": "通义千问 (Qwen)",
            "provider_type": "openai",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "model_name": "qwen-turbo",
            "needs_api_key": True
        },
        "deepseek": {
            "name": "DeepSeek",
            "provider_type": "openai",
            "base_url": "https://api.deepseek.com/v1",
            "model_name": "deepseek-chat",
            "needs_api_key": True
        },
        "openai": {
            "name": "OpenAI",
            "provider_type": "openai",
            "base_url": "https://api.openai.com/v1",
            "model_name": "gpt-3.5-turbo",
            "needs_api_key": True
        },
        "gemini": {
            "name": "Google Gemini",
            "provider_type": "gemini",
            "base_url": None,
            "model_name": "gemini-1.5-flash",
            "needs_api_key": True
        },
        "moonshot": {
            "name": "Moonshot (月之暗面)",
            "provider_type": "openai",
            "base_url": "https://api.moonshot.cn/v1",
            "model_name": "moonshot-v1-8k",
            "needs_api_key": True
        },
        "zhipu": {
            "name": "智谱 AI (GLM)",
            "provider_type": "openai",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "model_name": "glm-4-flash",
            "needs_api_key": True
        },
        "custom": {
            "name": "自定义 (Custom)",
            "provider_type": "openai",
            "base_url": "",
            "model_name": "",
            "needs_api_key": True
        }
    }

    def __init__(self, env_path: Path):
        self.env_path = env_path
        self.load_config()

    def load_config(self):
        """从 .env 文件加载配置"""
        load_dotenv(dotenv_path=self.env_path)

    def get_current_config(self) -> Dict:
        """获取当前配置"""
        provider = os.getenv("AI_PROVIDER", "openai")

        config = {
            "provider": provider,
            "use_proxy": os.getenv("USE_PROXY", "false").lower() == "true",
            "http_proxy": os.getenv("HTTP_PROXY", ""),
            "https_proxy": os.getenv("HTTPS_PROXY", "")
        }

        if provider == "gemini":
            config.update({
                "gemini_api_key": os.getenv("GEMINI_API_KEY", ""),
                "gemini_model_name": os.getenv("GEMINI_MODEL_NAME", "gemini-1.5-flash")
            })
        else:
            config.update({
                "api_key": os.getenv("AI_API_KEY", ""),
                "base_url": os.getenv("AI_BASE_URL", ""),
                "model_name": os.getenv("AI_MODEL_NAME", "")
            })

        return config

    def update_config(self, config: Dict) -> bool:
        """更新配置到 .env 文件"""
        try:
            # 更新代理配置
            set_key(str(self.env_path), "USE_PROXY", "true" if config.get("use_proxy") else "false")
            if config.get("http_proxy"):
                set_key(str(self.env_path), "HTTP_PROXY", config["http_proxy"])
            if config.get("https_proxy"):
                set_key(str(self.env_path), "HTTPS_PROXY", config["https_proxy"])

            # 更新 AI 提供商
            provider = config.get("provider", "openai")
            set_key(str(self.env_path), "AI_PROVIDER", provider)

            if provider == "gemini":
                # Gemini 配置
                set_key(str(self.env_path), "GEMINI_API_KEY", config.get("gemini_api_key", ""))
                set_key(str(self.env_path), "GEMINI_MODEL_NAME", config.get("gemini_model_name", "gemini-1.5-flash"))
            else:
                # OpenAI 兼容 API 配置
                set_key(str(self.env_path), "AI_API_KEY", config.get("api_key", ""))
                set_key(str(self.env_path), "AI_BASE_URL", config.get("base_url", ""))
                set_key(str(self.env_path), "AI_MODEL_NAME", config.get("model_name", ""))

            # 重新加载配置
            self.load_config()
            return True

        except Exception as e:
            print(f"Error updating config: {e}")
            return False

    def get_provider_preset(self, provider_id: str) -> Optional[Dict]:
        """获取提供商预设配置"""
        return self.PROVIDER_PRESETS.get(provider_id)

    def get_all_providers(self) -> Dict:
        """获取所有可用的提供商"""
        return self.PROVIDER_PRESETS


# 全局配置管理器实例
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
config_manager = AIConfigManager(ENV_PATH)
