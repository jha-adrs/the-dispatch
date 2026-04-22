const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:]/g;

export function validate(md) {
  if (typeof md !== 'string' || md.length === 0) {
    return { ok: false, reason: 'markdown body is empty' };
  }
  const firstLine = md.split('\n', 1)[0];
  if (!/^# +\S/.test(firstLine)) {
    return { ok: false, reason: "markdown must start with '# <title>' on the first line" };
  }
  if (!/\*\*TL;DR:\*\*/.test(md)) {
    return { ok: false, reason: "markdown must contain a '**TL;DR:**' marker" };
  }
  return { ok: true };
}

export function extractTitle(md) {
  const m = md.match(/^# +(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

export function extractTldr(md) {
  const m = md.match(/\*\*TL;DR:\*\*\s*([\s\S]*?)(?:\n\n|\n#|$)/);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

export function extractSources(md) {
  const found = new Set();
  for (const match of md.matchAll(URL_RE)) found.add(match[0]);
  return [...found];
}

export function wordCount(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}
