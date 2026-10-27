// Tiny syntax highlighter for the generated Java/Python. Returns escaped HTML.

const JAVA_KEYWORDS = new Set(
  'abstract boolean break case catch class continue default do double else extends final finally for if implements import instanceof int interface long new null package private protected public return static super switch this throw throws try void while true false var'.split(' '),
);
const PY_KEYWORDS = new Set(
  'and as assert break class continue def del elif else except False finally for from global if import in is lambda None not or pass raise return True try while with yield self'.split(' '),
);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Lang = 'java' | 'python' | 'text';

export function languageOf(path: string): Lang {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.py')) return 'python';
  return 'text';
}

export function highlight(code: string, lang: Lang): string {
  if (lang === 'text') return escapeHtml(code);
  const keywords = lang === 'java' ? JAVA_KEYWORDS : PY_KEYWORDS;
  const token =
    lang === 'java'
      ? /("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|@\w+|\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b|\b[A-Za-z_]\w*\b)/g
      : /("""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:\\.|[^"\\\n])*"|f?'(?:\\.|[^'\\\n])*'|#[^\n]*|@\w+|\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(token)) {
    const t = m[0];
    const i = m.index ?? 0;
    out += escapeHtml(code.slice(last, i));
    last = i + t.length;
    let cls: string | null = null;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('#')) cls = 'c';
    else if (t.startsWith('"') || t.startsWith("'") || t.startsWith('f"') || t.startsWith("f'")) cls = 's';
    else if (t.startsWith('@')) cls = 'a';
    else if (/^\d/.test(t)) cls = 'n';
    else if (keywords.has(t)) cls = 'k';
    else if (/^[A-Z][A-Za-z0-9]*$/.test(t) && /[a-z]/.test(t)) cls = 't';
    out += cls ? `<span class="tok-${cls}">${escapeHtml(t)}</span>` : escapeHtml(t);
  }
  out += escapeHtml(code.slice(last));
  return out;
}
