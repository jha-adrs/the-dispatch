import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 60;
const LINE_H = 14;
const MAX_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.067, 0.067, 0.067);
const RED = rgb(0.72, 0.16, 0.047);
const MUTED = rgb(0.42, 0.39, 0.34);

export async function renderMarkdownToPdf(markdown, { title }) {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const state = { page: null, y: 0 };

  const newPage = () => {
    state.page = doc.addPage([PAGE_W, PAGE_H]);
    state.y = PAGE_H - MARGIN;
  };

  const ensureRoom = (need) => {
    if (!state.page || state.y - need < MARGIN) newPage();
  };

  const drawLine = (text, { font = serif, size = 11, color = INK, indent = 0 } = {}) => {
    ensureRoom(LINE_H);
    state.page.drawText(text, {
      x: MARGIN + indent,
      y: state.y - size,
      size,
      font,
      color,
    });
    state.y -= LINE_H;
  };

  const drawWrapped = (text, opts = {}) => {
    const { font = serif, size = 11, color = INK, indent = 0 } = opts;
    if (!text) return;
    const width = MAX_W - indent;
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w > width && line) {
        drawLine(line, { font, size, color, indent });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) drawLine(line, { font, size, color, indent });
  };

  const blank = (h = LINE_H / 2) => {
    ensureRoom(h);
    state.y -= h;
  };

  newPage();

  if (title) {
    drawWrapped(title, { font: serifBold, size: 20 });
    blank(LINE_H);
  }

  const lines = markdown.split('\n');
  let inCode = false;
  let codeBuffer = [];

  const flushCode = () => {
    for (const cl of codeBuffer) drawLine(cl, { font: mono, size: 9, color: MUTED, indent: 8 });
    codeBuffer = [];
  };

  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (inCode) {
        flushCode();
        blank();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }
    const line = raw.replace(/\s+$/, '');

    if (/^# /.test(line)) {
      blank();
      drawWrapped(line.slice(2), { font: serifBold, size: 18 });
      blank();
    } else if (/^## /.test(line)) {
      blank();
      drawWrapped(line.slice(3), { font: serifBold, size: 14, color: RED });
      blank();
    } else if (/^### /.test(line)) {
      blank();
      drawWrapped(line.slice(4), { font: serifBold, size: 12 });
    } else if (/^> /.test(line)) {
      drawWrapped(line.slice(2), { font: serifItalic, size: 11, color: MUTED, indent: 12 });
    } else if (/^[-*] /.test(line)) {
      drawWrapped(`• ${line.slice(2)}`, { indent: 12 });
    } else if (/^\d+\.\s/.test(line)) {
      drawWrapped(line, { indent: 12 });
    } else if (line === '') {
      blank();
    } else {
      drawWrapped(stripInline(line));
    }
  }
  if (inCode) flushCode();

  return await doc.save();
}

function stripInline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}
