from google import genai
from dotenv import load_dotenv
import os
from pathlib import Path

# 1. 加载配置
current_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=current_dir / ".env")

# 2. 配置代理 (确保端口正确)
os.environ["HTTP_PROXY"] = "http://127.0.0.1:7897"
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7897"

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ 没有找到 API Key")
else:
    try:
        print("正在查询可用模型列表...\n")
        client = genai.Client(api_key=api_key)
        
        pager = client.models.list() 
        
        for model in pager:
            # 直接打印 name，不再检查属性
            print(f"👉 {model.name}")
            
    except Exception as e:
        print(f"❌ 出错啦: {e}")