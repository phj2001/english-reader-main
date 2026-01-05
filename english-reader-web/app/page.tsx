'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';

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
    translation?: string 
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
    // 防止触发上面的全局 closeAll，否则卡片刚要打开就被关掉了
    event.stopPropagation(); 
    
    // 互斥逻辑：点击单词时，强制关闭句子翻译
    setSelectionPopup(null);
    
    // 先在点击位置显示一个空的/加载中的卡片
    // 注意：不要调用 setLoading(true)，否则会触发全局加载动画导致页面抖动
    setWordPopup({ x: event.clientX, y: event.clientY, data: null });

    try {
      const res = await fetch('http://127.0.0.1:8000/explain-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token_id: token.token_id, 
          word: token.text, 
          // ⭐ 修复：传入真实的句子文本，而不是 "..."
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
    
    // 如果全局 mousedown 已经清空了选区，这里就会直接返回，防止“幽灵弹窗”
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    // 过滤太短或非字母的无效选区
    if (text.length < 2 || !/[a-zA-Z]/.test(text)) return;

    // 互斥逻辑：划词时，强制关闭单词卡片
    setWordPopup(null);

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // 计算坐标 (加上 scrollY 防止滚动后位置错乱)
    const x = rect.left + rect.width / 2;
    const y = rect.top + window.scrollY;

    // 立即显示“翻译中”
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
   * 5. 拖拽与缩放逻辑 (User Custom Layout)
   * ======================= */
  const [customLayout, setCustomLayout] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const dragRef = useRef<{startX: number, startY: number, initialLayout: any} | null>(null);

  const handleDragStart = (e: React.MouseEvent) => {
    // 仅允许左键拖拽
    if (e.button !== 0) return;
    e.preventDefault(); // 防止选中文本
    
    // 初始状态计算
    // 如果没有 customLayout，则使用当前的默认计算位置 (注意：这里需要与 Render 中的默认逻辑一致)
    const initialX = customLayout ? customLayout.x : Math.min((selectionPopup?.x || 0) - 192, window.innerWidth - 400);
    const initialY = customLayout ? customLayout.y : (selectionPopup?.y || 0) + 10;
    const initialW = customLayout ? customLayout.width : 384; // w-96 = 24rem = 384px
    const initialH = customLayout ? customLayout.height : 300; // 默认高度

    dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialLayout: { x: initialX, y: initialY, width: initialW, height: initialH }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const deltaX = moveEvent.clientX - dragRef.current.startX;
        const deltaY = moveEvent.clientY - dragRef.current.startY;
        
        setCustomLayout({
            x: dragRef.current.initialLayout.x + deltaX,
            y: dragRef.current.initialLayout.y + deltaY,
            width: dragRef.current.initialLayout.width,
            height: dragRef.current.initialLayout.height
        });
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const initialX = customLayout ? customLayout.x : Math.min((selectionPopup?.x || 0) - 192, window.innerWidth - 400);
    const initialY = customLayout ? customLayout.y : (selectionPopup?.y || 0) + 10;
    const initialW = customLayout ? customLayout.width : 384; 
    const initialH = customLayout ? customLayout.height : 300; // 初始预估高度，可能不准，但resize会修正它

    dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialLayout: { x: initialX, y: initialY, width: initialW, height: initialH }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const deltaX = moveEvent.clientX - dragRef.current.startX;
        const deltaY = moveEvent.clientY - dragRef.current.startY;
        
        // 限制最小尺寸
        const newWidth = Math.max(200, dragRef.current.initialLayout.width + deltaX);
        const newHeight = Math.max(150, dragRef.current.initialLayout.height + deltaY);

        setCustomLayout({
            x: dragRef.current.initialLayout.x,
            y: dragRef.current.initialLayout.y,
            width: newWidth,
            height: newHeight
        });
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  /* =======================
   * 渲染层：现代化 UI 重构
   * ======================= */
  return (
    <div className="min-h-screen bg-[#f9fafb] font-sans text-gray-900 pb-20">
      
      {/* 顶部导航栏 (Sticky Header) */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm transition-all duration-300">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
             {/* Logo / 标题 */}
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
                     {/* Open New File */}
                     <label className="cursor-pointer bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
                        <span>Open New</span>
                        <input 
                          type="file" 
                          accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                          onChange={(e) => handleFileUpload(e, 'replace')}
                          className="hidden"
                        />
                     </label>

                     {/* Open Next File */}
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

           {/* 加载状态 (仅在没有内容时显示大 Loading) */}
           {loading && sentences.length === 0 && (
             <div className="flex flex-col items-center justify-center py-40 text-gray-400 gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="animate-pulse text-sm font-medium">Loading content...</p>
             </div>
           )}

           {/* 文章内容 */}
            {/* 文字内容渲染逻辑 (分流: PDF Viewer vs Text Viewer) */}
            {sentences.length > 0 && (
                fileUrl && fileUrl.endsWith('.pdf') ? (
                    // === PDF View ===
                    // === PDF View ===
                    <PDFViewer 
                        fileUrl={fileUrl}
                        pdfPages={pdfPages}
                        sentences={sentences}
                        onTokenClick={(token, sentText, e) => handleTokenClick(token, sentText, e)}
                    />
                ) : (
                   // === Legacy Text View ===
                   <article 
                    className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900"
                    style={{
                      fontFamily: '"Times New Roman", "SimSun", serif',
                      fontSize: fontSize,
                      lineHeight: 1.8,
                      overflowWrap: 'break-word',
                      wordBreak: 'keep-all'
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
                    
                    {/* 追加内容时的底部 Loading */}
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
        <div 
          className="fixed z-50 bg-white/95 backdrop-blur-xl shadow-2xl rounded-xl border border-gray-200/50 p-5 w-80 animate-in fade-in zoom-in-95 duration-200 max-h-[60vh] overflow-y-auto"
          style={{ 
            left: Math.min(wordPopup.x, window.innerWidth - 340), // 防止右侧溢出
            top: Math.min(wordPopup.y + 20, window.innerHeight - 300), // 防止底部溢出
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
          onMouseDown={(e) => e.stopPropagation()} 
          onDoubleClick={(e) => e.stopPropagation()} // 防止双击卡片关闭自己
        >
          {!wordPopup.data ? (
             <div className="flex items-center gap-3 text-gray-400">
               <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
               <span className="text-sm">Thinking...</span>
             </div>
          ) : (
            <div className="select-text"> {/* 允许复制 */}
              <div className="flex items-baseline justify-between mb-3 border-b border-gray-100 pb-2">
                <h3 className="text-xl font-bold text-gray-900">{wordPopup.data.word}</h3>
                <span className="text-xs font-mono text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                   {(wordPopup.data.confidence * 100).toFixed(0)}% Conf
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-2">{wordPopup.data.meaning_zh}</p>
              <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 p-3 rounded-lg select-text">
                 {wordPopup.data.explanation_zh}
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- 句子翻译 Popup (Draggable & Resizable) --- */}
      {selectionPopup && (
         <div 
            className="fixed z-50 bg-gray-900/95 backdrop-blur-md text-white shadow-2xl rounded-xl flex flex-col animate-in fade-in zoom-in-95 duration-200"
            style={{ 
              // 使用 Custom Layout 或 默认 Layout
              left: customLayout ? customLayout.x : Math.min(selectionPopup.x - 192, window.innerWidth - 400),
              top: customLayout ? customLayout.y : selectionPopup.y + 10,
              width: customLayout ? customLayout.width : 384, // w-96
              height: customLayout ? customLayout.height : 'auto',
              maxHeight: customLayout ? 'none' : '60vh', // 默认模式下限制高度，自定义模式下由 height 控制
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()} 
         >
            {/* Draggable Header */}
            <div 
                className="flex items-center justify-between px-5 py-3 border-b border-gray-700 cursor-move select-none"
                onMouseDown={handleDragStart}
            >
               <div className="flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <span className="text-sm font-medium text-gray-300">AI 翻译</span>
               </div>
               
               <button 
                 onClick={() => setSelectionPopup(null)}
                 className="text-gray-400 hover:text-white transition-colors"
                 onMouseDown={(e) => e.stopPropagation()} // 防止触发拖拽
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5">
                <p className="text-gray-300 text-sm italic mb-4 border-l-2 border-blue-500 pl-3 leading-relaxed opacity-80 select-text">
                "{selectionPopup.text}"
                </p>

                <div className="text-base leading-relaxed font-light select-text">
                {selectionPopup.translation === "翻译中..." ? (
                    <span className="animate-pulse flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                        翻译中...
                    </span>
                ) : (
                    selectionPopup.translation
                )}
                </div>
            </div>

            {/* Resize Handle (Bottom Right) */}
            <div 
                className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-1"
                onMouseDown={handleResizeStart}
            >
                <div className="w-2 h-2 bg-gray-500 rounded-full opacity-50"></div>
            </div>
         </div>
      )}
    </div>
  );
}