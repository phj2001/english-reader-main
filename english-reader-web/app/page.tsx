'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { WordPopup } from '../components/WordPopup';
import { TranslationPopup } from '../components/TranslationPopup';
import { getAIConfigForAPI } from '../lib/aiConfig';

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

// 用于标记不同图片之间的分隔（仅在 rawText 内部使用）
const IMAGE_SPLIT_MARK = '<<__IMG_SPLIT__>>';

export default function HomePage() {
  const router = useRouter();

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
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string>('');

  // 性能优化：前端缓存和防抖
  const [explainCache] = useState<Map<string, ExplainResult>>(new Map());
  const [translateCache] = useState<Map<string, string>>(new Map());
  const [pendingRequests] = useState<Set<string>>(new Set());

  // PDF 相关状态
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<{page_idx: number, width: number, height: number}[]>([]);
  const [rawText, setRawText] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<string | null>(null);
  const [docxImageOcrText, setDocxImageOcrText] = useState<string | null>(null);  // Word 文档中图片的 OCR 文本
  // 归一化空行：
  // - 段内：把任意连续空行压缩为 1 个换行（不留空白行）
  // - 不同图片之间：通过特殊标记 IMAGE_SPLIT_MARK 保留 1 个空白行
  const normalizedRawText = rawText
    ? rawText
        // 先把图片分隔标记替换为占位符，防止被下面的正则吃掉
        .replace(new RegExp(`\\n${IMAGE_SPLIT_MARK}\\n`, 'g'), '\n<SPLIT>\n')
        // 段落内部：把连续多个换行压缩为单个换行（不出现空白行）
        .replace(/\n\s*\n+/g, '\n')
        // 最后把占位符还原成真正的“空一行”（两个换行）
        .replace(/\n<SPLIT>\n/g, '\n\n')
    : null;


  /* =======================
   * 1. 核心逻辑：文件上传与处理
   * ======================= */
  const processFile = async (file: File, mode: 'replace' | 'append' = 'replace') => {
    setLoading(true);
    setUploadingFileName(file.name);
    
    if (mode === 'replace') {
        setSentences([]); // 清空旧内容
        setRawText(null);
        setSourceType(null);
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
          setSourceType(data.source_type || null);

          // 对于首个文件：
          // - 图片 / 纯文本：使用 raw_text 作为主体内容
          // - PDF / Word：只使用各自的专用渲染方式，不在 rawText 中重复一份
          if (data.source_type === 'image' || data.source_type === 'txt') {
            setRawText(data.raw_text || null);
          } else {
            setRawText(null);
          }
          
          // 如果是 Word 文档且包含图片 OCR 结果，保存起来
          if (data.source_type === 'docx' && data.docx_image_ocr_combined) {
            setDocxImageOcrText(data.docx_image_ocr_combined);
            console.log('Word document contains image OCR text:', data.docx_image_ocr_combined.substring(0, 100));
          } else {
            setDocxImageOcrText(null);
          }
      } else {
           // append logic: 在已有内容后追加新内容
           if (newSentences.length > 0) {
               if (!newSentences[0].layout) {
                   newSentences[0].layout = { is_new_paragraph: true, indent_level: 0 };
               } else {
                   newSentences[0].layout.is_new_paragraph = true;
               }
               setSentences(prev => [...prev, ...newSentences]);
           }

           // 处理追加的内容
           // 1. 如果追加的是图片或txt，将其 raw_text 追加到 rawText
           if (data.raw_text && (data.source_type === 'image' || data.source_type === 'txt')) {
             setRawText(prev => {
               if (!prev) return data.raw_text;
               const trimmedPrev = prev.replace(/\s+$/, '');
               const trimmedNew = (data.raw_text as string).replace(/^\s+/, '');
               return `${trimmedPrev}\n${IMAGE_SPLIT_MARK}\n${trimmedNew}`;
             });
           }
           
           // 2. 如果追加的是 Word 文档且包含图片 OCR，追加到 docxImageOcrText
           if (data.source_type === 'docx' && data.docx_image_ocr_combined) {
             setDocxImageOcrText(prev => {
               if (!prev) return data.docx_image_ocr_combined;
               return `${prev}\n\n${data.docx_image_ocr_combined}`;
             });
             // 同时也把 raw_text 追加用于渲染
             if (data.raw_text) {
               setRawText(prev => {
                 if (!prev) return data.raw_text;
                 const trimmedPrev = prev.replace(/\s+$/, '');
                 const trimmedNew = (data.raw_text as string).replace(/^\s+/, '');
                 return `${trimmedPrev}\n${IMAGE_SPLIT_MARK}\n${trimmedNew}`;
               });
             }
           }
           
           // 3. 如果追加的是普通 Word 文档（无图片 OCR），也追加其 raw_text
           if (data.source_type === 'docx' && !data.docx_image_ocr_combined && data.raw_text) {
             setRawText(prev => {
               if (!prev) return data.raw_text;
               const trimmedPrev = prev.replace(/\s+$/, '');
               const trimmedNew = (data.raw_text as string).replace(/^\s+/, '');
               return `${trimmedPrev}\n${IMAGE_SPLIT_MARK}\n${trimmedNew}`;
             });
           }
      }
      
    } catch (err: any) {
      console.error(err);
      alert(`解析失败: ${err.message}`);
    } finally {
      setLoading(false);
      setUploadingFileName('');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, mode: 'replace' | 'append' = 'replace') => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    await processFile(file, mode);
    
    // 清空 input value
    event.target.value = '';
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      
      // Validate file type
      const validTypes = ['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp'];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (!validTypes.includes(fileExt)) {
        alert('不支持的文件格式。请上传 PDF、Word、文本或图片文件。');
        return;
      }
      
      await processFile(file, 'replace');
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

    // 获取前端配置的 AI 参数
    const aiConfig = getAIConfigForAPI();
    const cacheKey = `${token.text}:${sentenceText}:${JSON.stringify(aiConfig)}`;

    // 🚀 性能优化1：检查缓存
    if (explainCache.has(cacheKey)) {
      console.log('✅ Cache hit for:', token.text);
      setWordPopup({ x: event.clientX, y: event.clientY, data: explainCache.get(cacheKey)! });
      return;
    }

    // 🚀 性能优化2：防抖 - 防止重复请求
    if (pendingRequests.has(cacheKey)) {
      console.log('⏳ Request already in progress, skipping...');
      return;
    }

    pendingRequests.add(cacheKey);
    setWordPopup({ x: event.clientX, y: event.clientY, data: null });

    try {
      const res = await fetch('http://127.0.0.1:8000/explain-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: token.token_id,
          word: token.text,
          sentence: sentenceText,
          ...aiConfig  // 动态配置参数
        })
      });
      const data = await res.json();

      // 🚀 性能优化3：存入缓存
      explainCache.set(cacheKey, data);
      setWordPopup({ x: event.clientX, y: event.clientY, data });
    } catch (err) {
      setWordPopup(null);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  };

  /** =======================
   * 3.5 原始文本模式下的单词点击（用于图片 OCR，直接按换行渲染）
   * ======================= */
  const handleRawTextClick = (e: React.MouseEvent) => {
    // 如果正在划选，用于句子翻译，则不触发单词解释
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      return;
    }

    let range: Range | null = null;
    let textNode: Node | null = null;
    let offset = 0;

    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        textNode = range.startContainer;
        offset = range.startOffset;
      }
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        textNode = pos.offsetNode;
        offset = pos.offset;
      }
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const textContent = textNode.textContent || '';
    const isWordChar = (char: string) => /[A-Za-z0-9'\-]/.test(char);

    let start = offset;
    while (start > 0 && isWordChar(textContent[start - 1])) start--;

    let end = offset;
    while (end < textContent.length && isWordChar(textContent[end])) end++;

    const clickedWord = textContent.slice(start, end);
    if (!clickedWord.trim()) return;

    // 取当前行作为句子上下文（基于最近的换行）
    const full = rawText || '';
    const absoluteIndex = full.indexOf(textContent);
    let lineText = textContent;

    if (absoluteIndex >= 0) {
      const lineStart = full.lastIndexOf('\n', absoluteIndex);
      const lineEnd = full.indexOf('\n', absoluteIndex + textContent.length);
      lineText = full.slice(
        lineStart === -1 ? 0 : lineStart + 1,
        lineEnd === -1 ? full.length : lineEnd
      );
    }

    const dummyToken: Token = {
      token_id: `raw-${Date.now()}`,
      text: clickedWord,
      has_space_after: true,
    };

    handleTokenClick(dummyToken, lineText, e);
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

    // 获取前端配置的 AI 参数
    const aiConfig = getAIConfigForAPI();
    const cacheKey = `translate:${text}:${JSON.stringify(aiConfig)}`;

    // 🚀 性能优化：检查翻译缓存
    if (translateCache.has(cacheKey)) {
      console.log('✅ Translation cache hit');
      setSelectionPopup({ x, y, text, translation: translateCache.get(cacheKey)! });
      return;
    }

    // 🚀 性能优化：防抖
    if (pendingRequests.has(cacheKey)) {
      console.log('⏳ Translation request already in progress');
      return;
    }

    pendingRequests.add(cacheKey);
    setSelectionPopup({ x, y, text, translation: "翻译中..." });

    try {
      const res = await fetch('http://127.0.0.1:8000/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          ...aiConfig  // 动态配置参数
        })
      });
      const data = await res.json();

      // 🚀 性能优化：存入翻译缓存
      translateCache.set(cacheKey, data.translation_zh);
      
      setSelectionPopup(prev => prev ? { ...prev, translation: data.translation_zh } : null);
    } catch (err: any) {
      setSelectionPopup(prev => prev ?
        {
          ...prev,
          translation: `翻译失败: ${err.message || '未知错误'}`
        } : null);
    } finally {
      pendingRequests.delete(cacheKey);
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

             {/* 设置按钮 */}
             <button
                onClick={() => router.push('/settings')}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700"
                title="设置"
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">设置</span>
             </button>

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
           className={`bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] min-h-[80vh] border border-gray-100 transition-all duration-300 drag-drop-zone relative ${
             isDragging ? 'drag-over' : ''
           }`}
           onMouseUp={handleMouseUp}
           onDragOver={handleDragOver}
           onDragLeave={handleDragLeave}
           onDrop={handleDrop}
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
             <div className="flex flex-col items-center justify-center py-40 text-gray-400 gap-6">
                <div className="relative">
                  <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-blue-600"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {uploadingFileName.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    {uploadingFileName.match(/\.(jpg|jpeg|png|webp)$/i) 
                      ? '🔍 正在识别图片文字...' 
                      : '📖 正在加载文档...'}
                  </p>
                  <p className="text-xs text-gray-500">{uploadingFileName}</p>
                  {uploadingFileName.match(/\.(jpg|jpeg|png|webp)$/i) && (
                    <div className="mt-3 px-4 py-2 bg-blue-50 rounded-lg inline-block">
                      <p className="text-xs text-blue-700 font-medium">使用 Tesseract OCR 引擎</p>
                      <p className="text-xs text-blue-600">正在分析段落结构...</p>
                    </div>
                  )}
                </div>
             </div>
           )}

           {/* 文章内容 */}
           {sentences.length > 0 && (
               fileUrl && fileUrl.endsWith('.pdf') && sourceType === 'docx' ? (
                 // Word 文档：PDF 渲染 + 图片 OCR 文本
                 <>
                    <PDFViewer 
                        fileUrl={fileUrl}
                        pdfPages={pdfPages}
                        sentences={sentences}
                        onTokenClick={(token, sentText, e) => handleTokenClick(token, sentText, e)}
                    />
                    {/* Word 文档中图片的 OCR 文本（可点击查词）- 与直接上传图片效果完全一致 */}
                    {docxImageOcrText && (
                      <div className="border-t border-gray-200 mt-4">
                        <div className="px-8 sm:px-12 py-4 bg-gray-50/80">
                          <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
                            <span className="text-lg">🖼️</span>
                            文档中图片的文字内容（OCR 识别）
                          </h3>
                        </div>
                        <pre
                          className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900 ocr-text"
                          style={{
                            fontFamily: '"Times New Roman", "Georgia", "SimSun", serif',
                            fontSize: fontSize,
                            lineHeight: 1.9,
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'normal',
                            wordBreak: 'normal',
                          }}
                          onClick={handleRawTextClick}
                        >
                          {docxImageOcrText}
                        </pre>
                      </div>
                    )}
                    {/* 通过 Open Next 追加的内容（图片、txt 等） */}
                    {normalizedRawText && (
                      <pre
                        className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900 ocr-text border-t border-gray-100 mt-4"
                        style={{
                          fontFamily: '"Times New Roman", "Georgia", "SimSun", serif',
                          fontSize: fontSize,
                          lineHeight: 1.9,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'normal',
                          wordBreak: 'normal',
                        }}
                        onClick={handleRawTextClick}
                      >
                        {normalizedRawText}
                      </pre>
                    )}
                 </>
               ) : fileUrl && fileUrl.endsWith('.pdf') ? (
                 // 纯 PDF 文件
                 <>
                    <PDFViewer 
                        fileUrl={fileUrl}
                        pdfPages={pdfPages}
                        sentences={sentences}
                        onTokenClick={(token, sentText, e) => handleTokenClick(token, sentText, e)}
                    />
                    {/* 如果通过 Open Next 追加了图片/文档，则在 PDF 下方以新的一页形式展示 */}
                    {normalizedRawText && (
                      <pre
                        className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900 ocr-text border-t border-gray-100 mt-8"
                        style={{
                          fontFamily: '"Times New Roman", "Georgia", "SimSun", serif',
                          fontSize: fontSize,
                          lineHeight: 1.9,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'normal',
                          wordBreak: 'normal',
                        }}
                        onClick={handleRawTextClick}
                      >
                        {normalizedRawText}
                      </pre>
                    )}
                 </>
                ) : sourceType === 'image' && normalizedRawText ? (
                  // 图片 OCR：直接按原始文本换行渲染，100% 复刻后端 OCR 的排版
                  <pre
                    className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900 ocr-text"
                    style={{
                      fontFamily: '"Times New Roman", "Georgia", "SimSun", serif',
                      fontSize: fontSize,
                      lineHeight: 1.9,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'normal',
                      wordBreak: 'normal',
                    }}
                    onClick={handleRawTextClick}
                  >
                    {normalizedRawText}
                  </pre>
                ) : (
                  <article 
                    className="px-8 py-10 sm:px-12 sm:py-16 selection:bg-blue-100 selection:text-blue-900 ocr-text"
                    style={{
                      fontFamily: '"Times New Roman", "Georgia", "SimSun", serif',
                      fontSize: fontSize,
                      lineHeight: 1.9,
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
                            // 段落首行：只换行，不再额外插入整行空白
                            marginTop: 0,
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

      {/* 版权信息 */}
      <footer className="fixed bottom-0 left-0 right-0 py-2 text-center text-xs text-gray-400 bg-white/80 backdrop-blur-sm border-t border-gray-100">
        © 2025 English Reader · Created by 清忧@凡辰
      </footer>
    </div>
  );
}