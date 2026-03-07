'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

type TutorMarkdownTone = 'light' | 'dark';

interface TutorMarkdownProps {
  content: string;
  onCitationClick?: (index: number) => void;
  tone?: TutorMarkdownTone;
  compact?: boolean;
  className?: string;
}

function deduplicateCitations(content: string): string {
  const allCites = [...content.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (allCites.length === 0) return content;

  const uniqueCites = new Set(allCites);
  if (uniqueCites.size === 1) {
    const n = allCites[0];
    const stripped = content.replace(/\s*\[\d+\]/g, '');
    return `${stripped.trimEnd()} [${n}]`;
  }

  const sentencePattern = /([^.!?\n]+[.!?\n]+)/g;
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sentencePattern.exec(content)) !== null) {
    sentences.push(match[1]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    sentences.push(content.slice(lastIndex));
  }
  if (sentences.length === 0) return content;

  const parsed = sentences.map((sentence) => {
    const cites = [...sentence.matchAll(/\[(\d+)\]/g)].map((cite) => Number(cite[1]));
    const stripped = sentence.replace(/\s*\[\d+\]/g, '');
    const source = cites.length > 0 ? cites[cites.length - 1] : null;
    return { text: stripped, source };
  });

  const result: string[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const current = parsed[i];
    const next = i + 1 < parsed.length ? parsed[i + 1] : null;
    if (current.source == null) {
      result.push(current.text);
    } else if (next && next.source === current.source) {
      result.push(current.text);
    } else {
      result.push(`${current.text.trimEnd()} [${current.source}]`);
    }
  }

  return result.join('');
}

function preprocessCitations(content: string): string {
  return deduplicateCitations(content).replace(/\[(\d+)\]/g, '%%CITE:$1%%');
}

function expandCitations(
  text: string,
  onCitationClick?: (n: number) => void,
  keyPrefix = 'cite'
): React.ReactNode[] {
  if (!text.includes('%%CITE:')) return [text];
  const parts = text.split(/(%%CITE:\d+%%)/);
  return parts.map((part, i) => {
    const match = part.match(/^%%CITE:(\d+)%%$/);
    if (!match) return <React.Fragment key={`${keyPrefix}-text-${i}`}>{part}</React.Fragment>;

    const n = Number(match[1]);
    return (
      <sup
        key={`${keyPrefix}-citation-${i}-${n}`}
        className="mx-0.5 inline-flex h-5 w-5 cursor-pointer select-none items-center justify-center rounded-full bg-[#03b2e6] text-[0.65em] font-bold text-white transition-colors hover:bg-[#0291be]"
        onClick={() => onCitationClick?.(n)}
        title={`Jump to source ${n}`}
      >
        {n}
      </sup>
    );
  });
}

function injectCitations(
  node: React.ReactNode,
  onCitationClick?: (n: number) => void,
  keyPrefix = 'root'
): React.ReactNode {
  if (typeof node === 'string') {
    return expandCitations(node, onCitationClick, keyPrefix);
  }

  if (Array.isArray(node)) {
    return node.flatMap((child, index) => injectCitations(child, onCitationClick, `${keyPrefix}-${index}`));
  }

  if (!React.isValidElement(node)) {
    return node;
  }

  const props = (node.props ?? {}) as { children?: React.ReactNode; className?: string };
  const className = typeof props.className === 'string' ? props.className : '';
  const elementType = typeof node.type === 'string' ? node.type : '';

  if (
    elementType === 'code'
    || elementType === 'pre'
    || className.includes('katex')
  ) {
    return node;
  }

  if (props.children == null) {
    return node;
  }

  const elementKey = node.key != null ? String(node.key) : 'node';
  return React.cloneElement(
    node,
    undefined,
    injectCitations(props.children, onCitationClick, `${keyPrefix}-${elementKey}`)
  );
}

function textRenderer(
  Tag: React.ElementType,
  className: string,
  onCitationClick?: (index: number) => void
) {
  return ({
    children,
    className: localClassName,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) =>
    React.createElement(
      Tag,
      { ...props, className: cn(className, localClassName) },
      injectCitations(children, onCitationClick)
    );
}

export function TutorMarkdown({
  content,
  onCitationClick,
  tone = 'light',
  compact = false,
  className,
}: TutorMarkdownProps) {
  const wrapperClassName = cn(
    'tutor-markdown max-w-none break-words [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1 [&_.katex]:text-inherit',
    tone === 'dark'
      ? [
          'prose prose-invert prose-cyan',
          'prose-headings:text-white prose-p:text-white/95 prose-strong:text-white prose-em:text-cyan-100',
          'prose-li:text-white/90 prose-blockquote:border-cyan-300/30 prose-blockquote:text-cyan-50',
          'prose-code:text-cyan-100 prose-a:text-cyan-200',
        ]
      : [
          'prose prose-slate prose-cyan',
          'prose-headings:text-slate-900 prose-p:text-slate-800 prose-strong:text-slate-900 prose-em:text-sky-900',
          'prose-li:text-slate-800 prose-blockquote:border-sky-300 prose-blockquote:text-sky-950',
          'prose-code:text-sky-900 prose-a:text-sky-700',
        ],
    compact ? 'prose-sm' : 'prose-base',
    className
  );

  return (
    <div className={wrapperClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: textRenderer('h1', 'mb-3 mt-1 text-xl font-bold tracking-tight', onCitationClick),
          h2: textRenderer('h2', 'mb-2 mt-4 text-lg font-semibold tracking-tight', onCitationClick),
          h3: textRenderer('h3', 'mb-2 mt-3 text-base font-semibold tracking-tight', onCitationClick),
          h4: textRenderer('h4', 'mb-1 mt-3 text-sm font-semibold uppercase tracking-[0.08em]', onCitationClick),
          p: textRenderer('p', 'my-2 leading-7', onCitationClick),
          li: textRenderer('li', 'my-1 leading-7', onCitationClick),
          strong: textRenderer('strong', 'font-semibold', onCitationClick),
          em: textRenderer('em', 'italic', onCitationClick),
          blockquote: textRenderer('blockquote', 'my-3 border-l-2 pl-4 italic', onCitationClick),
          ul: ({ children, ...props }) => (
            <ul {...props} className={cn('my-3 list-disc space-y-1 pl-5', props.className)}>
              {injectCitations(children, onCitationClick)}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol {...props} className={cn('my-3 list-decimal space-y-1 pl-5', props.className)}>
              {injectCitations(children, onCitationClick)}
            </ol>
          ),
          hr: ({ ...props }) => (
            <hr
              {...props}
              className={cn(
                'my-4 border-0 border-t',
                tone === 'dark' ? 'border-white/15' : 'border-slate-200',
                props.className
              )}
            />
          ),
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className={cn('font-medium underline decoration-cyan-400/50 underline-offset-4', props.className)}
            >
              {injectCitations(children, onCitationClick)}
            </a>
          ),
          code: ({ children, className: codeClassName, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
            const language = /language-(\w+)/.exec(codeClassName || '');
            const isBlock = Boolean(language);
            if (!isBlock) {
              return (
                <code
                  {...props}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[0.92em]',
                    tone === 'dark' ? 'bg-white/10 text-cyan-100' : 'bg-slate-100 text-sky-900',
                    codeClassName
                  )}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre
                className={cn(
                  'my-4 overflow-x-auto rounded-2xl border px-4 py-3 text-sm',
                  tone === 'dark'
                    ? 'border-white/10 bg-slate-950/80 text-slate-100'
                    : 'border-slate-200 bg-slate-950 text-slate-50'
                )}
              >
                <code {...props} className={codeClassName}>
                  {children}
                </code>
              </pre>
            );
          },
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table {...props} className={cn('min-w-full border-collapse text-sm', props.className)}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              {...props}
              className={cn(
                'border-b px-3 py-2 text-left font-semibold',
                tone === 'dark' ? 'border-white/15 text-white' : 'border-slate-200 text-slate-900',
                props.className
              )}
            >
              {injectCitations(children, onCitationClick)}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              {...props}
              className={cn(
                'border-b px-3 py-2 align-top',
                tone === 'dark' ? 'border-white/10 text-white/90' : 'border-slate-100 text-slate-800',
                props.className
              )}
            >
              {injectCitations(children, onCitationClick)}
            </td>
          ),
        }}
      >
        {preprocessCitations(content)}
      </ReactMarkdown>
    </div>
  );
}
