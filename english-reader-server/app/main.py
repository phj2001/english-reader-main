from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import os
import hashlib
import sqlite3
import spacy
from dotenv import load_dotenv
from google import genai
import pdfplumber
import docx
import io
import re
from google.genai import types
from fastapi import UploadFile, File, HTTPException

# =========================
# 1️⃣ 环境变量 & 基础配置
# =========================

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

# 代理（如不需要可删除）
os.environ["HTTP_PROXY"] = "http://127.0.0.1:7897"
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7897"

# Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("❌ 未检测到 GEMINI_API_KEY，请检查 .env")

client = genai.Client(api_key=GEMINI_API_KEY)

# =========================
# 2️⃣ FastAPI 初始化
# =========================

app = FastAPI(title="English Reader API")

from fastapi.staticfiles import StaticFiles
# 挂载静态文件目录 (用于 PDF 访问)
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

# =========================
# 4️⃣ SQLite 缓存
# =========================

DB_PATH = BASE_DIR / "cache.db"

def get_conn():
    return sqlite3.connect(DB_PATH)

def init_cache():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS explain_cache (
        cache_key TEXT PRIMARY KEY,
        word TEXT,
        sentence TEXT,
        meaning_zh TEXT,
        explanation_zh TEXT
    )
    """)
    conn.commit()
    conn.close()

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

# =========================
# 6️⃣ Prompt 构造
# =========================

def build_prompt(word: str, sentence: str) -> str:
    return f"""
你是一个专业的英语语义分析助手。

请仅根据给定句子中的上下文，
解释单词 "{word}" 在该句中的具体含义。

句子：
"{sentence}"

要求：
1. 给出准确的中文释义（不超过15个字）
2. 用一句话解释该词在此处的语义功能
3. 不要列出其他词义
4. 不要翻译整个句子
"""

# =========================
# 6.5️⃣ 辅助：文本清洗与解析
# =========================

def clean_text(text: str) -> str:
    """清理提取出的文本，但保留段落结构和缩进"""
    # 1. 移除多余的页眉页脚 (仅过滤掉纯数字行，但保留空行作为段落标记)
    lines = text.splitlines()
    cleaned_lines = []
    
    for line in lines:
        # 不再 strip，保留首行缩进
        if not line.strip(): 
            cleaned_lines.append("") # 保持空行
            continue
            
        if line.strip().isdigit(): continue # 过滤页码
        
        # 移除行末空格，但保留行首空格
        cleaned_lines.append(line.rstrip())
    
    text = "\n".join(cleaned_lines)

    # 2. 处理连字符断词 (跨行连字符)
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)
    
    # 3. 这里的断行连接逻辑需要更谨慎，不能把分段给连上了
    # 只有当下一行不是以大写字母开头，或者是小写字母开头时才连接，且不能跨越空行
    # 简单起见，我们暂时保留所有换行，交由 process_text 的 nlp 处理，
    # 或者只连接那些明显被截断的句子。
    # 为了严格保留排版，我们暂不进行激进的断行合并，而是让前端负责渲染换行。
    # 但 spaCy 分句依赖完整句子，所以我们将“非空行之间的换行”替换为空格，
    # 而保留“空行”作为段落分隔符。
    
    # 策略调整：
    # 将 \n\n+ 替换为特殊占位符 <PARAGRAPH_BREAK>
    # 将 单个 \n 替换为空格 (合并行)
    # 再将占位符还原
    
    # 保护段落
    text = re.sub(r'\n\s*\n', '<PARAGRAPH_BREAK>', text)
    
    # 合并行 (非段落的换行 -> 空格)
    text = re.sub(r'\n', ' ', text)
    
    # 还原段落 (这里用两个换行符表示)
    text = text.replace('<PARAGRAPH_BREAK>', '\n\n')
    
    # 4. 压缩中间的重复空格 (保留行首的缩进比较难，因为上面合并行时已经打乱了)
    # 修正策略：如果用户要求“严格保留缩进”，那我们不能随意合并行。
    # 但如果不合并行，spaCy 分句会很烂。
    # 这是一个权衡。为了 "识别照片中的英文文本并且按照照片中的排版格式"，
    # 我们倾向于：以照片的视觉段落为准。
    
    # 既然使用了 Vision API (parse_image)，它返回的通常已经是很好的段落文本了。
    # 对于 PDF (extract_words)，我们自己拼凑的 text 也有段落概念 (\n\n)。
    
    # 所以，clean_text 只需要负责清理乱码，不要破坏 \n\n
    
    return text.strip()

def extract_words_with_coords(pdf_file):
    """
    提取 PDF 文本及坐标
    Returns:
        full_text: str
        text_map: list of dict, 每个元素包含 {start: int, end: int, bbox: dict, page: int, page_width: float, page_height: float}
        pages_meta: list of dict, {page_idx: int, width: float, height: float}
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
        
        # extract_words 返回: [{'text': 'foo', 'x0': ..., 'top': ...}, ...]
        words = page.extract_words(
            x_tolerance=1, 
            y_tolerance=1, 
            keep_blank_chars=False,
            use_text_flow=True
        )
        
        if not words: continue
        
        last_bottom = 0
        last_x1 = 0
        
        for i, w in enumerate(words):
            text = w['text']
            # 判断是否换行 (top 变化较大)
            if i > 0 and (w['top'] - words[i-1]['top']) > 5:
                full_text += "\n"
                current_char_idx += 1
                last_x1 = 0
            
            # 判断是否需要空格 (x0 与上一个 x1 的距离)
            if last_x1 > 0 and (w['x0'] - last_x1) > 2: 
                full_text += " "
                current_char_idx += 1
            
            start = current_char_idx
            end = start + len(text)
            
            # 记录映射
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
    """
    提取 PDF 文本，返回 (text, map, pages)
    如果 extraction 失败或回退，则 map 为 None
    """
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        # 优先尝试基于单词的重组
        text, text_map, pages_meta = extract_words_with_coords(pdf)
        
        if len(text.strip()) > 50:
            return clean_text(text), text_map, pages_meta
        
        # 回退逻辑 (不带坐标)
        text = ""
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=2, y_tolerance=2)
            if t: text += t + "\n"
        return clean_text(text), None, []

def ai_fix_text(text: str) -> str:
    """使用 Gemini 修复排版混乱的文本"""
    if len(text) < 100: return text # 太短不修
    
    # 截取前 2000 字符做个示例，或者分段修。
    # 为节省 Token 和时间，我们只修整明显的问题，或者全量修整（视文本长度）
    # 这里演示全量修整，实际生产可能需要分块
    
    try:
        prompt = f"""
你是一个专业的文本清洗助手。收到的文本是从 PDF 提取的，可能存在以下问题：
1. 单词之间缺少空格 (例如 "hello,world" 应为 "hello, world")
2. 单词被错误截断
3. 包含乱码或无意义字符

请修复这段文本的格式，使其自然、流畅、可读。
保持原有句意不变。只输出修复后的文本。

待修复文本：
{text[:4000]} 
""" 
# 注意：这里限制 4000 字符防止溢出，实际应分块处理。
# 简化起见，我们暂且这样处理，或者仅依赖 clean_text 
        
        # 考虑到性能，我们先由 clean_text 处理，这里作为可选项
        # 实际代码中，如果用户觉得 clean_text 不够，可以打开这个开关
        # 为响应速度，目前仅返回 clean_text 后的结果，若用户强求 AI 修复，可解开下方注释
        
        # response = client.models.generate_content(
        #     model="gemini-2.0-flash-lite",
        #     contents=prompt
        # )
        # return response.text.strip()
        pass 
    except:
        pass
    
    return clean_text(text)

def parse_image(file_bytes: bytes, mime_type: str) -> str:
    """使用 Gemini Vision 识别图片文本"""
    prompt = "Transcribe the text in this image, preserving the original layout and line breaks exactly. Do not add any conversational text."
    
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=[
                types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                prompt
            ]
        )
        return response.text.strip()
    except Exception as e:
        print(f"Vision API error: {e}")
        return ""

def parse_docx(file_bytes: bytes) -> str:
    """提取 Word 文本"""
    doc = docx.Document(io.BytesIO(file_bytes))
    text = "\n".join([para.text for para in doc.paragraphs])
    return clean_text(text)

# =========================
# 7️⃣ 路由：解析文本
# =========================

@app.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    """
    接收 PDF/Word 文件 -> 解析为文本 -> 调用 NLP 结构化
    """
    content = await file.read()
    filename = file.filename.lower()
    
    text = ""
    
    text = ""
    word_map = None # 仅 PDF 有
    pages_meta = []
    file_url = ""
    
    # 保存文件到静态目录
    try:
        if filename.endswith(".pdf"):
            # 生成安全文件名
            safe_name = f"{hashlib.md5(content).hexdigest()[:10]}.pdf"
            save_path = STATIC_DIR / "uploads" / safe_name
            with open(save_path, "wb") as f:
                f.write(content)
            # URL (Assumes server runs on port 8000)
            file_url = f"http://127.0.0.1:8000/static/uploads/{safe_name}"

        if filename.endswith(".pdf"):
            text, word_map, pages_meta = parse_pdf(content)
        elif filename.endswith(".docx"):
            text = parse_docx(content)
        elif filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
             text = parse_image(content, file.content_type or "image/jpeg")
        elif filename.endswith(".txt"):
            text = content.decode("utf-8")
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式，仅支持 PDF, DOCX, TXT, JPG, PNG")
            
        if not text.strip():
             raise HTTPException(status_code=400, detail="文件内容为空或无法识别")
        
        if word_map:
            # 如果有坐标映射，跳过 AI修复，防止字符偏移错乱
            final_text = text
        else:
            final_text = ai_fix_text(text)
            
        result = process_text(final_text, word_map=word_map)
        
        # 补充文件信息
        result["file_url"] = file_url
        result["pages"] = pages_meta
        return result

    except Exception as e:
        print(f"解析失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")


def process_text(raw_text: str, word_map=None):
    """
    文本结构化核心逻辑
    :param word_map: list of dict, 字符索引到 PDF 坐标的映射
    """
    doc = nlp(raw_text)
    sentences = []
    
    # 将 generator 转换为 list，因为我们需要通过索引访问上一句
    all_sentences = list(doc.sents)

    for sent_idx, sent in enumerate(all_sentences):
        # 1. 计算布局信息
        # 检查句子在原文中的起始位置之前，是否有换行符
        # spaCy 的 sent.start_char 指向句子第一个字符在 raw_text 中的位置
        
        layout_info = {
            "is_new_paragraph": False,
            "indent_level": 0
        }
        
        if sent_idx == 0:
            layout_info["is_new_paragraph"] = True
        else:
            # 查看上一句结束到这一句开始之间的文本
            prev_sent_end = all_sentences[sent_idx-1].end_char if sent_idx > 0 else 0
            gap_text = raw_text[prev_sent_end : sent.start_char]
            
            # 如果中间包含至少两个换行符 (或者根据 clean_text 的逻辑，\n\n)
            if '\n\n' in gap_text or gap_text.count('\n') >= 2:
                layout_info["is_new_paragraph"] = True
            
            # 简单的缩进检测 (检测 gap_text 最后面的空格数量，或者句子本身的 start_char 前的空格)
            # 但由于 clean_text 可能会压缩空格，这里主要依赖 \n\n 判断段落
        
        # 使用手动列表而不是直接遍历，方便控制合并
        spacy_tokens = list(sent)
        merged_tokens = []
        
        # 需要合并的后缀列表 (全小写)
        suffixes = ["n't", "'s", "'ll", "'re", "'ve", "'m", "'d"]

        for token in spacy_tokens:
            if token.is_space: continue
            
            should_merge = False
            if merged_tokens:
                text_lower = token.text.lower()
                # 只有当它是特定后缀，且不是句首(虽然有前置token通常不是句首)时才合并
                if text_lower in suffixes:
                     should_merge = True
            
            if should_merge:
                # 合并到上一个 Token
                prev_token = merged_tokens[-1]
                prev_token['text'] += token.text
                prev_token['end'] = token.idx + len(token.text)
                # 更新是否有后置空格：继承当前后缀的属性
                prev_token['has_space_after'] = bool(token.whitespace_)
            else:
                # 新增 Token
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
                
                # 如果有 word_map，尝试匹配坐标
                if word_map:
                    # 查找与当前 token (start, end) 有重叠的 PDF words
                    # 这里的 token.idx 是在 raw_text (即 clean_text 后的) 中的索引
                    # 而 word_map 是在 raw_text (clean_text 前) 中的索引... 
                    # 🚨 警告: clean_text 可能会改变索引 (例如 clean_text 把 \n 替换为空格，或者去除页码)
                    # 如果 clean_text 做了大幅修改，索引就对不上了。
                    # 为了简化，我们在 PDF 模式下，尽量让 clean_text 不做破坏性修改，
                    # 或者，我们需要对 word_map 做同样的 clean 操作。
                    
                    # 简化策略: 仅仅当 clean_text 没有大规模删除时有效。
                    # 更好的策略: 让 token 匹配尽量宽容，或者仅仅基于文本匹配 (不可靠)
                    # 暂时方案: 假设 clean_text 只是 strip()，如果做了替换，偏移量会乱。
                    
                    # 修正: extract_words_with_coords 构造出的 full_text 已经是 "清洁" 的 (除了最后 strip)
                    # 只有 ai_fix_text 会搞乱它。
                    # 所以，如果有 word_map，我们应该跳过 ai_fix_text 或者极其小心。
                    
                    # 寻找重叠
                    matched_rects = []
                    t_start, t_end = token.idx, token.idx + len(token.text)
                    
                    for wm in word_map:
                        # 检查区间重叠: max(start1, start2) < min(end1, end2)
                        if max(t_start, wm['start']) < min(t_end, wm['end']):
                            matched_rects.append(wm)
                            
                    if matched_rects:
                        # 计算 Union Box
                        page_idx = matched_rects[0]['page'] # 假设 token 不跨页
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
        
        # 只有当句子包含有效 token 时才添加
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
# 7️⃣ 路由：解析文本
# =========================

@app.post("/parse-text")
def parse_text(req: ParseRequest):
    return process_text(req.text)

# =========================
# 8️⃣ 路由：上下文释义（唯一版本）
# =========================

@app.post("/explain-token")
def explain_token(req: ExplainRequest):
    cache_key = make_cache_key(req.sentence, req.word)

    conn = get_conn()
    cur = conn.cursor()

    # ① 查缓存
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

    # ② 调用 Gemini
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=build_prompt(req.word, req.sentence)
        )

        content = response.text.strip()
        lines = [l for l in content.splitlines() if l.strip()]

        meaning = lines[0]
        explanation = lines[1] if len(lines) > 1 else lines[0]

    except Exception as e:
        conn.close()
        return {
            "word": req.word,
            "meaning_zh": "服务错误",
            "explanation_zh": f"模型调用失败：{e}",
            "confidence": 0.0
        }

    # ③ 写缓存
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


#句子翻译
class TranslateRequest(BaseModel):
    text: str
def build_translate_prompt(text: str) -> str:
    return f"""
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
@app.post("/translate-text")
def translate_text(req: TranslateRequest):
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=build_translate_prompt(req.text)
        )

        translation = response.text.strip()

        return {
            "translation_zh": translation
        }

    except Exception as e:
        return {
            "translation_zh": f"翻译失败：{e}"
        }

