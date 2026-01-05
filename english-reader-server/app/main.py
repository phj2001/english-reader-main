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

from .db import get_conn, init_cache, DB_PATH
from .text_utils import clean_text, normalize_image_paragraphs, decode_escaped_newlines
from .ai_service import GeminiService

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
    doc = docx.Document(io.BytesIO(file_bytes))
    text = "\n".join([para.text for para in doc.paragraphs])
    return clean_text(text)

def process_text(raw_text: str, word_map=None):
    """
    文本结构化核心逻辑
    """
    doc = nlp(raw_text)
    sentences = []
    
    all_sentences = list(doc.sents)

    for sent_idx, sent in enumerate(all_sentences):
        layout_info = {
            "is_new_paragraph": False,
            "indent_level": 0
        }
        
        if sent_idx == 0:
            layout_info["is_new_paragraph"] = True
        else:
            prev_sent_end = all_sentences[sent_idx-1].end_char if sent_idx > 0 else 0
            gap_text = raw_text[prev_sent_end : sent.start_char]
            
            if '\n\n' in gap_text or gap_text.count('\n') >= 2:
                layout_info["is_new_paragraph"] = True
            
        spacy_tokens = list(sent)
        merged_tokens = []
        
        suffixes = ["n't", "'s", "'ll", "'re", "'ve", "'m", "'d"]

        for token in spacy_tokens:
            if token.is_space: continue
            
            should_merge = False
            if merged_tokens:
                text_lower = token.text.lower()
                if text_lower in suffixes:
                     should_merge = True
            
            if should_merge:
                prev_token = merged_tokens[-1]
                prev_token['text'] += token.text
                prev_token['end'] = token.idx + len(token.text)
                prev_token['has_space_after'] = bool(token.whitespace_)
            else:
                token_data = {
                    "token_id": f"sent-{sent_idx}-token-{len(merged_tokens)}",
                    "text": token.text,
                    "lemma": token.lemma_,
                    "pos": token.pos_,
                    "tag": token.tag_,
                    "dep": token.dep_,
                    "start": token.idx,
                    "end": token.idx + len(token.text),
                    "has_space_after": bool(token.whitespace_)
                }
                
                if word_map:
                    matched_rects = []
                    t_start, t_end = token.idx, token.idx + len(token.text)
                    
                    for wm in word_map:
                        if max(t_start, wm['start']) < min(t_end, wm['end']):
                            matched_rects.append(wm)
                            
                    if matched_rects:
                        page_idx = matched_rects[0]['page']
                        x0 = min(r['bbox']['x0'] for r in matched_rects)
                        top = min(r['bbox']['top'] for r in matched_rects)
                        x1 = max(r['bbox']['x1'] for r in matched_rects)
                        bottom = max(r['bbox']['bottom'] for r in matched_rects)
                        
                        token_data['bbox'] = {
                            "page": page_idx,
                            "x0": x0, 
                            "top": top,
                            "x1": x1,
                            "bottom": bottom,
                            "width": x1 - x0,
                            "height": bottom - top
                        }

                merged_tokens.append(token_data)
        
        if merged_tokens:
            sentences.append({
                "text": sent.text,
                "start": sent.start_char,
                "end": sent.end_char,
                "layout": layout_info,
                "tokens": merged_tokens
            })

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
        elif filename.endswith(".docx"):
            text = parse_docx(content)
        elif filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
            raw_image_text = ai_service.parse_image_content(content, file.content_type or "image/jpeg")
            # Apply image specific normalization
            normalized_text = normalize_image_paragraphs(raw_image_text)
            text = ai_service.fix_text_layout(normalized_text, is_image=True)
        elif filename.endswith(".txt"):
            text = content.decode("utf-8")
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式")
            
        if not text.strip():
             raise HTTPException(status_code=400, detail="文件内容为空或无法识别")
        
        if word_map:
            final_text = text
        else:
            # Only apply basic clean if not image (images already processed)
            if not filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
                 final_text = clean_text(text)
            else:
                 final_text = text
            
        result = process_text(final_text, word_map=word_map)
        
        result["file_url"] = file_url
        result["pages"] = pages_meta
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
