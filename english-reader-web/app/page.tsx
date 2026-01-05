'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { WordPopup } from '../components/WordPopup';
import { TranslationPopup } from '../components/TranslationPopup';

const PDFViewer = dynamic(() => import('../components/PDFViewer'), {
  ssr: false,
  loading: () => <div className="text-gray-400">Loading PDF Viewer...</div>
});

/** =======================
 * 类型定义
 * ======================= */
type Token = {
  token_id: string;
  text: string;
  has_space_after?: boolean;
  bbox?: {
    page: number;
    x0: number;
    top: number;
    x1: number;
    bottom: number;
    width: number;
    height: number;
  };
};

type Sentence = {
  text: string;
  tokens: Token[];
  layout?: {
    is_new_paragraph: boolean;
    indent_level: number;
  };
};

type ExplainResult = {
  word: string;
  meaning_zh: string;
  explanation_zh: string;
  confidence: number;
};

export default function HomePage() {
  /** =======================
   * State 定义
   * ======================= */
  const [sentences, setSentences] = useState<Sentence[]>([]);
  
  // 单词解释卡片状态
  const [wordPopup, setWordPopup] = useState<{ 
    x: number; 
    y: number; 
    data: ExplainResult | null 
  } | null>(null);

  // 句子翻译卡片状态
  const [selectionPopup, setSelectionPopup] = useState<{ 
    x: number; 
    y: number; 
    text: string; 
    translation: string 
  } | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [fontSize, setFontSize] = useState(20); 

  // PDF 相关状态
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<{page_idx: number, width: number, height: number}[]>([]);


  /* =======================
   * 1. 核心逻辑：文件上传与处理
   * ======================= */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, mode: 'replace' | 'append' = 'replace') => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    if (mode === 'replace') {
        setSentences([]); // 清空旧内容
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://127.0.0.1:8000/upload-file', {
        method: 'POST',
        body: formData, 
      });
      
      if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || '上传失败');
      }

      const data = await res.json();
      const newSentences: Sentence[] = data.sentences;

      if (mode === 'replace') {
          setSentences(newSentences);
          setFileUrl(data.file_url || null);
          setPdfPages(data.pages || []);
      } else {
           // append logic (简单处理，暂不支持 PDF append)
           if (newSentences.length > 0) {
               if (!newSentences[0].layout) {
                   newSentences[0].layout = { is_new_paragraph: true, indent_level: 0 };
               } else {
                   newSentences[0].layout.is_new_paragraph = true;
               }
               setSentences(prev => [...prev, ...newSentences]);
           }
      }
      
      // 清空 input value
      event.target.value = '';

    } catch (err: any) {
      console.error(err);
      alert(`解析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };


  /** =======================
   * 2. 全局点击监听（核心逻辑）
   * 功能：点击页面任意位置（包括点击卡片本身），关闭所有弹窗
   * ======================= */
  useEffect(() => {
    // 需求：双击关闭弹窗，而不是单击
    const handleGlobalDoubleClick = () => {
      // 1. 关闭所有 UI 状态
      setWordPopup(null);
      setSelectionPopup(null);
    };

    document.addEventListener('dblclick', handleGlobalDoubleClick);
    return () => document.removeEventListener('dblclick', handleGlobalDoubleClick);
  }, []);

  /** =======================
   * 3. 单词点击事件
   * ======================= */
  const handleTokenClick = async (token: Token, sentenceText: string, event: React.MouseEvent) => {
    // ⭐ 关键：阻止冒泡
    event.stopPropagation(); 
    
    // 互斥逻辑
    setSelectionPopup(null);
    
    setWordPopup({ x: event.clientX, y: event.clientY, data: null });

    try {
      const res = await fetch('http://127.0.0.1:8000/explain-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token_id: token.token_id, 
          word: token.text, 
          sentence: sentenceText 
        })
      });
      const data = await res.json();
      setWordPopup({ x: event.clientX, y: event.clientY, data });
    } catch (err) {
      setWordPopup(null);
    }
  };

  /** =======================
   * 4. 句子划选事件 (MouseUp)
   * ======================= */
  const handleMouseUp = async (event: React.MouseEvent) => {
    const selection = window.getSelection();
    
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (text.length < 2 || !/[a-zA-Z]/.test(text)) return;

    // 互斥逻辑
    setWordPopup(null);

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // 计算坐标
    // We calculate initial position here, but TranslationPopup handles its own draggable position via useDraggable
    // However, if we re-open popup, we might want to reset or use last position?
    // Current requirement: pop up near selection.
    
    // NOTE: Ideally, if there is an existing popup, we might want to reuse its position?
    // But for simplicity, let's just pop up near the text every time a NEW selection is made.
    const x = rect.left + rect.width / 2;
    const y = rect.top + window.scrollY;

    setSelectionPopup({ x, y, text, translation: "翻译中..." });

    try {
      const res = await fetch('http://127.0.0.1:8000/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      
      setSelectionPopup(prev => prev ? { ...prev, translation: data.translation_zh } : null);
    } catch (err: any) {
      setSelectionPopup(prev => prev ? { 
        ...prev, 
        translation: `翻译失败: ${err.message || '未知错误'}` 
      } : null);
    }
  };

  /* =======================
   * 渲染层
   * ======================= */
  return (
    <div className="min-h-screen bg-[#f9fafb] font-sans text-gray-900 pb-20">
      
      {/* 顶部导航栏 (Sticky Header) */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm transition-all duration-300">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center font-bold text-lg select-none">
               R
             </div>
             <h1 className="text-xl font-bold tracking-tight text-gray-800 hidden sm:block">
               Reading Assistant
             </h1>
          </div>

          <div className="flex items-center gap-4">
             {/* 字体控制组 */}
             <div className="flex items-center bg-gray-100/80 rounded-full p-1 border border-gray-200/50">
               <button 
                  onClick={() => setFontSize(s => Math.max(12, s - 2))}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white hover:shadow-sm text-gray-600 font-medium transition-all"
                  title="缩小字体"
               >
                 A-
               </button>
               <span className="w-12 text-center text-sm font-semibold text-gray-500 tabular-nums">
                 {fontSize}
               </span>
               <button 
                  onClick={() => setFontSize(s => Math.min(40, s + 2))}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white hover:shadow-sm text-gray-600 font-medium transition-all"
                  title="放大字体"
               >
                 A+
               </button>
             </div>
             
             {/* 动态上传按钮组 */}
             {sentences.length === 0 ? (
                 <label className="cursor-pointer bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-lg shadow-gray-200 flex items-center gap-2">
                    <span>Open File</span>
                    <input 
                      type="file" 
                      accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => handleFileUpload(e, 'replace')}
                      className="hidden"
                    />
                 </label>
             ) : (
                 <div className="flex items-center gap-2">
                     <label className="cursor-pointer bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
                        <span>Open New</span>
                        <input 
                          type="file" 
                          accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                          onChange={(e) => handleFileUpload(e, 'replace')}
                          className="hidden"
                        />
                     </label>

                     <label className="cursor-pointer bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-lg shadow-gray-200 flex items-center gap-2">
                        <span>Open Next</span>
                        <input 
                          type="file" 
                          accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                          onChange={(e) => handleFileUpload(e, 'append')}
                          className="hidden"
                        />
                     </label>
                 </div>
             )}
          </div>
        </div>
      </header>

      {/* 主阅读区域 */}
      <main className="max-w-4xl mx-auto px-4 mt-8">
        
        {/* 阅读卡片 */}
        <div 
          className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] min-h-[80vh] border border-gray-100 transition-all duration-300"
          onMouseUp={handleMouseUp}
        >
           {/* 空状态 / 初始引导 */}
           {sentences.length === 0 && !loading && (
             <div className="flex flex-col items-center justify-center py-32 px-6 text-center animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                    <span className="text-4xl">📄</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-3">开启你的沉浸式阅读</h2>
                <p className="text-gray-500 max-w-md mb-10 leading-relaxed">
                  支持 PDF、Word 文档及图片 OCR 识别。
                  <br/>
                  我们将为你保留完美的排版格式。
                </p>
                
                <label className="group relative cursor-pointer">
                   <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-200"></div>
                   <div className="relative bg-white border border-gray-200 hover:border-blue-500 text-gray-700 hover:text-blue-600 px-8 py-4 rounded-lg font-medium flex items-center gap-3 transition-all shadow-sm">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      选择文件上传
                   </div>
                   <input 
                      type="file" 
                      accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => handleFileUpload(e, 'replace')}
                      className="hidden"
                   />
                </label>
             </div>
           )}

           {/* 加载状态 */}
           {loading && sentences.length === 0 && (
             <div className="flex flex-col items-center justify-center py-40 text-gray-400 gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="animate-pulse text-sm font-medium">Loading content...</p>
             </div>
           )}

           {/* 文章内容 */}
            {sentences.length > 0 && (
                fileUrl && fileUrl.endsWith('.pdf') ? (
                    <PDFViewer 
                        fileUrl={fileUrl}
                        pdfPages={pdfPages}
                        sentences={sentences}
                        onTokenClick={(token, sentText, e) => handleTokenClick(token, sentText, e)}
                    />
                ) : (
                  <article 
                    className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900"
                    style={{
                      fontFamily: '"Times New Roman", "SimSun", serif',
                      fontSize: fontSize,
                      lineHeight: 1.8,
                      overflowWrap: 'normal',
                      wordBreak: 'normal'
                    }}
                  >
                    {sentences.map((sent, i) => {
                      const isNewPara = sent.layout?.is_new_paragraph;
                      const indentLevel = sent.layout?.indent_level || 0;
                      
                      return (
                        <span 
                          key={i} 
                          style={{ 
                            display: isNewPara ? 'block' : 'inline',
                            marginTop: isNewPara ? '1.5em' : 0, 
                            paddingLeft: isNewPara && indentLevel > 0 ? `${indentLevel * 2}em` : 0
                          }}
                        >
                          {sent.tokens.map((token) => (
                            <span
                              key={token.token_id}
                              onClick={(e) => handleTokenClick(token, sent.text, e)}
                              onMouseDown={(e) => e.stopPropagation()} 
                              className="hover:text-blue-600 transition-colors duration-200 decoration-blue-200/50 hover:underline hover:decoration-2 underline-offset-4 rounded cursor-pointer"
                              style={{
                                display: 'inline-block',
                                marginRight: token.has_space_after ? '0.25em' : 0, 
                                userSelect: 'text',
                              }}
                            >
                              {token.text}
                            </span>
                          ))}
                          {!isNewPara && <span style={{ marginRight: '0.25em' }}> </span>}
                        </span>
                      );
                    })}
                    
                    {loading && (
                      <div className="mt-8 flex items-center gap-3 text-gray-400 animate-pulse">
                         <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                         <span className="text-sm font-medium">Appending new content...</span>
                      </div>
                    )}
                  </article>
                )
            )}
        </div>
      </main>

      {/* --- 单词解释 Popup --- */}
      {wordPopup && (
        <WordPopup 
            x={wordPopup.x} 
            y={wordPopup.y} 
            data={wordPopup.data} 
        />
      )}

      {/* --- 句子翻译 Popup --- */}
      {selectionPopup && (
         <TranslationPopup 
            initialX={Math.min(selectionPopup.x - 192, window.innerWidth - 400)}
            initialY={selectionPopup.y + 10}
            text={selectionPopup.text}
            translation={selectionPopup.translation}
            onClose={() => setSelectionPopup(null)}
         />
      )}
    </div>
  );
}