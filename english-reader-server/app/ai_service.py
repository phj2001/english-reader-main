import os
from google import genai
from .text_utils import decode_escaped_newlines, clean_text

class GeminiService:
    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError("❌ GEMINI_API_KEY is missing")
        self.client = genai.Client(api_key=api_key)
        self.model_name = "gemini-1.5-flash"

    def explain_word(self, word: str, sentence: str) -> tuple[str, str]:
        prompt = f"""
你是一个专业的英语语义分析助手。

请仅根据给定句子中的上下文，
解释单词 "{word}" 在该句中的具体含义。

句子：
"{sentence}"

要求：
1. 第一行：仅输出中文含义（如：可持续的），不要包含“中文释义”等前缀。
2. 第二行：仅输出一句话的语境解释（如：描述的是发展和环境保护能够长期维持的状态。），不要包含“语义功能”等前缀。
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
        prompt = f"""
你是一个专业的学术英语翻译助手。

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
