import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "cache.db"

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
