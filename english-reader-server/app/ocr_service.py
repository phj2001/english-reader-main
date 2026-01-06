
import os
from pathlib import Path
from PIL import Image
import pytesseract
import io


class OCRService:
    def __init__(self, lang: str = "eng"):
        """
        Initialize Tesseract OCR service.
        
        Args:
            lang: Tesseract language code (e.g., 'eng', 'chi_sim', 'eng+chi_sim')
        
        Note: Tesseract must be installed system-wide and added to PATH.
        """
        self.lang = lang
        print(f"Initializing Tesseract OCR with language: {lang}")
        
        # Verify Tesseract is installed and accessible
        try:
            version = pytesseract.get_tesseract_version()
            print(f"Tesseract OCR initialized successfully - Version: {version}")
        except Exception as e:
            print(f"WARNING: Tesseract OCR may not be properly installed: {e}")
            print("Please ensure Tesseract is installed and added to your system PATH.")

    def parse_image(self, file_bytes: bytes) -> str:
        """
        Parse image bytes and return text with proper paragraph formatting.
        Uses Tesseract OCR with layout analysis to preserve document structure.
        
        Based on the reference implementation that preserves line breaks within paragraphs
        and blank lines between paragraphs.
        
        Args:
            file_bytes: Image file content as bytes
            
        Returns:
            Extracted text with proper paragraph formatting (line breaks preserved)
        """
        try:
            # Convert bytes to PIL Image
            img = Image.open(io.BytesIO(file_bytes))
            
            # Perform OCR with layout preservation
            text = self._ocr_image_to_text(img, lang=self.lang)
            
            return text
            
        except Exception as e:
            print(f"OCR Error: {e}")
            import traceback
            traceback.print_exc()
            return f"Error during OCR processing: {str(e)}"

    def _ocr_image_to_text(self, img: Image.Image, lang: str = "eng") -> str:
        """
        使用 Tesseract 识别单张图片，并根据 block / paragraph / line 信息
        尽量恢复原始段落结构，返回纯文本。
        
        This implementation exactly follows the reference code to ensure
        proper line breaks within paragraphs and blank lines between paragraphs.
        """
        # 使用 data/TSV 输出，获得布局信息
        data = pytesseract.image_to_data(
            img,
            lang=lang,
            output_type=pytesseract.Output.DICT,
        )

        n = len(data["text"])
        # 结构：{ (block_num, par_num, line_num) : [ (left, word) , ... ] }
        structure = {}

        for i in range(n):
            word = data["text"][i]
            conf = data["conf"][i]

            # 过滤空串和低置信度结果
            if not word or word.strip() == "" or conf == "-1":
                continue

            block_num = data["block_num"][i]
            par_num = data["par_num"][i]
            line_num = data["line_num"][i]
            left = data["left"][i]

            key = (block_num, par_num, line_num)
            structure.setdefault(key, []).append((left, word))

        # 根据 block / paragraph / line 的顺序重新组合文本
        # 先按 block, 再按 paragraph, 再按 line 排序
        sorted_keys = sorted(structure.keys(), key=lambda k: (k[0], k[1], k[2]))

        paragraphs = []
        current_paragraph_lines = []
        current_block_par = None

        for key in sorted_keys:
            block_num, par_num, line_num = key
            words = structure[key]

            # 同一行内部根据 left 坐标排序，然后拼接为一行
            words_sorted = sorted(words, key=lambda x: x[0])
            line_text = " ".join(w for _, w in words_sorted).strip()
            if not line_text:
                continue

            block_par = (block_num, par_num)
            # 如果进入新的段落（block 或 paragraph 变化），则把前一个段落收尾
            if current_block_par is None:
                current_block_par = block_par

            if block_par != current_block_par:
                if current_paragraph_lines:
                    paragraphs.append("\n".join(current_paragraph_lines).strip())
                    current_paragraph_lines = []
                current_block_par = block_par

            current_paragraph_lines.append(line_text)

        # 收尾：最后一个段落
        if current_paragraph_lines:
            paragraphs.append("\n".join(current_paragraph_lines).strip())

        # 段落之间以一个空行分隔
        result_text = "\n\n".join(p for p in paragraphs if p)
        
        print(f"DEBUG: Tesseract extracted {len(paragraphs)} paragraphs")
        print(f"DEBUG: Total characters: {len(result_text)}")
        
        return result_text
