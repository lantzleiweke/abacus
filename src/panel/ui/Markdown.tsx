import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { useMemo } from 'preact/hooks';
import { useStoreApi } from '../store';

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Beads text is written by people and agents, so it is rendered as markdown and then sanitized. Images become links
 * (nothing loads from elsewhere on its own); single line breaks are kept, as people write them.
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    image({ href, text }) {
      return `<a href="${escapeAttr(href)}">${escapeAttr(text || 'image')}</a>`;
    },
    // Task list boxes as drawn marks: form controls are not allowed through, and these are not meant to be clicked.
    checkbox({ checked }) {
      return `<span data-check="${checked ? 'done' : 'open'}" role="img" aria-label="${checked ? 'Done' : 'Not done yet'}"></span> `;
    },
  },
});

/**
 * A link whose address the sanitizer removes (`javascript:` and the like) keeps it as `data-href`, so a click can still
 * offer the text to copy. It is never opened.
 */
const removedHrefs = new WeakMap<Element, string>();
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'href' && node.nodeName === 'A') removedHrefs.set(node, data.attrValue);
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const href = removedHrefs.get(node);
  if (href !== undefined && !node.hasAttribute('href')) node.setAttribute('data-href', href);
});

const PURIFY = {
  FORBID_TAGS: ['style', 'img', 'picture', 'source', 'video', 'audio', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math'],
  FORBID_ATTR: ['style', 'class', 'id'],
};

/** Markdown to safe HTML. `inline` keeps it to one paragraph's worth (no block wrapper). */
export function toSafeHtml(text: string, inline = false): string {
  const html = inline ? (marked.parseInline(text, { async: false }) as string) : (marked.parse(text, { async: false }) as string);
  return DOMPurify.sanitize(html, PURIFY);
}

/** Rendered markdown. Links open outside the panel through OpenChamber; nothing in the text runs. */
export function Markdown({ text, inline = false, class: className }: { text: string; inline?: boolean; class?: string }) {
  const store = useStoreApi();
  const html = useMemo(() => toSafeHtml(text, inline), [text, inline]);
  const onClick = (e: MouseEvent) => {
    const link = e.target instanceof Element ? e.target.closest('a[href], a[data-href]') : null;
    if (!link) return;
    e.preventDefault();
    store.openUrl(link.getAttribute('href') ?? link.getAttribute('data-href') ?? '');
  };
  const Tag = inline ? 'span' : 'div';
  return <Tag class={`bd-md${className ? ` ${className}` : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
