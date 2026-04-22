import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function createArchive(archiveDir) {
  mkdirSync(archiveDir, { recursive: true });

  const pathFor = (id, ext) => join(archiveDir, `${id}.${ext}`);

  return {
    dir: archiveDir,

    writeReport(id, markdown, pdfBytes) {
      writeFileSync(pathFor(id, 'md'), markdown, 'utf8');
      writeFileSync(pathFor(id, 'pdf'), pdfBytes);
    },

    readMarkdown(id) {
      const p = pathFor(id, 'md');
      if (!existsSync(p)) return null;
      return readFileSync(p, 'utf8');
    },

    readPdf(id) {
      const p = pathFor(id, 'pdf');
      if (!existsSync(p)) return null;
      return readFileSync(p);
    },

    pathFor,
  };
}
