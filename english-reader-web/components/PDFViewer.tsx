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

  return (
    <div className="bg-gray-100 p-4 min-h-screen flex flex-col items-center gap-4">
      <Document
        file={fileUrl}
        loading={<div className="text-gray-400">Loading PDF...</div>}
        error={<div className="text-red-500">Failed to load PDF.</div>}
      >
        {pdfPages.map((pageMeta) => (
          <div key={pageMeta.page_idx} className="relative shadow-lg">
            <Page
              pageNumber={pageMeta.page_idx + 1}
              width={800} // 固定宽度，或可响应式
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(page) => {
                setRenderedWidths((prev) => ({
                  ...prev,
                  [pageMeta.page_idx]: page.width,
                }));
              }}
            />
            {/* Overlay Layer */}
            <div className="absolute inset-0 pointer-events-none">
              {/* 过滤属于当前页的 Token */}
              {sentences.map((sent) =>
                sent.tokens
                  .filter((t) => t.bbox && t.bbox.page === pageMeta.page_idx)
                  .map((token) => {
                    if (!token.bbox) return null;
                    // 计算缩放 (rendered / original)
                    const renderedW = renderedWidths[pageMeta.page_idx] || 800;
                    const scale = renderedW / pageMeta.width;

                    return (
                      <div
                        key={token.token_id}
                        onClick={(e) => onTokenClick(token, sent.text, e)}
                        className="absolute cursor-pointer hover:bg-blue-500/20 hover:border hover:border-blue-500 pointer-events-auto transition-colors"
                        style={{
                          left: token.bbox.x0 * scale,
                          top: token.bbox.top * scale,
                          width: token.bbox.width * scale,
                          height: token.bbox.height * scale,
                        }}
                        title={token.text} // Hover 提示
                      />
                    );
                  })
              )}
            </div>
          </div>
        ))}
      </Document>
    </div>
  );
}
