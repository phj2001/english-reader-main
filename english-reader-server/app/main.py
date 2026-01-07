from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import os
import hashlib
import spacy
from dotenv import load_dotenv
import pdfplumber
import docx
import io
import re
import tempfile
from docx2pdf import convert as docx2pdf_convert

from .db import get_conn, init_cache, DB_PATH
from .text_utils import clean_text, normalize_image_paragraphs, decode_escaped_newlines, normalize_exam_like_image
from .ai_service import GeminiService
from .ocr_service import OCRService

# =========================
# 1️⃣ 环境变量 & 基础配置
# =========================

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

# 代理（如不需要可删除）
os.environ["HTTP_PROXY"] = "http://127.0.0.1:7897"
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7897"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

ai_service = GeminiService(api_key=GEMINI_API_KEY)
ocr_service = OCRService()

# =========================
# 2️⃣ FastAPI 初始化
# =========================

app = FastAPI(title="English Reader API")

from fastapi.staticfiles import StaticFiles
STATIC_DIR = BASE_DIR / "static"
if not STATIC_DIR.exists():
    STATIC_DIR.mkdir()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 3️⃣ spaCy 模型
# =========================

nlp = spacy.load("en_core_web_sm")

# Initialize Cache
init_cache()

def make_cache_key(sentence: str, word: str) -> str:
    h = hashlib.md5(sentence.strip().lower().encode()).hexdigest()[:8]
    return f"explain:{h}:{word.lower()}"

# =========================
# 5️⃣ 数据模型
# =========================

class ParseRequest(BaseModel):
    text: str

class ExplainRequest(BaseModel):
    token_id: str
    word: str
    sentence: str

class TranslateRequest(BaseModel):
    text: str

# =========================
# 6️⃣ Core Logic: PDF Extraction
# =========================

def extract_words_with_coords(pdf_file):
    """
    提取 PDF 文本及坐标
    """
    full_text = ""
    text_map = []
    pages_meta = []
    
    current_char_idx = 0
    
    for page_idx, page in enumerate(pdf_file.pages):
        pages_meta.append({
            "page_idx": page_idx,
            "width": float(page.width),
            "height": float(page.height)
        })
        
        words = page.extract_words(
            x_tolerance=1, 
            y_tolerance=1, 
            keep_blank_chars=False
        )
        
        if not words: continue
        
        last_bottom = 0
        last_x1 = 0
        
        for i, w in enumerate(words):
            text = w['text']
            # 判断是否换行
            if i > 0 and (w['top'] - words[i-1]['top']) > 5:
                full_text += "\n"
                current_char_idx += 1
                last_x1 = 0
            
            need_space = True
            if last_x1 == 0: 
                need_space = False
            elif text.startswith('-') or (full_text and full_text[-1] == '-'):
                 need_space = False
            
            if need_space: 
                full_text += " "
                current_char_idx += 1
            
            start = current_char_idx
            end = start + len(text)
            
            text_map.append({
                "start": start,
                "end": end,
                "text": text,
                "bbox": {
                    "x0": float(w['x0']),
                    "top": float(w['top']),
                    "x1": float(w['x1']),
                    "bottom": float(w['bottom'])
                },
                "page": page_idx,
                "page_width": float(page.width),
                "page_height": float(page.height)
            })
            
            full_text += text
            current_char_idx = end
            last_x1 = w['x1']
            
        full_text += "\n\n"
        current_char_idx += 2
        
    return full_text, text_map, pages_meta

def parse_pdf(file_bytes: bytes):
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        text, text_map, pages_meta = extract_words_with_coords(pdf)
        if len(text.strip()) > 50:
            return clean_text(text), text_map, pages_meta
        
        # Fallback
        text = ""
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=2, y_tolerance=2)
            if t: text += t + "\n"
        return clean_text(text), None, []

def parse_docx(file_bytes: bytes) -> str:
    """
    解析 Word 文档，尽量保留原始段落布局：
    - 每个 Word 段落之间使用两个换行符 \\n\\n 分隔（对应前端中的“新段落”）
    - 段落内部不做任何换行合并，保持与原文一致
    - 不再调用 clean_text，避免误删空行或合并段落
    """
    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs: list[str] = []

    for para in doc.paragraphs:
        # para.text 已经把该段落内的 run 合并，包含手动换行符
        text = para.text
        if text is None:
            continue
        # 保留段内空格，只去掉段尾多余空白
        paragraphs.append(text.rstrip())

    # 使用 \\n\\n 作为段落分隔符，方便后续 process_text 按自然段切分
    joined = "\n\n".join(p for p in paragraphs)
    return joined.strip()

def process_text(raw_text: str, word_map=None):
    """
    文本结构化核心逻辑
    关键点：**段落优先**——先按原始文本里的自然段(\n\n)切分，再对每个段落单独做句子与分词。
    这样可以完全尊重 OCR / 原文中的段落排版，而不会因为 spaCy 的句子切分而丢失段落信息。
    """
    sentences = []

    # 先按 \n\n（允许中间有空白）切成自然段，确保段落信息来自原文而不是 spaCy 的句子分割
    paragraph_splits = re.split(r"\n\s*\n+", raw_text)
    offset = 0  # 用来把段落内的相对下标，映射回整篇文章中的绝对下标

    print(f"DEBUG: Detected {len(paragraph_splits)} paragraphs from raw_text")

    suffixes = ["n't", "'s", "'ll", "'re", "'ve", "'m", "'d"]

    for para_idx, para_text in enumerate(paragraph_splits):
        if not para_text.strip():
            # 空段落：直接把 offset 推进（+2 模拟之前的 \n\n）
            offset += len(para_text) + 2
            continue

        # 对当前段落单独做 NLP 句子分割
        doc = nlp(para_text)
        para_sentences = list(doc.sents)
        print(f"DEBUG: Paragraph {para_idx} -> {len(para_sentences)} sentences")

        for inner_idx, sent in enumerate(para_sentences):
            global_sent_idx = len(sentences)  # 用全局序号生成 token_id

            layout_info = {
                "is_new_paragraph": inner_idx == 0,  # 每个段落里的第一句标记为新段落
                "indent_level": 0
            }

            spacy_tokens = list(sent)
            merged_tokens = []

            for token in spacy_tokens:
                if token.is_space:
                    continue

                should_merge = False
                if merged_tokens:
                    text_lower = token.text.lower()
                    if text_lower in suffixes:
                        should_merge = True

                if should_merge:
                    prev_token = merged_tokens[-1]
                    prev_token["text"] += token.text
                    prev_token["end"] = offset + token.idx + len(token.text)
                    prev_token["has_space_after"] = bool(token.whitespace_)
                else:
                    global_start = offset + token.idx
                    global_end = global_start + len(token.text)

                    token_data = {
                        "token_id": f"sent-{global_sent_idx}-token-{len(merged_tokens)}",
                        "text": token.text,
                        "lemma": token.lemma_,
                        "pos": token.pos_,
                        "tag": token.tag_,
                        "dep": token.dep_,
                        "start": global_start,
                        "end": global_end,
                        "has_space_after": bool(token.whitespace_),
                    }

                    if word_map:
                        matched_rects = []
                        t_start, t_end = global_start, global_end

                        for wm in word_map:
                            if max(t_start, wm["start"]) < min(t_end, wm["end"]):
                                matched_rects.append(wm)

                        if matched_rects:
                            page_idx = matched_rects[0]["page"]
                            x0 = min(r["bbox"]["x0"] for r in matched_rects)
                            top = min(r["bbox"]["top"] for r in matched_rects)
                            x1 = max(r["bbox"]["x1"] for r in matched_rects)
                            bottom = max(r["bbox"]["bottom"] for r in matched_rects)

                            token_data["bbox"] = {
                                "page": page_idx,
                                "x0": x0,
                                "top": top,
                                "x1": x1,
                                "bottom": bottom,
                                "width": x1 - x0,
                                "height": bottom - top,
                            }

                    merged_tokens.append(token_data)

            if merged_tokens:
                sentences.append(
                    {
                        "text": sent.text,
                        "start": offset + sent.start_char,
                        "end": offset + sent.end_char,
                        "layout": layout_info,
                        "tokens": merged_tokens,
                    }
                )

        # 本段在原文中占用的长度：段落内容 + 之前的 \n\n（这里简化用 +2）
        offset += len(para_text) + 2

    return {"sentences": sentences}


# =========================
# 7️⃣ API Routes
# =========================

@app.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename.lower()
    
    text = ""
    word_map = None
    pages_meta = []
    file_url = ""
    source_type = "other"
    docx_image_ocr_texts = []  # 用于存储 Word 文档中图片的 OCR 结果
    
    try:
        if filename.endswith(".pdf"):
            safe_name = f"{hashlib.md5(content).hexdigest()[:10]}.pdf"
            save_path = STATIC_DIR / "uploads" / safe_name
            
            # Ensure uploads directory exists
            (STATIC_DIR / "uploads").mkdir(exist_ok=True)
            
            with open(save_path, "wb") as f:
                f.write(content)
            file_url = f"http://127.0.0.1:8000/static/uploads/{safe_name}"

            text, word_map, pages_meta = parse_pdf(content)
            source_type = "pdf"
        elif filename.endswith(".docx"):
            # ✨ 新方案：将 Word 转换为 PDF，复用 PDF 渲染逻辑以保持完美格式
            # 同时提取 Word 中的图片进行 OCR，让图片中的文字也可以点击查词
            print("DEBUG: Converting Word document to PDF for native rendering...")
            
            # Ensure uploads directory exists
            (STATIC_DIR / "uploads").mkdir(exist_ok=True)
            
            # 用于存储 Word 中图片的 OCR 结果
            docx_image_ocr_texts = []
            
            # 1. 将 docx 保存到临时目录
            with tempfile.TemporaryDirectory() as tmp_dir:
                docx_path = Path(tmp_dir) / "input.docx"
                pdf_path = Path(tmp_dir) / "input.pdf"
                
                with open(docx_path, "wb") as f:
                    f.write(content)
                
                # 1.5 提取 Word 中的所有图片并进行 OCR
                try:
                    doc = docx.Document(io.BytesIO(content))
                    image_count = 0
                    
                    # 遍历文档中的所有关系，找到图片
                    for rel in doc.part.rels.values():
                        if "image" in rel.target_ref:
                            try:
                                image_data = rel.target_part.blob
                                image_count += 1
                                print(f"DEBUG: Found embedded image #{image_count}, size: {len(image_data)} bytes")
                                
                                # 对图片进行 OCR
                                ocr_text = ocr_service.parse_image(image_data)
                                if ocr_text and ocr_text.strip():
                                    # 与直接上传图片一致：应用 clean_text 和 normalize_exam_like_image 处理
                                    processed_ocr = clean_text(ocr_text)
                                    processed_ocr = normalize_exam_like_image(processed_ocr)
                                    
                                    docx_image_ocr_texts.append({
                                        "image_index": image_count,
                                        "ocr_text": processed_ocr.strip()
                                    })
                                    print(f"DEBUG: OCR result for image #{image_count}: {processed_ocr[:100]}...")
                            except Exception as img_err:
                                print(f"WARNING: Failed to OCR image #{image_count}: {img_err}")
                    
                    print(f"DEBUG: Extracted and OCR'd {len(docx_image_ocr_texts)} images from Word document")
                except Exception as extract_err:
                    print(f"WARNING: Image extraction failed: {extract_err}")
                
                # 2. 使用 docx2pdf 转换（需要 Microsoft Word）
                try:
                    docx2pdf_convert(str(docx_path), str(pdf_path))
                except Exception as convert_err:
                    print(f"ERROR: docx2pdf conversion failed: {convert_err}")
                    raise HTTPException(
                        status_code=500, 
                        detail=f"Word 转 PDF 失败，请确保已安装 Microsoft Word: {str(convert_err)}"
                    )
                
                # 3. 读取生成的 PDF
                with open(pdf_path, "rb") as f:
                    pdf_bytes = f.read()
                
                # 4. 保存 PDF 到 static 目录供前端访问
                safe_name = f"{hashlib.md5(content).hexdigest()[:10]}.pdf"
                save_path = STATIC_DIR / "uploads" / safe_name
                with open(save_path, "wb") as f:
                    f.write(pdf_bytes)
                file_url = f"http://127.0.0.1:8000/static/uploads/{safe_name}"
                
                # 5. 使用 PDF 解析逻辑提取文本和坐标
                text, word_map, pages_meta = parse_pdf(pdf_bytes)
                source_type = "docx"  # 👈 标记为 docx，前端可区分处理
                
            print(f"DEBUG: Word->PDF conversion successful, pages: {len(pages_meta)}, OCR images: {len(docx_image_ocr_texts)}")
        elif filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
            # Use local OCR Service (PaddleOCR)
            text = ocr_service.parse_image(content)
            source_type = "image"
        elif filename.endswith(".txt"):
            text = content.decode("utf-8")
            source_type = "txt"
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式")
            
        if not text.strip():
             raise HTTPException(status_code=400, detail="文件内容为空或无法识别")
        
        if word_map:
            final_text = text
        else:
            # Process based on file type
            if filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
                # 图片 OCR：先做通用清理，再对“试卷类”结构做轻量排版修正
                # 1) clean_text: 合并段内硬回车，只保留真正段落
                final_text = clean_text(text)
                # 2) 如果检测到 17.A)、19.B) 这类题号结构，再做专门的排版优化
                final_text = normalize_exam_like_image(final_text)
                # DEBUG: Check if paragraph breaks are present after cleaning
                para_count = final_text.count('\n\n')
                line_count = final_text.count('\n') - para_count * 2
                print(f"DEBUG: Image OCR text - {para_count} paragraphs, {line_count} line breaks")
                print(f"DEBUG: Text preview: {final_text[:300]}...")
            elif filename.endswith(".docx"):
                # Word 现在已经转换为 PDF，会走 word_map 分支，这里是兜底逻辑
                final_text = text
            else:
                # 其它纯文本类（txt 等），做一次基础清理
                final_text = clean_text(text)
            
        result = process_text(final_text, word_map=word_map)
        
        # 附加原始文本与元信息，前端可选择直接按原始换行渲染
        result["raw_text"] = final_text
        result["file_url"] = file_url
        result["pages"] = pages_meta
        result["source_type"] = source_type
        
        # 如果有 Word 文档中图片的 OCR 结果，也一并返回
        if docx_image_ocr_texts:
            result["docx_image_ocr"] = docx_image_ocr_texts
            # 合并所有图片 OCR 文本，方便前端渲染
            combined_ocr = "\n\n".join([item["ocr_text"] for item in docx_image_ocr_texts])
            result["docx_image_ocr_combined"] = combined_ocr
            print(f"DEBUG: Returning {len(docx_image_ocr_texts)} image OCR results")
        
        return result

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"解析失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")

@app.post("/parse-text")
def parse_text(req: ParseRequest):
    return process_text(req.text)

@app.post("/explain-token")
def explain_token(req: ExplainRequest):
    cache_key = make_cache_key(req.sentence, req.word)

    conn = get_conn()
    cur = conn.cursor()

    # 1. Check Cache
    cur.execute(
        "SELECT meaning_zh, explanation_zh FROM explain_cache WHERE cache_key = ?",
        (cache_key,)
    )
    row = cur.fetchone()

    if row:
        conn.close()
        return {
            "word": req.word,
            "meaning_zh": row[0],
            "explanation_zh": row[1],
            "confidence": 0.95
        }

    # 2. Call AI
    meaning, explanation = ai_service.explain_word(req.word, req.sentence)

    # 3. Write Cache
    cur.execute(
        """
        INSERT INTO explain_cache
        (cache_key, word, sentence, meaning_zh, explanation_zh)
        VALUES (?, ?, ?, ?, ?)
        """,
        (cache_key, req.word, req.sentence, meaning, explanation)
    )
    conn.commit()
    conn.close()

    return {
        "word": req.word,
        "meaning_zh": meaning,
        "explanation_zh": explanation,
        "confidence": 0.95
    }

@app.post("/translate-text")
def translate_text(req: TranslateRequest):
    translation = ai_service.translate_text(req.text)
    return {
        "translation_zh": translation
    }
