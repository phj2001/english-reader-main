"""
AI Service - 支持多种大模型 API
==============================

支持的模型提供商（都使用 OpenAI 兼容格式）：
- Google Gemini (通过 google-genai SDK)
- 豆包 (Doubao)
- 通义千问 (Qwen)
- DeepSeek
- OpenAI
- 其他 OpenAI 兼容 API

配置方式：在 .env 文件中设置以下参数
"""

import os
from openai import OpenAI

class AIService:
    """
    通用 AI 服务类，支持 OpenAI 兼容的 API
    包括：豆包、通义、DeepSeek、OpenAI 等
    """
    
    def __init__(self, api_key: str, base_url: str, model_name: str):
        if not api_key:
            raise RuntimeError("❌ AI_API_KEY is missing")
        if not model_name:
            raise RuntimeError("❌ AI_MODEL_NAME is missing")
            
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model_name = model_name
        print(f"✅ AI Service initialized")
        print(f"   Model: {self.model_name}")
        print(f"   API Base: {base_url}")

    def explain_word(self, word: str, sentence: str) -> tuple[str, str]:
        prompt = f"""你是一个专业的英语语义分析助手。

请仅根据给定句子中的上下文，
解释单词 "{word}" 在该句中的具体含义。

句子：
"{sentence}"

要求：
1. 第一行：仅输出中文含义（如：可持续的），不要包含"中文释义"等前缀。
2. 第二行：仅输出一句话的语境解释（如：描述的是发展和环境保护能够长期维持的状态。），不要包含"语义功能"等前缀。
3. 不要列出其他词义
4. 不要翻译整个句子
5. 严格只输出这两行内容
"""
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
            content = response.choices[0].message.content.strip()
            lines = [l for l in content.splitlines() if l.strip()]
            meaning = lines[0] if lines else "解析失败"
            explanation = lines[1] if len(lines) > 1 else lines[0] if lines else "无法获取解释"
            return meaning, explanation
        except Exception as e:
            return "服务错误", f"模型调用失败：{e}"

    def translate_text(self, text: str) -> str:
        prompt = f"""你是一个专业的学术英语翻译助手。

请将以下英文内容准确翻译为中文。

要求：
1. 忠实原意，不要随意扩展
2. 使用学术/正式中文表达
3. 不要添加解释或注释
4. 只输出翻译结果

英文原文：
{text}
"""
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            return f"翻译失败：{e}"


# ============================================
# 保留 Gemini 原生支持（可选）
# ============================================
try:
    from google import genai
    
    class GeminiService:
        """Google Gemini 原生 API（使用 google-genai SDK）"""
        
        def __init__(self, api_key: str, model_name: str = "gemini-1.5-flash"):
            if not api_key:
                raise RuntimeError("❌ GEMINI_API_KEY is missing")
            self.client = genai.Client(api_key=api_key)
            self.model_name = model_name
            print(f"✅ Gemini Service initialized with model: {self.model_name}")

        def explain_word(self, word: str, sentence: str) -> tuple[str, str]:
            prompt = f"""你是一个专业的英语语义分析助手。

请仅根据给定句子中的上下文，
解释单词 "{word}" 在该句中的具体含义。

句子：
"{sentence}"

要求：
1. 第一行：仅输出中文含义（如：可持续的），不要包含"中文释义"等前缀。
2. 第二行：仅输出一句话的语境解释（如：描述的是发展和环境保护能够长期维持的状态。），不要包含"语义功能"等前缀。
3. 不要列出其他词义
4. 不要翻译整个句子
5. 严格只输出这两行内容
"""
            try:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt
                )
                content = response.text.strip()
                lines = [l for l in content.splitlines() if l.strip()]
                meaning = lines[0] if lines else "解析失败"
                explanation = lines[1] if len(lines) > 1 else lines[0] if lines else "无法获取解释"
                return meaning, explanation
            except Exception as e:
                return "服务错误", f"模型调用失败：{e}"

        def translate_text(self, text: str) -> str:
            prompt = f"""你是一个专业的学术英语翻译助手。

请将以下英文内容准确翻译为中文。

要求：
1. 忠实原意，不要随意扩展
2. 使用学术/正式中文表达
3. 不要添加解释或注释
4. 只输出翻译结果

英文原文：
{text}
"""
            try:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt
                )
                return response.text.strip()
            except Exception as e:
                return f"翻译失败：{e}"

except ImportError:
    # 如果没有安装 google-genai，则不提供 GeminiService
    GeminiService = None
