(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const MAX_FILE_BYTES = 35 * 1024 * 1024;
  const MAX_IMAGE_FILES = 12;
  const OCR_SCRIPT = './vendor/tesseract.min.js';
  const OCR_WORKER = './vendor/tesseract.worker.min.js';
  const OCR_CORE = './vendor/tesseract-core/';
  const OCR_LANG = './vendor/tessdata/';
  let ocrWorkerPromise = null;

  function makeError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function extension(name = '') {
    const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : '';
  }

  function normalizeLine(value = '') {
    return String(value)
      .replace(/\u00ad/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/[×✕]/g, 'x')
      .replace(/[“”]/g, '"')
      .replace(/[’`]/g, "'")
      .replace(/\\(?=\d)/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleFromFileName(fileName = '') {
    const base = String(fileName)
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return base || 'Scheda importata';
  }

  function decodeEntities(value = '') {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = String(value);
      return textarea.value;
    }
    return String(value)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  }

  function readAsArrayBuffer(file) {
    if (typeof file?.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(makeError('FILE_READ', 'Non riesco a leggere il file selezionato.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function readAsText(file) {
    if (typeof file?.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(makeError('FILE_READ', 'Non riesco a leggere il file selezionato.'));
      reader.readAsText(file);
    });
  }

  function splitDelimitedLine(line) {
    const value = String(line || '').trim();
    if (!value) return [];
    const delimiter = value.includes('\t') ? '\t' : value.includes('|') ? '|' : value.includes(';') ? ';' : '';
    if (!delimiter) return [normalizeLine(value)];
    return value.split(delimiter).map(normalizeLine).filter(Boolean);
  }

  function isDayHeading(value = '') {
    return /^(?:giorno|day|allenamento|workout|sessione|seduta)\b/i.test(normalizeLine(value));
  }

  function isPrescriptionOnly(value = '') {
    const text = normalizeLine(value).replace(/\\/g, '/');
    return /^(?:\d{1,2}\s*x\s*(?:\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento)(?:\s*\+\s*\d{1,2}\s*(?:drop(?:\s*set)?|rest\s*pause|rp|bo|back\s*[- ]?off)(?:\s+\d{1,3}(?:\s*[-/]\s*\d{1,3})?)?)?|\d{1,3}(?:\s*[/]\s*\d{1,3}){2,}|\d{1,2}\s*\+\s*(?:bo|drop|rp))$/i.test(text);
  }

  function isTechniqueOnly(value = '') {
    return /^(?:tut|tempo|rir|rpe|recupero|rest|superserie|superset|circuito)\b/i.test(normalizeLine(value));
  }

  function prepareRows(rows) {
    const source = (rows || []).map(row => (Array.isArray(row) ? row : splitDelimitedLine(row)).map(normalizeLine).filter(Boolean)).filter(row => row.length);
    const prepared = [];
    for (let index = 0; index < source.length; index += 1) {
      const row = source[index];
      if (row.length === 1 && !isDayHeading(row[0]) && !isPrescriptionOnly(row[0]) && !isTechniqueOnly(row[0])) {
        const next = source[index + 1];
        if (next?.length === 1 && isPrescriptionOnly(next[0])) {
          prepared.push([`${row[0]} ${next[0]}`]);
          index += 1;
          continue;
        }
      }
      prepared.push(row);
    }
    return prepared;
  }

  function rowsToPage(rows, pageNumber = 1, pageName = '') {
    const cleanRows = prepareRows(rows);
    const maxColumns = Math.max(1, ...cleanRows.map(row => row.length));
    const width = Math.max(600, maxColumns * 260);
    const lineHeight = 24;
    const lines = cleanRows.map((row, lineIndex) => {
      const columnWidth = width / Math.max(1, maxColumns);
      const cells = row.map((cell, cellIndex) => ({
        text: normalizeLine(cell),
        x: cellIndex * columnWidth + 10,
        xEnd: (cellIndex + 1) * columnWidth - 10,
      })).filter(cell => cell.text);
      return {
        pageNumber,
        lineNumber: lineIndex + 1,
        y: Math.max(0, (cleanRows.length - lineIndex) * lineHeight),
        height: 14,
        text: cells.map(cell => cell.text).join(' | '),
        cells,
      };
    }).filter(line => line.text);
    if (pageName) {
      lines.unshift({
        pageNumber,
        lineNumber: 0,
        y: (cleanRows.length + 2) * lineHeight,
        height: 16,
        text: normalizeLine(pageName),
        cells: [{ text: normalizeLine(pageName), x: 10, xEnd: width - 10 }],
      });
    }
    return { pageNumber, width, height: Math.max(800, (lines.length + 4) * lineHeight), lines };
  }

  function pairVerticalSpatialLines(pages) {
    return (pages || []).map(page => {
      const source = Array.isArray(page?.lines) ? page.lines : [];
      const lines = [];
      for (let index = 0; index < source.length; index += 1) {
        const current = source[index];
        const next = source[index + 1];
        const currentCells = Array.isArray(current?.cells) ? current.cells : [];
        const nextCells = Array.isArray(next?.cells) ? next.cells : [];
        const currentText = normalizeLine(current?.text);
        const nextText = normalizeLine(next?.text);
        const sameColumn = currentCells.length === 1 && nextCells.length === 1
          && Math.abs((Number(currentCells[0]?.x) || 0) - (Number(nextCells[0]?.x) || 0)) <= Math.max(70, Number(current?.height || 18) * 4);
        if (sameColumn
          && currentText
          && !isDayHeading(currentText)
          && !isPrescriptionOnly(currentText)
          && !isTechniqueOnly(currentText)
          && isPrescriptionOnly(nextText)) {
          const x = Math.min(Number(currentCells[0].x) || 0, Number(nextCells[0].x) || 0);
          const xEnd = Math.max(Number(currentCells[0].xEnd) || x, Number(nextCells[0].xEnd) || x);
          const text = normalizeLine(`${currentText} ${nextText}`);
          lines.push({
            ...current,
            text,
            cells: [{ text, x, xEnd }],
          });
          index += 1;
          continue;
        }
        lines.push(current);
      }
      return { ...page, lines };
    });
  }

  function textToPages(text, fileName = 'note.txt') {
    const normalized = String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\f/g, '\n\n---PAGE---\n\n');
    const pageChunks = normalized.split(/\n\s*(?:---\s*PAGE\s*---|\[\s*PAGINA\s+\d+\s*\])\s*\n/i);
    return pageChunks.map((chunk, index) => {
      const rows = chunk.split('\n').map(splitDelimitedLine).filter(row => row.some(Boolean));
      return rowsToPage(rows, index + 1, '');
    }).filter(page => page.lines.length);
  }

  function parseWithCore(pages, fileName, sourceLabel) {
    const parser = root.ProgressivoPdfImporter;
    if (!parser?.parsePages) throw makeError('PARSER_LOAD', 'Il motore di riconoscimento non è disponibile.');
    const result = parser.parsePages(pages, fileName);
    result.plan.description = `Importata da ${sourceLabel || 'file'} “${String(fileName).slice(0, 90)}”. Controlla serie, ripetizioni e recuperi prima del primo allenamento.`;
    result.source = sourceLabel || 'file';
    return result;
  }

  async function loadZip(arrayBuffer) {
    if (!root.JSZip) throw makeError('LIBRARY_LOAD', 'Il lettore dei documenti Office non è disponibile.');
    try {
      return await root.JSZip.loadAsync(arrayBuffer);
    } catch (error) {
      throw makeError('OFFICE_READ', 'Il documento non è leggibile oppure è danneggiato.', error);
    }
  }

  async function embeddedImagesFromZip(zip, prefixes, sourceName = 'documento') {
    const allowed = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
    const paths = Object.keys(zip?.files || {})
      .filter(path => !zip.files[path]?.dir)
      .filter(path => (prefixes || []).some(prefix => path.toLowerCase().startsWith(String(prefix).toLowerCase())))
      .filter(path => allowed.has(extension(path)))
      .slice(0, MAX_IMAGE_FILES);
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff' };
    const files = [];
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const ext = extension(path);
      const bytes = await zip.file(path).async('uint8array');
      const name = `${titleFromFileName(sourceName)}-immagine-${index + 1}.${ext}`;
      if (typeof File === 'function') files.push(new File([bytes], name, { type: mime[ext] || 'application/octet-stream' }));
      else {
        const blob = new Blob([bytes], { type: mime[ext] || 'application/octet-stream' });
        try { Object.defineProperty(blob, 'name', { value: name }); } catch (_) { /* fallback */ }
        files.push(blob);
      }
    }
    return files;
  }

  async function parseOfficeWithImageFallback(pages, file, zip, mediaPrefixes, sourceLabel, options = {}) {
    try {
      if (!pages?.length || !pages.some(page => page?.lines?.length)) throw makeError('NO_TEXT', 'Il documento non contiene testo leggibile.');
      return parseWithCore(pages, file.name, sourceLabel);
    } catch (error) {
      if (!['NO_TEXT', 'NO_EXERCISES'].includes(error?.code)) throw error;
      const embedded = await embeddedImagesFromZip(zip, mediaPrefixes, file.name);
      if (!embedded.length) throw error;
      options.onProgress?.({ phase: 'ocr-loading', label: 'Il documento contiene immagini: avvio il riconoscimento testo…' });
      const result = await importImages(embedded, options);
      result.plan.name = titleFromFileName(file.name);
      result.plan.description = `Importata dalle immagini contenute in “${String(file.name).slice(0, 90)}”. Controlla serie, ripetizioni e recuperi.`;
      result.source = `${sourceLabel} con immagini OCR`;
      result.warnings = [...(result.warnings || []), `Il testo utile era contenuto come immagine nel file ${sourceLabel}.`];
      return result;
    }
  }

  function extractTextNodes(xml, tagPattern) {
    const values = [];
    const regex = new RegExp(`<${tagPattern}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagPattern}>`, 'gi');
    let match;
    while ((match = regex.exec(String(xml || '')))) {
      const value = decodeEntities(match[1].replace(/<[^>]+>/g, ''));
      if (normalizeLine(value)) values.push(normalizeLine(value));
    }
    return values;
  }

  function docxXmlToRows(xml) {
    const source = String(xml || '')
      .replace(/<w:tab\s*\/>/gi, '\t')
      .replace(/<w:br\s*\/>/gi, '\n');
    const rows = [];
    const blockRegex = /<w:(tbl|p)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>/gi;
    let block;
    while ((block = blockRegex.exec(source))) {
      if (block[1].toLowerCase() === 'tbl') {
        const rowRegex = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(block[2]))) {
          const cells = [];
          const cellRegex = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/gi;
          let cellMatch;
          while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
            const texts = extractTextNodes(cellMatch[1], 'w:t');
            const cell = normalizeLine(texts.join(' '));
            if (cell) cells.push(cell);
          }
          if (cells.length) rows.push(cells);
        }
      } else {
        const texts = extractTextNodes(block[2], 'w:t');
        const paragraph = normalizeLine(texts.join(' '));
        if (paragraph) rows.push([paragraph]);
      }
    }
    return rows;
  }

  async function importDocx(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Apertura del documento Word…' });
    const zip = await loadZip(await readAsArrayBuffer(file));
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) throw makeError('OFFICE_READ', 'Il file non sembra un documento Word DOCX valido.');
    const xml = await documentFile.async('string');
    const rows = docxXmlToRows(xml);
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento di esercizi, serie e ripetizioni…' });
    const pages = rows.length ? [rowsToPage(rows, 1, '')] : [];
    return parseOfficeWithImageFallback(pages, file, zip, ['word/media/'], 'Word', options);
  }

  function pptxSlideToRows(xml) {
    const rows = [];
    const paragraphs = String(xml || '').split(/<a:p(?:\s[^>]*)?>/i).slice(1);
    paragraphs.forEach(part => {
      const content = part.split(/<\/a:p>/i)[0] || '';
      const texts = extractTextNodes(content, 'a:t');
      const line = normalizeLine(texts.join(' '));
      if (line) rows.push([line]);
    });
    return rows;
  }

  async function importPptx(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Apertura della presentazione…' });
    const zip = await loadZip(await readAsArrayBuffer(file));
    const slidePaths = Object.keys(zip.files)
      .filter(path => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] || 0) - Number(b.match(/slide(\d+)/i)?.[1] || 0));
    if (!slidePaths.length) throw makeError('OFFICE_READ', 'Il file non sembra una presentazione PowerPoint valida.');
    const pages = [];
    for (let index = 0; index < slidePaths.length; index += 1) {
      options.onProgress?.({ phase: 'reading', label: `Lettura diapositiva ${index + 1} di ${slidePaths.length}…` });
      const xml = await zip.file(slidePaths[index]).async('string');
      const rows = pptxSlideToRows(xml);
      if (rows.length) pages.push(rowsToPage(rows, index + 1, ''));
    }
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento della scheda…' });
    return parseOfficeWithImageFallback(pages, file, zip, ['ppt/media/'], 'PowerPoint', options);
  }

  function odtXmlToRows(xml) {
    const source = String(xml || '');
    const rows = [];
    const tableRows = source.match(/<table:table-row(?:\s[^>]*)?>[\s\S]*?<\/table:table-row>/gi) || [];
    tableRows.forEach(rowXml => {
      const cells = [];
      const cellRegex = /<table:table-cell(?:\s[^>]*)?>([\s\S]*?)<\/table:table-cell>/gi;
      let cell;
      while ((cell = cellRegex.exec(rowXml))) {
        const values = extractTextNodes(cell[1], 'text:p');
        const value = normalizeLine(values.join(' '));
        if (value) cells.push(value);
      }
      if (cells.length) rows.push(cells);
    });
    const outsideTables = source.replace(/<table:table[\s\S]*?<\/table:table>/gi, '');
    extractTextNodes(outsideTables, 'text:p').forEach(value => rows.push([value]));
    return rows;
  }

  async function importOdt(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Apertura del documento OpenDocument…' });
    const zip = await loadZip(await readAsArrayBuffer(file));
    const contentFile = zip.file('content.xml');
    if (!contentFile) throw makeError('OFFICE_READ', 'Il file non sembra un documento ODT valido.');
    const rows = odtXmlToRows(await contentFile.async('string'));
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento della scheda…' });
    const pages = rows.length ? [rowsToPage(rows, 1, '')] : [];
    return parseOfficeWithImageFallback(pages, file, zip, ['Pictures/', 'pictures/'], 'OpenDocument', options);
  }

  function sharedStringsFromXml(xml) {
    const strings = [];
    const entries = String(xml || '').match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/gi) || [];
    entries.forEach(entry => strings.push(normalizeLine(extractTextNodes(entry, 't').join(' '))));
    return strings;
  }

  function columnIndex(cellRef = '') {
    const letters = String(cellRef).match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
    let value = 0;
    for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
    return Math.max(0, value - 1);
  }

  function sheetXmlToRows(xml, sharedStrings) {
    const rows = [];
    const rowEntries = String(xml || '').match(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/gi) || [];
    rowEntries.forEach(rowXml => {
      const row = [];
      const cellRegex = /<c(?:\s([^>]*))?>([\s\S]*?)<\/c>/gi;
      let cell;
      while ((cell = cellRegex.exec(rowXml))) {
        const attrs = cell[1] || '';
        const body = cell[2] || '';
        const ref = attrs.match(/\br="([^"]+)"/i)?.[1] || '';
        const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';
        const index = columnIndex(ref);
        let value = '';
        if (type === 'inlineStr') value = extractTextNodes(body, 't').join(' ');
        else {
          const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] || '';
          value = type === 's' ? sharedStrings[Number(raw)] || '' : decodeEntities(raw);
        }
        row[index] = normalizeLine(value);
      }
      if (row.some(Boolean)) rows.push(row.map(value => value || ''));
    });
    return rows;
  }

  async function importXlsx(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Apertura del foglio di calcolo…' });
    const zip = await loadZip(await readAsArrayBuffer(file));
    const sharedFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = sharedFile ? sharedStringsFromXml(await sharedFile.async('string')) : [];
    const workbookXml = zip.file('xl/workbook.xml') ? await zip.file('xl/workbook.xml').async('string') : '';
    const sheetNames = [];
    const sheetRegex = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/gi;
    let sheet;
    while ((sheet = sheetRegex.exec(workbookXml))) sheetNames.push({ name: decodeEntities(sheet[1]), relationId: sheet[2] });
    const relsXml = zip.file('xl/_rels/workbook.xml.rels') ? await zip.file('xl/_rels/workbook.xml.rels').async('string') : '';
    const relations = new Map();
    const relRegex = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/gi;
    let rel;
    while ((rel = relRegex.exec(relsXml))) relations.set(rel[1], rel[2]);
    const pages = [];
    for (let index = 0; index < sheetNames.length; index += 1) {
      const info = sheetNames[index];
      const target = relations.get(info.relationId) || `worksheets/sheet${index + 1}.xml`;
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      const sheetFile = zip.file(path);
      if (!sheetFile) continue;
      options.onProgress?.({ phase: 'reading', label: `Lettura foglio ${index + 1} di ${sheetNames.length}…` });
      const rows = sheetXmlToRows(await sheetFile.async('string'), sharedStrings);
      if (rows.length) pages.push(rowsToPage(rows, index + 1, info.name));
    }
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento della scheda…' });
    return parseOfficeWithImageFallback(pages, file, zip, ['xl/media/'], 'foglio di calcolo', options);
  }

  function csvToRows(text, ext) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
    const delimiter = ext === 'tsv' ? '\t' : (() => {
      const sample = lines.slice(0, 8).join('\n');
      const candidates = [',', ';', '\t', '|'];
      return candidates.sort((a, b) => (sample.split(b).length - sample.split(a).length))[0];
    })();
    return lines.map(line => {
      const cells = [];
      let current = '';
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
          else quoted = !quoted;
        } else if (char === delimiter && !quoted) {
          cells.push(normalizeLine(current)); current = '';
        } else current += char;
      }
      cells.push(normalizeLine(current));
      return cells;
    });
  }

  function stripRtf(text) {
    return String(text || '')
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\line\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\\'[0-9a-fA-F]{2}/g, match => {
        try { return new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(match.slice(2), 16))); }
        catch (_) { return ''; }
      })
      .replace(/\\u(-?\d+)\??/g, (_, number) => String.fromCharCode(Number(number) < 0 ? Number(number) + 65536 : Number(number)))
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\r\n?/g, '\n');
  }

  function htmlToRows(html) {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      const rows = [];
      doc.querySelectorAll('table tr').forEach(tr => {
        const cells = [...tr.querySelectorAll(':scope > th, :scope > td')].map(cell => normalizeLine(cell.textContent)).filter(Boolean);
        if (cells.length) rows.push(cells);
      });
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach(node => {
        if (node.closest('table')) return;
        const value = normalizeLine(node.textContent);
        if (value) rows.push([value]);
      });
      return rows;
    }
    return String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').split('\n').map(splitDelimitedLine).filter(row => row.length);
  }

  async function importIwork(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Apertura del documento Apple…' });
    const zip = await loadZip(await readAsArrayBuffer(file));
    const previewPath = Object.keys(zip.files).find(path => /(?:^|\/)QuickLook\/Preview\.pdf$/i.test(path) || /(?:^|\/)preview\.pdf$/i.test(path));
    if (previewPath) {
      const bytes = await zip.file(previewPath).async('uint8array');
      const previewName = `${titleFromFileName(file.name)}-anteprima.pdf`;
      const preview = typeof File === 'function'
        ? new File([bytes], previewName, { type: 'application/pdf' })
        : new Blob([bytes], { type: 'application/pdf' });
      try { if (!preview.name) Object.defineProperty(preview, 'name', { value: previewName }); } catch (_) { /* fallback */ }
      const result = await importPdf(preview, options);
      result.plan.name = titleFromFileName(file.name);
      result.plan.description = `Importata dall’anteprima contenuta in “${String(file.name).slice(0, 90)}”. Controlla serie, ripetizioni e recuperi.`;
      result.source = 'documento Apple iWork';
      return result;
    }
    const embedded = await embeddedImagesFromZip(zip, ['QuickLook/', 'quicklook/', 'Data/', 'data/'], file.name);
    if (!embedded.length) throw makeError('UNSUPPORTED_FILE', 'Il documento Apple non contiene un’anteprima leggibile. Esportalo come PDF, Word o Excel e riprova.');
    const result = await importImages(embedded, options);
    result.plan.name = titleFromFileName(file.name);
    result.plan.description = `Importata dalle anteprime grafiche contenute in “${String(file.name).slice(0, 90)}”.`;
    result.source = 'documento Apple iWork con OCR';
    return result;
  }

  async function importTextLike(file, options = {}) {
    options.onProgress?.({ phase: 'reading', label: 'Lettura del testo…' });
    const ext = extension(file.name);
    let text = await readAsText(file);
    let pages;
    if (ext === 'csv' || ext === 'tsv') pages = [rowsToPage(csvToRows(text, ext), 1, '')];
    else if (ext === 'rtf') pages = textToPages(stripRtf(text), file.name);
    else if (ext === 'html' || ext === 'htm') pages = [rowsToPage(htmlToRows(text), 1, '')];
    else pages = textToPages(text, file.name);
    if (!pages.length || !pages.some(page => page.lines.length)) throw makeError('NO_TEXT', 'Il file non contiene testo leggibile.');
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento della scheda…' });
    return parseWithCore(pages, file.name, 'testo o note');
  }

  function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(makeError('OCR_UNAVAILABLE', 'Il riconoscimento delle immagini richiede un browser.'));
      const absolute = new URL(src, document.baseURI).href;
      const existing = [...document.scripts].find(script => script.src === absolute);
      if (existing) {
        if (root.Tesseract?.createWorker) return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(makeError('OCR_UNAVAILABLE', 'Impossibile caricare il lettore delle immagini.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => reject(makeError('OCR_UNAVAILABLE', 'Impossibile caricare il lettore delle immagini. Controlla la connessione e riprova.'));
      document.head.appendChild(script);
    });
  }

  async function getOcrWorker(options = {}) {
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = (async () => {
        if (!root.Tesseract?.createWorker) await loadClassicScript(OCR_SCRIPT);
        if (!root.Tesseract?.createWorker) throw makeError('OCR_UNAVAILABLE', 'Il motore OCR non è disponibile.');
        const base = typeof document !== 'undefined' ? document.baseURI : '';
        const resolvePath = value => { try { return base && !/^about:/i.test(base) ? new URL(value, base).href : value; } catch (_) { return value; } };
        return root.Tesseract.createWorker(['ita', 'eng'], 1, {
          workerPath: resolvePath(OCR_WORKER),
          corePath: resolvePath(OCR_CORE),
          langPath: resolvePath(OCR_LANG),
          logger: message => options.onOcrProgress?.(message),
          errorHandler: error => console.warn('OCR worker', error),
        });
      })().catch(error => {
        ocrWorkerPromise = null;
        throw error;
      });
    }
    return ocrWorkerPromise;
  }

  async function prepareImageForOcr(file) {
    if (typeof document === 'undefined') return file;
    let bitmap = null;
    let objectUrl = '';
    try {
      if (typeof createImageBitmap === 'function') {
        try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (_) { bitmap = await createImageBitmap(file); }
      }
      if (!bitmap) {
        objectUrl = URL.createObjectURL(file);
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(makeError('OCR_FAILED', 'Il formato della foto non può essere aperto dal browser.'));
          image.src = objectUrl;
        });
      }
      const sourceWidth = Number(bitmap.width || bitmap.naturalWidth || 0);
      const sourceHeight = Number(bitmap.height || bitmap.naturalHeight || 0);
      if (!sourceWidth || !sourceHeight) return file;
      const maxSide = 2600;
      const minSide = 1350;
      let scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      if (Math.max(sourceWidth, sourceHeight) < minSide) scale = Math.min(2, minSide / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!context) return file;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.96));
      return blob || file;
    } catch (error) {
      console.warn('Preparazione immagine OCR non riuscita', error);
      return file;
    } finally {
      try { bitmap?.close?.(); } catch (_) { /* nessuna azione */ }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function tsvToPage(tsv, pageNumber, title = '') {
    const linesMap = new Map();
    const rows = String(tsv || '').split(/\r?\n/);
    let pageWidth = 1200;
    let pageHeight = 1600;
    rows.slice(1).forEach(row => {
      const cells = row.split('\t');
      if (cells.length < 12 || cells[0] !== '5') return;
      const pageNum = Number(cells[1]) || pageNumber;
      const block = cells[2], par = cells[3], line = cells[4];
      const left = Number(cells[6]) || 0;
      const top = Number(cells[7]) || 0;
      const width = Number(cells[8]) || 0;
      const height = Number(cells[9]) || 0;
      const confidence = Number(cells[10]) || 0;
      const text = normalizeLine(cells.slice(11).join('\t'));
      if (!text || confidence < 20) return;
      const key = `${pageNum}:${block}:${par}:${line}`;
      if (!linesMap.has(key)) linesMap.set(key, []);
      linesMap.get(key).push({ text, x: left, xEnd: left + width, top, height });
      pageWidth = Math.max(pageWidth, left + width + 20);
      pageHeight = Math.max(pageHeight, top + height + 20);
    });
    const grouped = [...linesMap.values()].sort((a, b) => (a[0]?.top || 0) - (b[0]?.top || 0));
    const lines = grouped.map((words, index) => {
      const sorted = words.sort((a, b) => a.x - b.x);
      const top = Math.min(...sorted.map(word => word.top));
      const typicalHeight = (() => {
        const values = sorted.map(word => Number(word.height) || 0).filter(Boolean).sort((a, b) => a - b);
        if (!values.length) return 18;
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      })();
      // Tesseract restituisce una cella per ogni parola. Raggruppiamo le parole
      // vicine, altrimenti il parser tabellare potrebbe scambiare "LAT" e
      // "MACHINE" o "2x8-10" e "+ 1 DROP" per colonne/esercizi distinti.
      // Manteniamo invece separati i veri blocchi/colonne quando il vuoto è ampio.
      const gapThreshold = Math.max(30, typicalHeight * 2.25);
      const cells = [];
      sorted.forEach(word => {
        const previous = cells[cells.length - 1];
        const gap = previous ? word.x - previous.xEnd : 0;
        if (!previous || gap > gapThreshold) {
          cells.push({ ...word });
        } else {
          previous.text = normalizeLine(`${previous.text} ${word.text}`);
          previous.xEnd = Math.max(previous.xEnd, word.xEnd);
          previous.top = Math.min(previous.top, word.top);
          previous.height = Math.max(previous.height, word.height);
        }
      });
      return {
        pageNumber,
        lineNumber: index + 1,
        y: pageHeight - top,
        height: Math.max(...sorted.map(word => word.height)),
        text: cells.map(cell => cell.text).join(' | '),
        cells,
      };
    });
    if (title) lines.unshift({ pageNumber, lineNumber: 0, y: pageHeight + 20, height: 18, text: title, cells: [{ text: title, x: 0, xEnd: pageWidth }] });
    return { pageNumber, width: pageWidth, height: pageHeight, lines };
  }

  async function importImages(files, options = {}) {
    const list = [...files];
    if (!list.length) throw makeError('NO_FILE', 'Nessuna immagine selezionata.');
    if (list.length > MAX_IMAGE_FILES) throw makeError('TOO_MANY_IMAGES', `Puoi importare fino a ${MAX_IMAGE_FILES} immagini alla volta.`);
    options.onProgress?.({ phase: 'ocr-loading', label: 'Preparazione del riconoscimento testo…' });
    const worker = await getOcrWorker({
      onOcrProgress: message => {
        if (!message) return;
        const percent = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : null;
        const label = percent === null ? 'Analisi dell’immagine…' : `Riconoscimento testo ${percent}%…`;
        options.onProgress?.({ phase: 'ocr', label, ocr: message });
      },
    });
    const pages = [];
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      options.onProgress?.({ phase: 'ocr', label: `Analisi foto ${index + 1} di ${list.length}…` });
      let result;
      try {
        const preparedImage = await prepareImageForOcr(file);
        result = await worker.recognize(preparedImage, { rotateAuto: true }, { text: true, tsv: true, blocks: true });
      } catch (error) {
        throw makeError('OCR_FAILED', 'Non riesco a leggere il testo presente nella foto.', error);
      }
      const data = result?.data || {};
      let page = data.tsv ? tsvToPage(data.tsv, index + 1, '') : null;
      if (!page?.lines?.length && data.text) page = textToPages(data.text, file.name)[0];
      if (page?.lines?.length) pages.push(page);
    }
    if (!pages.length) throw makeError('NO_TEXT', 'Non è stato trovato testo leggibile nelle immagini. Usa foto nitide, dritte e ben illuminate.');
    options.onProgress?.({ phase: 'parsing', label: 'Ricostruzione di esercizi, serie e ripetizioni…' });
    const result = parseWithCore(pairVerticalSpatialLines(pages), list[0]?.name || 'foto-scheda.jpg', 'foto con OCR');
    result.warnings = [...(result.warnings || []), 'Il testo è stato letto da una foto: controlla con particolare attenzione numeri, barre e sigle come BO, DROP e RP.'];
    return result;
  }

  async function importScannedPdf(file, options = {}) {
    const pdfjsLib = root.pdfjsLib || root['pdfjs-dist/build/pdf'];
    if (!pdfjsLib?.getDocument) throw makeError('PARSER_LOAD', 'Il lettore PDF non è disponibile.');
    if (typeof document !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', document.baseURI).href;
    }
    options.onProgress?.({ phase: 'ocr-loading', label: 'Il PDF è una scansione: preparo il riconoscimento delle pagine…' });
    const worker = await getOcrWorker({
      onOcrProgress: message => {
        const percent = Number.isFinite(message?.progress) ? Math.round(message.progress * 100) : null;
        options.onProgress?.({ phase: 'ocr', label: percent === null ? 'Lettura della scansione…' : `Lettura della scansione ${percent}%…` });
      },
    });
    let loadingTask;
    try {
      const buffer = await readAsArrayBuffer(file);
      loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
      const pdf = await loadingTask.promise;
      const maxOcrPages = 30;
      if (pdf.numPages > maxOcrPages) throw makeError('TOO_MANY_PAGES', `Il PDF scansionato contiene ${pdf.numPages} pagine; per l’OCR il limite è ${maxOcrPages}.`);
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        options.onProgress?.({ phase: 'ocr', label: `OCR pagina ${pageNumber} di ${pdf.numPages}…` });
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2.6, Math.max(1.5, 2200 / Math.max(baseViewport.width, baseViewport.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.96));
        if (!blob) continue;
        const result = await worker.recognize(blob, { rotateAuto: true }, { text: true, tsv: true, blocks: true });
        const data = result?.data || {};
        let parsedPage = data.tsv ? tsvToPage(data.tsv, pageNumber, '') : null;
        if (!parsedPage?.lines?.length && data.text) parsedPage = textToPages(data.text, file.name)[0];
        if (parsedPage?.lines?.length) pages.push(parsedPage);
        page.cleanup?.();
      }
      await pdf.destroy?.();
      if (!pages.length) throw makeError('NO_TEXT', 'Non è stato possibile leggere il testo della scansione.');
      const result = parseWithCore(pairVerticalSpatialLines(pages), file.name, 'PDF scansionato con OCR');
      result.warnings = [...(result.warnings || []), 'Il PDF era composto da immagini: controlla attentamente numeri, barre e sigle riconosciute tramite OCR.'];
      return result;
    } catch (error) {
      if (error?.code) throw error;
      throw makeError('OCR_FAILED', 'Non riesco a leggere le pagine scansionate del PDF.', error);
    } finally {
      try { await loadingTask?.destroy?.(); } catch (_) { /* nessuna azione */ }
    }
  }

  async function importPdf(file, options = {}) {
    const importer = root.ProgressivoPdfImporter;
    if (!importer?.importPdf) throw makeError('PARSER_LOAD', 'Il lettore PDF non è disponibile.');
    try {
      return await importer.importPdf(file, options);
    } catch (error) {
      if (error?.code !== 'NO_TEXT') throw error;
      return importScannedPdf(file, options);
    }
  }

  function supportedKind(file) {
    const ext = extension(file?.name);
    const type = String(file?.type || '').toLowerCase();
    if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
    if (/^image\//.test(type) || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif'].includes(ext)) return 'image';
    if (ext === 'docx') return 'docx';
    if (ext === 'pptx') return 'pptx';
    if (['pages', 'numbers', 'key'].includes(ext)) return 'iwork';
    if (ext === 'odt') return 'odt';
    if (['xlsx', 'xlsm', 'xltx', 'ods'].includes(ext)) return ext === 'ods' ? 'ods' : 'xlsx';
    if (['txt', 'md', 'csv', 'tsv', 'rtf', 'html', 'htm', 'log'].includes(ext) || /^text\//.test(type)) return 'text';
    if (['doc', 'xls', 'ppt'].includes(ext)) return 'legacy';
    return 'unknown';
  }

  async function importFiles(inputFiles, options = {}) {
    const files = [...(inputFiles || [])].filter(Boolean);
    if (!files.length) throw makeError('NO_FILE', 'Nessun file selezionato.');
    files.forEach(file => {
      if (Number(file.size) > MAX_FILE_BYTES) throw makeError('FILE_TOO_LARGE', `“${file.name}” supera il limite di 35 MB.`);
    });
    const kinds = files.map(supportedKind);
    if (files.length > 1 && kinds.some(kind => kind !== 'image')) throw makeError('MULTI_FILE', 'Puoi selezionare più file contemporaneamente solo quando sono tutte fotografie della stessa scheda.');
    if (kinds.every(kind => kind === 'image')) return importImages(files, options);
    const file = files[0];
    const kind = kinds[0];
    if (kind === 'pdf') return importPdf(file, options);
    if (kind === 'docx') return importDocx(file, options);
    if (kind === 'pptx') return importPptx(file, options);
    if (kind === 'iwork') return importIwork(file, options);
    if (kind === 'odt') return importOdt(file, options);
    if (kind === 'xlsx') return importXlsx(file, options);
    if (kind === 'ods') return importOdt(file, options);
    if (kind === 'text') return importTextLike(file, options);
    if (kind === 'legacy') throw makeError('LEGACY_OFFICE', 'I vecchi formati .doc, .xls e .ppt non possono essere letti in modo affidabile nel browser. Aprili e salvali come DOCX, XLSX, PPTX o PDF.');
    try {
      return await importTextLike(file, options);
    } catch (_) {
      throw makeError('UNSUPPORTED_FILE', 'Formato non riconosciuto. Usa PDF, immagini, DOCX, XLSX, PPTX, ODT, TXT, Note, Markdown, CSV, TSV, RTF o HTML.');
    }
  }

  async function importText(text, name = 'Note incollate.txt', options = {}) {
    if (!String(text || '').trim()) throw makeError('NO_TEXT', 'Incolla prima il testo della scheda.');
    options.onProgress?.({ phase: 'parsing', label: 'Riconoscimento della scheda incollata…' });
    return parseWithCore(textToPages(text, name), name, 'testo incollato');
  }

  root.VantaUniversalImporter = {
    importFiles,
    importText,
    textToPages,
    rowsToPage,
    supportedKind,
    limits: { maxBytes: MAX_FILE_BYTES, maxImages: MAX_IMAGE_FILES },
    supportedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'docx', 'xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'pages', 'numbers', 'key', 'txt', 'md', 'csv', 'tsv', 'rtf', 'html', 'htm', 'eml', 'log', 'xml'],
  };
})();
