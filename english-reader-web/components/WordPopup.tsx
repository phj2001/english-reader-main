import React from 'react';

type ExplainResult = {
  word: string;
  meaning_zh: string;
  explanation_zh: string;
  confidence: number;
};

interface WordPopupProps {
  x: number;
  y: number;
  data: ExplainResult | null;
}

export const WordPopup: React.FC<WordPopupProps> = ({ x, y, data }) => {
  return (
    <div 
      className="fixed z-50 bg-white/95 backdrop-blur-xl shadow-2xl rounded-xl border border-gray-200/50 p-5 w-80 animate-in fade-in zoom-in-95 duration-200 max-h-[60vh] overflow-y-auto"
      style={{ 
        left: Math.min(x, window.innerWidth - 340), // 防止右侧溢出
        top: Math.min(y + 20, window.innerHeight - 300), // 防止底部溢出
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
      onMouseDown={(e) => e.stopPropagation()} 
      onDoubleClick={(e) => e.stopPropagation()} // 防止双击卡片关闭自己
    >
      {!data ? (
         <div className="flex items-center gap-3 text-gray-400">
           <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
           <span className="text-sm">Thinking...</span>
         </div>
      ) : (
        <div className="select-text"> {/* 允许复制 */}
          <div className="flex items-baseline justify-between mb-3 border-b border-gray-100 pb-2">
            <h3 className="text-xl font-bold text-gray-900">{data.word}</h3>
            <span className="text-xs font-mono text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
               {(data.confidence * 100).toFixed(0)}% Conf
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-2">{data.meaning_zh}</p>
          <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 p-3 rounded-lg select-text">
             {data.explanation_zh}
          </p>
        </div>
      )}
    </div>
  );
};
