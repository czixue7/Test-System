import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

// Markdown 渲染组件：支持标题/列表/粗体/代码/引用/表格及 <details> 折叠块，自动适配深浅主题
const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
    </div>
  );
};

export default MarkdownView;
