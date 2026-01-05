import re

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
    
    # 3. 保护段落 \n\n+
    text = re.sub(r'\n\s*\n', '<PARAGRAPH_BREAK>', text)
    
    # 合并行 (非段落的换行 -> 空格)
    text = re.sub(r'\n', ' ', text)
    
    # 还原段落 (这里用两个换行符表示)
    text = text.replace('<PARAGRAPH_BREAK>', '\n\n')
    
    return text.strip()

def decode_escaped_newlines(text: str) -> str:
    """
    一些大模型/接口会把换行输出成 \"\\n\" 这样的转义文本，
    这里统一把这些转义序列还原成真正的换行符。
    """
    # 先处理常见的 Windows 风格，再处理单个 \n
    text = text.replace("\\r\\n", "\n")
    text = text.replace("\\n\\r", "\n")
    text = text.replace("\\n", "\n")
    return text

def normalize_image_paragraphs(text: str) -> str:
    """
    针对图片 OCR 文本的一些段落修正：
    - 特别处理以大写字母+右括号开头的小节标记（如 K)、L)），
      在它们前面自动插入一个空行，用于提示“这里是新段落”。
    """
    # 第一轮：按“独立一行”的题号处理
    lines = text.splitlines()
    new_lines = []

    for line in lines:
        stripped = line.lstrip()
        # 匹配类似 "K) "、"L)"、"A)" 这种考试题小节标记
        if re.match(r"^[A-Z]\)", stripped) and new_lines:
            # 如果前一行不是空行，则在当前行前插入一个空行，表示段落分隔
            if new_lines[-1].strip() != "":
                new_lines.append("")
        new_lines.append(line)

    normalized = "\n".join(new_lines)

    # 第二轮：处理出现在同一行中、跟在句号/问号/引号后面的题号
    # 例如： ... cornerstone of comprehension. "L) How did ...
    # 在这种模式下，我们在标点之后、题号之前插入两个换行符
    # 允许 \s* (即这中间可能没有空格，直接黏在标点后)
    normalized = re.sub(
        r'([\.!?]["”\']?)\s*([A-Z]\))',
        r'\1\n\n\2',
        normalized,
    )

    return normalized
