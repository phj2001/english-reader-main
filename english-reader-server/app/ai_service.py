import os
from google import genai
from google.genai import types
from .text_utils import decode_escaped_newlines, clean_text

class GeminiService:
    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError("❌ GEMINI_API_KEY is missing")
        self.client = genai.Client(api_key=api_key)
        self.model_name = "gemini-2.0-flash-lite"

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

    def fix_text_layout(self, text: str, is_image: bool = False) -> str:
        """
        Unified method to fix text layout.
        If is_image is True, applies more aggressive fixing for OCR results.
        """
        if len(text) < 40:
            return text

        if is_image:
             prompt = f"""
You are an OCR text cleanup engine.

You receive RAW text transcribed from an English reading passage image.
Problems:
- Sometimes there are NO spaces between words.
- Sometimes newline characters are printed as literal "\\n" or "\\n\\n".

Your job:
1. Insert spaces BETWEEN English words and after punctuation where appropriate,
   so that the text becomes normally readable English.
2. Convert any literal "\\n" or "\\n\\n" sequences into REAL newline characters.
3. Group sentences into logical PARAGRAPHS.
   - Treat lines starting with "A)", "B)", "K)", "L)", "1." etc. as new paragraphs.
   - Between two paragraphs, insert EXACTLY ONE blank line (two consecutive newlines: "\\n\\n").
4. DO NOT change, remove, or reorder any letters or punctuation except:
   - you MAY add spaces,
   - you MAY add/remove REAL newline characters.
5. Output ONLY the cleaned text, no explanations.

RAW text:
-----
{text}
-----
Now output the cleaned text only.
""".strip()
        else:
             # Basic fix for PDF/Text (optional, based on original code logic)
             # The original code had ai_fix_text but it was mostly skipped or limited.
             # We will implement a simplified version or just return clean_text if deemed unnecessary.
             # For now, let's keep it simple and just return clean_text if not image, 
             # as the original ai_fix_text was commented out/pass-ed in some branches or only strictly used.
             # However, maintaining the capability is good.
             return clean_text(text)

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt
            )
            cleaned = (response.text or "").strip()
            cleaned = decode_escaped_newlines(cleaned)
             # Sanity check
            if len(cleaned) < len(text) * 0.4:
                return text
            return cleaned
        except Exception:
            return text

    def parse_image_content(self, file_bytes: bytes, mime_type: str) -> str:
         prompt = (
            "Transcribe ALL the text in this image as plain text.\n"
            "- Preserve the original PARAGRAPH structure.\n"
            "- Between two paragraphs that are visually separated in the image, "
            "insert ONE completely blank line, i.e. use TWO consecutive newline characters (\"\\n\\n\").\n"
            "- Inside a single paragraph, if the text only wraps because of line width, "
            "merge those visual lines back into one continuous paragraph (use spaces instead of extra newlines).\n"
            "- Do NOT add any explanation or commentary, only output the transcribed text."
        )
         try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[
                    types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                    prompt
                ]
            )
            raw = (response.text or "").strip()
            return decode_escaped_newlines(raw)
         except Exception as e:
             print(f"Vision API error: {e}")
             return ""

