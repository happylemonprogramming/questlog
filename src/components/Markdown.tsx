import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none text-[13.5px] leading-relaxed text-foreground dark:prose-invert prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-[14px] prose-headings:font-semibold prose-a:font-medium prose-a:text-info prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-ol:my-2 prose-ul:my-2 prose-li:my-0.5 prose-table:text-[12.5px] prose-th:py-1 prose-td:py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
