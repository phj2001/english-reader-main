'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// 设置 PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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

interface PDFViewerProps {
  fileUrl: string;
  pdfPages: { page_idx: number; width: number; height: number }[];
  sentences: Sentence[];
  onTokenClick: (token: Token, sentenceText: string, event: React.MouseEvent) => void;
}

export default function PDFViewer({ fileUrl, pdfPages, sentences, onTokenClick }: PDFViewerProps) {
  const [renderedWidths, setRenderedWidths] = useState<Record<number, number>>({});

  const handlePageClick = (e: React.MouseEvent, pageMeta: { page_idx: number; width: number; height: number }) => {
    // 使用浏览器原生 API 获取点击位置的文本
    // 这比后端坐标映射更精准，是业界标准做法
    
    // 兼容性处理: caretRangeFromPoint (Standard) vs caretPositionFromPoint (Firefox)
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

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      console.log("Not clicked on text");
      return;
    }

    const textContent = textNode.textContent || "";
    
    // 1. 提取单词 (向左向右扩展，直到遇到非单词字符)
    // 简单的正则: \w 包括 [a-zA-Z0-9_], 但可能不包括连字符?
    // 扩展: 允许字母、数字、连字符、撇号
    const isWordChar = (char: string) => /[\w\-\u00C0-\u00FF]/.test(char); // \u00C0-\u00FF for simple latin accents

    let start = offset;
    while (start > 0 && isWordChar(textContent[start - 1])) {
      start--;
    }
    
    let end = offset;
    while (end < textContent.length && isWordChar(textContent[end])) {
      end++;
    }

    const clickedWord = textContent.slice(start, end);
    if (!clickedWord.trim()) return;

    // 2. 提取句子上下文 (简单地从当前节点向外查找，或者就用当前节点的全部内容)
    // PDF.js 的 textLayer 经常把一句话拆成多个 span，直接获取 DOM parent 可能不够。
    // 简单策略: 拿当前 span 的内容作为 context (通常是一行或半句)，
    // 或者发送给后端时，后端根据 fuzzy match 在 sentences 中找全句。
    // 这里我们尝试拿完整一点的 Context: 如果 span 很短，就拿 parent 的 textContent?
    // PDF.js 的结构平坦: div > span, span...
    // 我们拿 parent (Layer div) 可能会太大。
    
    // 优化策略: 为了让 AI 理解，传当前 span 即可，或者尝试合并前后 span。
    // 现在先只传当前 span 内容。
    let sentenceContext = textContent;
    
    // 尝试寻找更完整的句子 (简单的向左向右合并 neighbor spans)
    // 这是一个 heuristc
    const parentSpan = textNode.parentElement;
    if (parentSpan && parentSpan.classList.contains('react-pdf__Page__textContent')) {
        // 如果直接点到了 layer (unlikely if strictly textNode)
    } else if (parentSpan && parentSpan.nextElementSibling) {
        // append next span
        sentenceContext += " " + (parentSpan.nextElementSibling.textContent || "");
    }
     if (parentSpan && parentSpan.previousElementSibling) {
        // prepend prev span
        sentenceContext = (parentSpan.previousElementSibling.textContent || "") + " " + sentenceContext;
    }

    console.log(`[DOM Click] Word: ${clickedWord}, Context: ${sentenceContext}`);

    // check text selection
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
        return; 
    }

    // 模拟一个 Token 对象传回
    const dummyToken: Token = {
        token_id: `dom-${Date.now()}`,
        text: clickedWord,
        has_space_after: true
    };

    onTokenClick(dummyToken, sentenceContext, e);
  };

  return (
    <div className="bg-gray-100 p-4 min-h-screen flex flex-col items-center gap-4">
      <Document
        file={fileUrl}
        loading={<div className="text-gray-400">Loading PDF...</div>}
        error={<div className="text-red-500">Failed to load PDF.</div>}
      >
        {pdfPages.map((pageMeta) => (
          <div 
            key={pageMeta.page_idx} 
            className="relative shadow-lg group cursor-text"
            onClick={(e) => handlePageClick(e, pageMeta)}
          >
            <Page
              pageNumber={pageMeta.page_idx + 1}
              width={800} // 固定宽度，或可响应式
              renderTextLayer={true} 
              renderAnnotationLayer={false}
              onLoadSuccess={(page) => {
                setRenderedWidths((prev) => ({
                  ...prev,
                  [pageMeta.page_idx]: page.width,
                }));
              }}
            />
          </div>
        ))}
      </Document>
    </div>
  );
}
