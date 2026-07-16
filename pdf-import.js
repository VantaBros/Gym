(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_PAGES = 60;
  let pdfJsPromise = null;

  const MUSCLE_LABELS = new Map([
    ['petto', 'Petto'],
    ['petto alto', 'Petto alto'],
    ['chest', 'Petto'],
    ['schiena', 'Schiena'],
    ['dorso', 'Schiena'],
    ['back', 'Schiena'],
    ['gambe', 'Gambe'],
    ['gamba', 'Gambe'],
    ['legs', 'Gambe'],
    ['quadricipiti', 'Gambe'],
    ['quad', 'Gambe'],
    ['spalle', 'Spalle'],
    ['spalla', 'Spalle'],
    ['deltoidi posteriori', 'Deltoidi posteriori'],
    ['deltoidi post', 'Deltoidi posteriori'],
    ['deltoidi post.', 'Deltoidi posteriori'],
    ['shoulders', 'Spalle'],
    ['bicipiti', 'Bicipiti'],
    ['bicipite', 'Bicipiti'],
    ['biceps', 'Bicipiti'],
    ['tricipiti', 'Tricipiti'],
    ['tricipite', 'Tricipiti'],
    ['triceps', 'Tricipiti'],
    ['glutei', 'Glutei'],
    ['gluteo', 'Glutei'],
    ['glutes', 'Glutei'],
    ['femorali', 'Femorali'],
    ['hamstrings', 'Femorali'],
    ['polpacci', 'Polpacci'],
    ['calves', 'Polpacci'],
    ['addome', 'Core'],
    ['addominali', 'Core'],
    ['core', 'Core'],
    ['braccia', 'Braccia'],
    ['arms', 'Braccia'],
  ]);

  const GENERIC_TITLES = new Set([
    'scheda allenamento',
    'scheda di allenamento',
    'programma allenamento',
    'programma di allenamento',
    'workout plan',
    'training plan',
    'allenamento',
    'workout',
  ]);

  const NON_EXERCISE_LINES = new Set([
    'esercizio', 'esercizi', 'exercise', 'exercises',
    'serie', 'series', 'set', 'sets',
    'ripetizioni', 'ripetizione', 'rip', 'reps',
    'recupero', 'rest', 'pausa',
    'carico', 'peso', 'weight',
    'note', 'notes', 'tempo', 'durata',
    'riscaldamento', 'warm up', 'warmup',
    'defaticamento', 'cool down', 'cooldown',
    'superset', 'super set', 'circuito', 'circuit',
    'nome', 'cognome', 'data', 'date',
    'istruttore', 'trainer', 'coach',
  ]);

  const EXERCISE_KEYWORDS = [
    'squat', 'pressa', 'leg press', 'leg extension', 'leg curl', 'affondi', 'lunge',
    'panca', 'bench', 'chest press', 'croci', 'fly', 'push up', 'piegamenti',
    'stacco', 'deadlift', 'rematore', 'row', 'lat machine', 'pulldown', 'trazioni', 'pull up',
    'military', 'shoulder press', 'lento avanti', 'alzate laterali', 'alzate frontali',
    'curl', 'hammer curl', 'pushdown', 'french press', 'skull crusher', 'dip',
    'hip thrust', 'glute bridge', 'abductor', 'adductor', 'calf', 'polpacci',
    'plank', 'crunch', 'sit up', 'ab wheel', 'russian twist',
    'tapis roulant', 'treadmill', 'cyclette', 'bike', 'ellittica', 'rowing machine',
    'pulley', 'tirate al mento', 'face pull', 'shrug', 'scrollate',
  ];

  function makeError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function canonical(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[“”«»]/g, '"')
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeLine(value = '') {
    return String(value)
      .replace(/\u00ad/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/[×✕]/g, 'x')
      .replace(/[“”]/g, '"')
      .replace(/[’`]/g, "'")
      .replace(/^\s*[•●▪◦]\s*/, '- ')
      .replace(/\s*\|\s*/g, ' | ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleFromFileName(fileName = '') {
    const base = String(fileName).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return 'Scheda importata';
    return base
      .split(' ')
      .map(word => word.length > 3 ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
      .join(' ')
      .slice(0, 60);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function reconstructPageLines(items, pageNumber) {
    const entries = (items || [])
      .filter(item => item && typeof item.str === 'string' && item.str.trim())
      .map(item => {
        const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const height = Math.max(1, Math.abs(Number(item.height) || Number(transform[3]) || 10));
        return {
          text: item.str.replace(/\s+/g, ' ').trim(),
          x: Number(transform[4]) || 0,
          y: Number(transform[5]) || 0,
          width: Math.max(0, Number(item.width) || 0),
          height,
        };
      });

    if (!entries.length) return [];

    const typicalHeight = median(entries.map(item => item.height).filter(value => value > 0)) || 10;
    const tolerance = clamp(typicalHeight * 0.34, 1.6, 5.5);
    entries.sort((a, b) => Math.abs(b.y - a.y) > tolerance ? b.y - a.y : a.x - b.x);

    const groups = [];
    entries.forEach(entry => {
      let group = null;
      for (let index = groups.length - 1; index >= Math.max(0, groups.length - 5); index -= 1) {
        if (Math.abs(groups[index].y - entry.y) <= tolerance) {
          group = groups[index];
          break;
        }
      }
      if (!group) {
        group = { y: entry.y, height: entry.height, items: [] };
        groups.push(group);
      }
      group.items.push(entry);
      group.y = (group.y * (group.items.length - 1) + entry.y) / group.items.length;
      group.height = Math.max(group.height, entry.height);
    });

    groups.sort((a, b) => b.y - a.y);
    return groups.map((group, lineIndex) => {
      const lineItems = group.items.sort((a, b) => a.x - b.x);
      let text = '';
      let previous = null;
      const cells = [];
      let currentCell = null;
      lineItems.forEach(item => {
        if (!item.text) return;
        if (!previous) {
          text = item.text;
          currentCell = { text: item.text, x: item.x, xEnd: item.x + item.width };
          cells.push(currentCell);
          previous = item;
          return;
        }
        const previousEnd = previous.x + previous.width;
        const gap = item.x - previousEnd;
        // Nei PDF tabellari i bordi delle colonne possono avere spazi di soli
        // 10-13 punti. Una soglia troppo alta unisce "Ripetizioni" e "Note"
        // e rende impossibile riconoscere schemi come 2 + BO.
        const largeGap = Math.max(8.5, typicalHeight * 0.9);
        const currentStartsWithPunctuation = /^[,.;:!?%)\]]/.test(item.text);
        const previousEndsWithJoiner = /[(\[\/'-]$/.test(text);
        let separator = '';
        if (gap > largeGap) {
          separator = ' | ';
          currentCell = { text: item.text, x: item.x, xEnd: item.x + item.width };
          cells.push(currentCell);
        } else {
          if (gap > 0.35 && !currentStartsWithPunctuation && !previousEndsWithJoiner) separator = ' ';
          if (currentCell) {
            currentCell.text += `${separator}${item.text}`;
            currentCell.xEnd = Math.max(currentCell.xEnd, item.x + item.width);
          }
        }
        text += `${separator}${item.text}`;
        previous = item;
      });
      return {
        pageNumber,
        lineNumber: lineIndex + 1,
        y: group.y,
        height: group.height,
        text: normalizeLine(text),
        cells: cells.map(cell => ({
          text: normalizeLine(cell.text),
          x: cell.x,
          xEnd: cell.xEnd,
        })).filter(cell => cell.text),
      };
    }).filter(line => line.text);
  }

  function isPageNumberLine(text) {
    const value = canonical(text);
    return /^(?:pag(?:ina)?\s*)?\d{1,3}(?:\s*(?:\/|di)\s*\d{1,3})?$/.test(value)
      || /^page\s+\d{1,3}(?:\s+of\s+\d{1,3})?$/.test(value);
  }

  function isColumnHeader(text) {
    const value = canonical(text).replace(/[|:]/g, ' ');
    const words = value.split(/\s+/).filter(Boolean);
    const labels = ['esercizio', 'esercizi', 'exercise', 'exercises', 'serie', 'series', 'set', 'sets', 'ripetizioni', 'rip', 'reps', 'recupero', 'rest', 'pausa', 'peso', 'carico', 'weight', 'note', 'notes'];
    const hits = labels.filter(label => words.includes(label)).length;
    if (/\d/.test(value)) return NON_EXERCISE_LINES.has(value);
    return hits >= 2 || NON_EXERCISE_LINES.has(value);
  }

  function isGenericMetadata(text) {
    const value = canonical(text).replace(/[:|]+$/g, '').trim();
    if (!value || isPageNumberLine(value) || isColumnHeader(value)) return true;
    if (/^(?:nome|name|atleta|athlete|cliente|client|data|date|settimana|week|mese|month|coach|trainer|istruttore)\s*[:=]/.test(value)) return true;
    if (/^(?:pagina|page)\s+(?:allenamento|workout|training)(?:\s+\d{1,3})?$/.test(value)) return true;
    if (/^(?:tel|telefono|email|www\.|https?:\/\/)/.test(value)) return true;
    if (/^©|copyright|tutti i diritti|all rights reserved/.test(value)) return true;
    return false;
  }

  function detectDayHeading(text) {
    const original = normalizeLine(text).replace(/\s*[:|]\s*$/, '').trim();
    const value = canonical(original);
    if (!value || value.length > 80 || /\d+\s*x\s*\d+/i.test(value)) return null;

    if (/^(?:giorno|day|allenamento|workout|sessione|session|seduta)\b/.test(value)) {
      if (/^(?:allenamento|workout|sessione|session|seduta)$/.test(value)) return null;
      return original.slice(0, 80);
    }

    if (/^(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)(?:\s*[-:]\s*.*)?$/.test(value)) {
      return original.slice(0, 80);
    }

    if (/^(?:push|pull|legs?|upper|lower|full body|total body)(?:\s+(?:[a-f]|\d+|[ivx]+))?(?:\s*[-:]\s*.*)?$/.test(value)) {
      return original.slice(0, 80);
    }

    if (/^[a-f0-9ivx]+\s*[-:]\s*(?:push|pull|legs?|upper|lower|full body|total body|petto|schiena|gambe|spalle|braccia)\b/.test(value)) {
      return original.slice(0, 80);
    }

    const muscleTokens = [...MUSCLE_LABELS.keys()].filter(label => new RegExp(`(?:^|\\b)${label}(?:\\b|$)`).test(value));
    const hasJoiner = /\s(?:e|and|&|\+|\/|-)\s/.test(` ${value} `) || value.includes('/');
    if (muscleTokens.length >= 2 && hasJoiner && value.split(/\s+/).length <= 9) return original.slice(0, 80);

    return null;
  }

  function looksLikePlanTitle(text, lineIndex, pageNumber) {
    const original = normalizeLine(text);
    const value = canonical(original).replace(/[:|]+$/g, '').trim();
    if (pageNumber !== 1 || lineIndex > 8 || value.length < 4 || value.length > 80) return false;
    if (isGenericMetadata(value) || detectDayHeading(value)) return false;
    if (/\b\d{1,2}\s*x\s*(?:\d|amrap|max)/.test(value)) return false;
    if (/\b(?:scheda|programma|routine|workout plan|training plan|mesociclo|microciclo|fase)\b/.test(value)) return true;
    const letters = original.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    const uppercase = letters && letters === letters.toUpperCase();
    return uppercase && original.split(/\s+/).length >= 2 && original.split(/\s+/).length <= 8;
  }

  function durationToSeconds(text) {
    const value = canonical(text).trim();
    let match = value.match(/^(\d{1,2})\s*['m]\s*(\d{1,2})?\s*(?:["s])?$/);
    if (match) return clamp(Number(match[1]) * 60 + Number(match[2] || 0), 0, 600);
    match = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:min|minuti|minuto|minutes?|mins?)$/);
    if (match) return clamp(Math.round(Number(match[1].replace(',', '.')) * 60), 0, 600);
    match = value.match(/^(\d{1,3})\s*(?:s|sec|secs|secondi|secondo|seconds?)$/);
    if (match) return clamp(Number(match[1]), 0, 600);
    return null;
  }

  function normalizeReps(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .replace(/\bper lato\b/i, '/lato')
      .replace(/\bper gamba\b/i, '/gamba')
      .replace(/\s*\/\s*(lato|side|gamba)\b/i, '/$1')
      .trim()
      .slice(0, 40);
  }

  function isRepToken(text) {
    const value = canonical(text).replace(/\s*(?:rip(?:etizioni)?|reps?)\.?$/i, '').trim();
    return /^(?:\d{1,3}(?:\s*[-/]\s*\d{1,3})?(?:\s*\/\s*(?:lato|side))?|amrap|max|cedimento|failure)$/.test(value);
  }

  function parseRepToken(text) {
    const original = normalizeLine(text);
    const value = original.replace(/\s*(?:rip(?:etizioni)?|reps?)\.?$/i, '').trim();
    return normalizeReps(value);
  }

  function isIntegerToken(text, min, max) {
    if (!/^\d{1,3}$/.test(String(text).trim())) return false;
    const value = Number(text);
    return value >= min && value <= max;
  }

  function muscleFromLabel(text) {
    const value = canonical(text).replace(/[.:]+$/g, '').trim();
    return MUSCLE_LABELS.get(value) || '';
  }

  function normalizeMuscleColumn(text) {
    const source = normalizeLine(text).trim();
    const original = source.replace(/[.:]+$/g, '').trim();
    const known = muscleFromLabel(original);
    if (known) return source.slice(0, 40);
    const value = canonical(original);
    if (!value || value.length > 32 || /\d/.test(value) || isColumnHeader(value)) return '';
    if (value.split(/\s+/).length > 4) return '';
    return source.slice(0, 40);
  }

  function parseSeriesSpec(text) {
    const original = normalizeLine(text)
      .replace(/\b(?:serie|series|sets?)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const value = canonical(original)
      .replace(/back\s*[- ]?off/g, 'bo')
      .replace(/backoff/g, 'bo')
      .replace(/\s+/g, ' ')
      .trim();

    let match = value.match(/^(\d{1,2})$/);
    if (match) {
      const count = clamp(Number(match[1]), 1, 20);
      return {
        count,
        scheme: String(count),
        labels: Array.from({ length: count }, (_, index) => String(index + 1)),
        types: Array.from({ length: count }, () => 'standard'),
        workingCount: count,
        backoffCount: 0,
      };
    }

    match = value.match(/^(\d{1,2})\s*\+\s*(?:(\d{1,2})\s*)?bo$/);
    if (match) {
      const workingCount = clamp(Number(match[1]), 1, 19);
      const backoffCount = clamp(Number(match[2] || 1), 1, 20 - workingCount);
      const count = workingCount + backoffCount;
      const backoffLabels = Array.from({ length: backoffCount }, (_, index) => backoffCount === 1 ? 'BO' : `BO ${index + 1}`);
      return {
        count,
        scheme: backoffCount === 1 ? `${workingCount} + BO` : `${workingCount} + ${backoffCount} BO`,
        labels: [...Array.from({ length: workingCount }, (_, index) => String(index + 1)), ...backoffLabels],
        types: [...Array.from({ length: workingCount }, () => 'standard'), ...Array.from({ length: backoffCount }, () => 'backoff')],
        workingCount,
        backoffCount,
      };
    }


    match = value.match(/^(\d{1,2})\s*\+\s*(?:(\d{1,2})\s*)?(drop(?:\s*set)?|ds|rp|rest\s*pause|rest-pause)$/);
    if (match) {
      const workingCount = clamp(Number(match[1]), 1, 19);
      const extraCount = clamp(Number(match[2] || 1), 1, 20 - workingCount);
      const isRestPause = /^(?:rp|rest)/.test(match[3]);
      const label = isRestPause ? 'RP' : 'DROP';
      const type = isRestPause ? 'rest-pause' : 'drop';
      const count = workingCount + extraCount;
      const extraLabels = Array.from({ length: extraCount }, (_, index) => extraCount === 1 ? label : `${label} ${index + 1}`);
      return {
        count,
        scheme: extraCount === 1 ? `${workingCount} + ${label}` : `${workingCount} + ${extraCount} ${label}`,
        labels: [...Array.from({ length: workingCount }, (_, index) => String(index + 1)), ...extraLabels],
        types: [...Array.from({ length: workingCount }, () => 'standard'), ...Array.from({ length: extraCount }, () => type)],
        workingCount,
        backoffCount: 0,
        advancedCount: extraCount,
      };
    }

    return null;
  }

  function looksLikeRepExpression(text) {
    const value = canonical(text).trim();
    if (!value || value.length > 48 || !/\d|amrap|max|cedimento|failure/.test(value)) return false;
    if (/\b(?:kg|lb|lbs|rpe|rir|recupero|rest)\b/.test(value)) return false;
    return /^[\d\s+\-/a-zà-ÿ.]+$/i.test(value);
  }

  function parseRepTargets(text, series) {
    const raw = normalizeReps(text);
    if (!raw || !series?.count) return [];
    let targets = [];

    if (series.backoffCount > 0 && /\s+\+\s+|\+/.test(raw)) {
      const parts = raw.split(/\s*\+\s*/).map(part => normalizeReps(part)).filter(Boolean);
      if (parts.length >= 2) {
        const workingTarget = parts[0];
        const backoffTarget = parts.slice(1).join(' + ');
        targets = [
          ...Array.from({ length: series.workingCount }, () => workingTarget),
          ...Array.from({ length: series.backoffCount }, () => backoffTarget),
        ];
      }
    }

    if (!targets.length && series.count >= 3 && /^\d{1,3}(?:-\d{1,3}){2,}$/.test(raw)) {
      const parts = raw.split('-');
      if (parts.length === series.count) targets = parts;
    }

    if (!targets.length && /[|;]/.test(raw)) {
      const parts = raw.split(/\s*[|;]\s*/).map(part => normalizeReps(part)).filter(Boolean);
      if (parts.length === series.count) targets = parts;
    }

    if (!targets.length) targets = Array.from({ length: series.count }, () => raw);

    return targets.map((reps, index) => ({
      label: series.labels[index] || String(index + 1),
      reps: normalizeReps(reps),
      type: series.types[index] || 'standard',
    }));
  }

  function normalizeSlashPrescription(value = '') {
    return normalizeLine(value)
      .replace(/\\/g, '/')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function advancedSetTypeFromText(value = '') {
    const text = canonical(value).replace(/\s+/g, ' ').trim();
    if (/^(?:drop(?:\s*set)?|ds)$/.test(text)) return { label: 'DROP', type: 'drop', note: 'Drop set' };
    if (/^(?:rest\s*pause|rest-pause|rp)$/.test(text)) return { label: 'RP', type: 'rest-pause', note: 'Rest pause' };
    if (/^(?:bo|back\s*[- ]?off)$/.test(text)) return { label: 'BO', type: 'backoff', note: 'Back-off' };
    return null;
  }

  function normalizeVerticalRepExpression(value = '') {
    const source = normalizeSlashPrescription(value).replace(/\s+/g, ' ').trim();
    if (!source) return '';
    const numbers = source.split('/').map(item => item.trim()).filter(Boolean);
    if (numbers.length === 2 && numbers.every(item => /^\d{1,3}$/.test(item))) return `${numbers[0]}-${numbers[1]}`;
    if (numbers.length >= 3 && numbers.every(item => /^\d{1,3}$/.test(item))) return numbers.join('-');
    return normalizeReps(source);
  }

  function parseVerticalPrescription(value = '') {
    const original = normalizeSlashPrescription(value)
      .replace(/\bdrop\s*set\b/gi, 'drop')
      .replace(/\brest\s*pause\b/gi, 'rp')
      .replace(/\bback\s*[- ]?off\b/gi, 'bo')
      .replace(/\s+/g, ' ')
      .trim();
    const canonicalValue = canonical(original).replace(/\s+/g, ' ').trim();
    if (!canonicalValue || canonicalValue.length > 80) return null;

    const explicit = canonicalValue.match(/^(\d{1,2})\s*x\s*(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento|failure)(?:\s*\+\s*(\d{1,2})\s*(drop|rp|bo)(?:\s+(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento|failure))?)?$/i);
    if (explicit) {
      const workingCount = clamp(Number(explicit[1]), 1, 20);
      const reps = normalizeVerticalRepExpression(explicit[2]);
      const extraCount = explicit[3] ? clamp(Number(explicit[3]), 1, Math.max(1, 20 - workingCount)) : 0;
      const advanced = explicit[4] ? advancedSetTypeFromText(explicit[4]) : null;
      const advancedReps = explicit[5] ? normalizeVerticalRepExpression(explicit[5]) : reps;
      const labels = Array.from({ length: workingCount }, (_, index) => String(index + 1));
      const types = Array.from({ length: workingCount }, () => 'standard');
      const notes = [];
      if (advanced && extraCount) {
        for (let index = 0; index < extraCount; index += 1) {
          labels.push(extraCount === 1 ? advanced.label : `${advanced.label} ${index + 1}`);
          types.push(advanced.type);
        }
        notes.push(`${extraCount} ${advanced.note.toLowerCase()}`);
      }
      const count = labels.length;
      const targets = labels.map((label, index) => ({
        label,
        reps: index >= workingCount ? advancedReps : reps,
        type: types[index] || 'standard',
      }));
      return {
        count,
        reps,
        scheme: labels.join(' | '),
        targets,
        notes,
        advanced: Boolean(advanced && extraCount),
      };
    }

    const sequence = canonicalValue.match(/^(\d{1,3}(?:\s*\/\s*\d{1,3}){2,})$/);
    if (sequence) {
      const values = sequence[1].split('/').map(item => item.trim()).filter(Boolean).slice(0, 20);
      const labels = values.map((_, index) => String(index + 1));
      return {
        count: values.length,
        reps: values.join('-'),
        scheme: String(values.length),
        targets: values.map((reps, index) => ({ label: labels[index], reps, type: 'standard' })),
        notes: [],
        advanced: true,
      };
    }

    return null;
  }

  function splitVerticalExerciseAndPrescription(value = '') {
    const original = normalizeSlashPrescription(value);
    if (!original) return null;

    const explicitMatch = original.match(/^(.*?)(\d{1,2}\s*[xX]\s*\d{1,3}(?:\s*[-/]\s*\d{1,3})?(?:\s*\+\s*\d{1,2}\s*(?:drop\s*set|drop|rest\s*pause|rest-pause|rp|bo|back\s*[- ]?off)(?:\s+\d{1,3}(?:\s*[-/]\s*\d{1,3})?)?)?)\s*$/i);
    if (explicitMatch && explicitMatch[1].trim()) {
      const prescription = parseVerticalPrescription(explicitMatch[2]);
      if (prescription) return { name: cleanExerciseName(explicitMatch[1]), prescription };
    }

    const sequenceMatch = original.match(/^(.*?)(\d{1,3}(?:\s*\/\s*\d{1,3}){2,})\s*$/);
    if (sequenceMatch && sequenceMatch[1].trim()) {
      const prescription = parseVerticalPrescription(sequenceMatch[2]);
      if (prescription) return { name: cleanExerciseName(sequenceMatch[1]), prescription };
    }

    return null;
  }

  function isTechniqueLine(value = '') {
    const text = canonical(value).trim();
    return /^(?:tut|tempo)\b/.test(text) || /^(?:superserie|super\s*serie|superset|circuito)$/.test(text);
  }

  function isPrescriptionContinuation(value = '') {
    const text = canonical(value).trim();
    return /^(?:pause|set|drop|rest|rp)$/.test(text);
  }

  function isVerticalSectionHeading(value = '') {
    const original = normalizeLine(value).replace(/^[-•]\s*/, '').trim();
    const text = canonical(original);
    if (!text || text.length > 42 || /\d/.test(text) || detectDayHeading(text) || isTechniqueLine(text)) return false;
    if (EXERCISE_KEYWORDS.some(keyword => text.includes(keyword))) return false;
    if (muscleFromLabel(text)) return true;
    const muscleHits = [...MUSCLE_LABELS.keys()].filter(label => new RegExp(`(?:^|\\b)${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\b|$)`).test(text));
    if (muscleHits.length) return /\b(?:richiamo|focus|e|and|&|\+|\/|- )\b/.test(` ${text} `) || muscleHits.length >= 2;
    return false;
  }

  function normalizeSectionMuscle(value = '') {
    const original = normalizeLine(value).replace(/^[-•]\s*/, '').trim();
    const direct = muscleFromLabel(original);
    if (direct) return direct;
    const text = canonical(original);
    const hits = [...MUSCLE_LABELS.entries()].filter(([label]) => new RegExp(`(?:^|\\b)${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\b|$)`).test(text));
    if (hits.length === 1) return hits[0][1];
    if (hits.length > 1) return [...new Set(hits.map(([, label]) => label))].join(' / ').slice(0, 40);
    return original.slice(0, 40);
  }

  function detectMultiColumnDayLayout(page) {
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    let headerLine = null;
    let dayCells = [];
    for (const line of lines) {
      const cells = (line.cells || []).filter(cell => detectDayHeading(cell.text));
      if (cells.length >= 2) {
        headerLine = line;
        dayCells = cells.sort((a, b) => a.x - b.x);
        break;
      }
    }
    if (!headerLine || dayCells.length < 2) return null;

    const anchors = dayCells.map(cell => ({ x: cell.x, xEnd: cell.xEnd, name: detectDayHeading(cell.text) || normalizeLine(cell.text) }));
    const boundaries = [];
    for (let index = 0; index < anchors.length - 1; index += 1) {
      boundaries.push((anchors[index].x + anchors[index + 1].x) / 2);
    }
    const columns = anchors.map((anchor, index) => ({
      name: anchor.name,
      index,
      xStart: index === 0 ? -Infinity : boundaries[index - 1],
      xEnd: index === anchors.length - 1 ? Infinity : boundaries[index],
      lines: [],
    }));

    lines.forEach(line => {
      if (line === headerLine || line.y >= headerLine.y - 0.5) return;
      const perColumn = new Map();
      (line.cells || []).forEach(cell => {
        const center = (Number(cell.x) + Number(cell.xEnd)) / 2;
        const column = columns.find(item => center >= item.xStart && center < item.xEnd);
        if (!column) return;
        if (!perColumn.has(column.index)) perColumn.set(column.index, []);
        perColumn.get(column.index).push(cell);
      });
      perColumn.forEach((cells, columnIndex) => {
        const text = normalizeLine(cells.sort((a, b) => a.x - b.x).map(cell => cell.text).join(' '));
        if (!text) return;
        columns[columnIndex].lines.push({
          pageNumber: page.pageNumber,
          lineNumber: line.lineNumber,
          y: line.y,
          text,
          cells,
        });
      });
    });

    columns.forEach(column => column.lines.sort((a, b) => b.y - a.y || a.lineNumber - b.lineNumber));
    return { headerLine, columns };
  }

  function parseVerticalDayColumn(column) {
    const exercises = [];
    let currentMuscle = '';
    let pendingName = [];
    let pendingNote = '';
    let lastExercise = null;
    const sectionNames = [];

    function appendNote(exercise, note) {
      if (!exercise || !note) return;
      exercise.notes = [exercise.notes, note].filter(Boolean).join(' · ').slice(0, 240);
    }

    function flushExercise(name, prescription) {
      const cleanName = cleanExerciseName(name);
      if (!cleanName || !prescription) return null;
      const noteParts = [...(prescription.notes || [])];
      if (pendingNote) noteParts.unshift(pendingNote);
      const exercise = {
        name: cleanName,
        muscle: currentMuscle || inferMuscle(cleanName),
        sets: prescription.count,
        setScheme: prescription.scheme,
        setTargets: prescription.targets,
        reps: prescription.reps,
        rest: 90,
        notes: noteParts.join(' · ').slice(0, 240),
        _meta: {
          structured: true,
          hasBulletOrIndex: false,
          defaultedPrescription: false,
          defaultedRest: true,
          advancedPrescription: Boolean(prescription.advanced),
          verticalLayout: true,
        },
      };
      exercises.push(exercise);
      lastExercise = exercise;
      pendingName = [];
      pendingNote = '';
      return exercise;
    }

    const lines = column.lines || [];
    for (let index = 0; index < lines.length; index += 1) {
      let text = normalizeLine(lines[index].text);
      if (!text || isGenericMetadata(text) || detectDayHeading(text)) continue;

      if (isVerticalSectionHeading(text)) {
        currentMuscle = normalizeSectionMuscle(text);
        sectionNames.push(normalizeLine(text));
        pendingName = [];
        pendingNote = '';
        continue;
      }

      if (isTechniqueLine(text)) {
        const note = normalizeLine(text).replace(/^superserie$/i, 'Superserie');
        appendNote(lastExercise, note);
        pendingNote = /^(?:superserie|super\s*serie|superset|circuito)$/i.test(note) ? note : '';
        continue;
      }

      if (isPrescriptionContinuation(text)) {
        if (/^pause$/i.test(text) && lastExercise && /rest/i.test(lastExercise.notes || '')) appendNote(lastExercise, 'Rest pause');
        continue;
      }

      let combinedText = text;
      const nextText = normalizeLine(lines[index + 1]?.text || '');
      if (/\+\s*\d{1,2}\s*rest$/i.test(normalizeSlashPrescription(text)) && /^pause$/i.test(nextText)) {
        combinedText = `${text} pause`;
        index += 1;
      }

      const split = splitVerticalExerciseAndPrescription(combinedText);
      if (split) {
        const name = [...pendingName, split.name].filter(Boolean).join(' ');
        flushExercise(name, split.prescription);
        continue;
      }

      const prescription = parseVerticalPrescription(combinedText);
      if (prescription) {
        if (pendingName.length) flushExercise(pendingName.join(' '), prescription);
        else if (lastExercise && lastExercise._meta?.defaultedPrescription) {
          Object.assign(lastExercise, {
            sets: prescription.count,
            setScheme: prescription.scheme,
            setTargets: prescription.targets,
            reps: prescription.reps,
          });
          appendNote(lastExercise, (prescription.notes || []).join(' · '));
          lastExercise._meta.defaultedPrescription = false;
          lastExercise._meta.advancedPrescription = Boolean(prescription.advanced);
        }
        continue;
      }

      const candidate = cleanExerciseName(text);
      if (!candidate || /^(?:note|note:|esempio di|arrivo|periodo)\b/i.test(candidate)) continue;
      const uppercaseLetters = candidate.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
      const uppercase = uppercaseLetters && uppercaseLetters === uppercaseLetters.toUpperCase();
      if (looksLikeExerciseName(candidate) || uppercase) pendingName.push(candidate);
    }

    return {
      name: column.name,
      notes: sectionNames.length ? `Sezioni: ${[...new Set(sectionNames)].join(', ')}`.slice(0, 240) : '',
      exercises,
    };
  }

  function parseMultiColumnPages(pages) {
    const days = [];
    const consumedPages = new Set();
    let layouts = 0;
    for (const page of pages || []) {
      const layout = detectMultiColumnDayLayout(page);
      if (!layout) continue;
      layouts += 1;
      consumedPages.add(page.pageNumber);
      layout.columns.forEach(column => {
        const day = parseVerticalDayColumn(column);
        if (day.exercises.length) days.push(day);
      });
    }
    return { days, consumedPages, layouts };
  }

  function parseStructuredTableCells(line) {
    const cells = Array.isArray(line?.cells)
      ? line.cells.map(cell => normalizeLine(typeof cell === 'string' ? cell : cell?.text)).filter(Boolean)
      : [];
    if (cells.length < 4 || isColumnHeader(cells.join(' | '))) return null;

    let working = [...cells];
    if (/^(?:#|n\.?|\d{1,3}[.)-]?)$/i.test(working[0])) working.shift();
    if (working.length < 4) return null;

    const muscle = normalizeMuscleColumn(working[0]);
    const name = cleanExerciseName(working[1]);
    const series = parseSeriesSpec(working[2]);
    const repExpression = normalizeReps(working[3]);
    if (!muscle || !name || !series || !looksLikeRepExpression(repExpression)) return null;
    if (!looksLikeExerciseName(name, { hasBulletOrIndex: false })) return null;

    const notes = working.slice(4).join(' · ').slice(0, 240);
    return {
      exercise: {
        name,
        muscle,
        sets: series.count,
        setScheme: series.scheme,
        setTargets: parseRepTargets(repExpression, series),
        reps: repExpression,
        rest: 90,
        notes,
      },
      meta: {
        structured: true,
        hasBulletOrIndex: false,
        defaultedPrescription: false,
        defaultedRest: true,
        advancedPrescription: series.backoffCount > 0 || new Set(parseRepTargets(repExpression, series).map(item => item.reps)).size > 1,
      },
    };
  }

  function inferMuscle(name) {
    const value = canonical(name);
    const checks = [
      [/\b(?:panca|bench|chest press|croci|fly|push up|piegamenti)\b/, 'Petto'],
      [/\b(?:rematore|row|lat machine|pulldown|trazioni|pull up|pulley|face pull)\b/, 'Schiena'],
      [/\b(?:squat|pressa|leg press|leg extension|affondi|lunge)\b/, 'Gambe'],
      [/\b(?:stacco rumeno|romanian deadlift|leg curl|femorali|hamstring)\b/, 'Femorali'],
      [/\b(?:military|shoulder press|lento avanti|alzate laterali|alzate frontali|tirate al mento)\b/, 'Spalle'],
      [/\b(?:curl|hammer curl)\b/, 'Bicipiti'],
      [/\b(?:pushdown|french press|skull crusher|tricipit|dip)\b/, 'Tricipiti'],
      [/\b(?:hip thrust|glute bridge|abductor|glute)\b/, 'Glutei'],
      [/\b(?:calf|polpacc)\b/, 'Polpacci'],
      [/\b(?:plank|crunch|sit up|ab wheel|russian twist|addom|core)\b/, 'Core'],
    ];
    return checks.find(([pattern]) => pattern.test(value))?.[1] || '';
  }

  function cleanExerciseName(value) {
    let name = normalizeLine(value)
      .replace(/^\s*(?:[-*]\s*|(?:\d{1,3}|[a-z])[.)-]\s+)/i, '')
      .replace(/^\s*\d{1,3}\s*\|\s*/, '')
      .replace(/\s*[|,:;-]+\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const trailingMuscle = name.match(/^(.*?)(?:\s+|\s*\|\s*)(petto|schiena|dorso|gambe|spalle|bicipiti|tricipiti|glutei|femorali|polpacci|core)$/i);
    if (trailingMuscle && trailingMuscle[1].trim().length >= 3) name = trailingMuscle[1].trim();
    return name.slice(0, 80);
  }

  function looksLikeExerciseName(text, flags = {}) {
    const original = cleanExerciseName(text);
    const value = canonical(original);
    if (!value || value.length < 2 || value.length > 80) return false;
    if (isGenericMetadata(value) || NON_EXERCISE_LINES.has(value) || GENERIC_TITLES.has(value)) return false;
    if (detectDayHeading(value) || muscleFromLabel(value)) return false;
    if (/^(?:settimana|week|fase|phase|blocco|block)\b/.test(value)) return false;
    if (/^(?:obiettivo|goal|note|indicazioni|istruzioni)\s*[:=-]/.test(value)) return false;
    if (/https?:\/\/|@/.test(value)) return false;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length > 9 || (words.length > 6 && /[.!?]$/.test(original))) return false;
    const hasKeyword = EXERCISE_KEYWORDS.some(keyword => value.includes(keyword));
    if (flags.hasBulletOrIndex || hasKeyword) return true;
    const letters = original.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    const allUppercase = letters && letters === letters.toUpperCase();
    if (allUppercase && !hasKeyword) return false;
    return words.length >= 1 && words.length <= 6 && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(original);
  }

  function parseTableColumns(text) {
    const cells = normalizeLine(text).split(/\s*\|\s*/).map(cell => cell.trim()).filter(Boolean);
    if (cells.length < 2) return null;

    while (cells.length && /^(?:#|n\.?|num(?:ero)?)$/i.test(cells[0])) cells.shift();
    if (cells.length && /^(?:\d{1,3}|[a-z])(?:[.)-])?$/i.test(cells[0])) cells.shift();
    if (!cells.length) return null;

    if (cells.length >= 4) {
      const advancedMuscle = normalizeMuscleColumn(cells[0]);
      const advancedName = cleanExerciseName(cells[1]);
      const advancedSeries = parseSeriesSpec(cells[2]);
      const advancedReps = normalizeReps(cells[3]);
      if (advancedMuscle && advancedName && advancedSeries && looksLikeRepExpression(advancedReps) && looksLikeExerciseName(advancedName)) {
        return {
          name: advancedName,
          muscle: advancedMuscle,
          sets: advancedSeries.count,
          setScheme: advancedSeries.scheme,
          setTargets: parseRepTargets(advancedReps, advancedSeries),
          reps: advancedReps,
          rest: null,
          notes: cells.slice(4).join(' · ').slice(0, 240),
          explicitPrescription: true,
          advancedPrescription: advancedSeries.backoffCount > 0 || new Set(parseRepTargets(advancedReps, advancedSeries).map(item => item.reps)).size > 1,
        };
      }
    }


    if (cells.length >= 3) {
      const compactName = cleanExerciseName(cells[0]);
      const compactSeries = parseSeriesSpec(cells[1]);
      const compactReps = normalizeReps(cells[2]);
      if (compactName && compactSeries && looksLikeRepExpression(compactReps) && looksLikeExerciseName(compactName)) {
        const targets = parseRepTargets(compactReps, compactSeries);
        return {
          name: compactName,
          muscle: '',
          sets: compactSeries.count,
          setScheme: compactSeries.scheme,
          setTargets: targets,
          reps: compactReps,
          rest: null,
          notes: cells.slice(3).join(' · ').slice(0, 240),
          explicitPrescription: true,
          advancedPrescription: compactSeries.backoffCount > 0 || compactSeries.advancedCount > 0 || new Set(targets.map(item => item.reps)).size > 1,
        };
      }
    }

    let name = '';
    let muscle = '';
    let sets = null;
    let reps = '';
    let rest = null;
    const notes = [];
    let explicitPrescription = false;

    for (const cell of cells) {
      const value = canonical(cell);
      if (!value || isColumnHeader(value)) continue;
      const cellMuscle = muscleFromLabel(cell);
      if (cellMuscle && !muscle) {
        muscle = cellMuscle;
        continue;
      }

      const xMatch = value.match(/^(\d{1,2})\s*x\s*(\d{1,3}(?:\s*[-/]\s*\d{1,3})?(?:\s*\/\s*(?:lato|side))?|amrap|max|cedimento|failure)(?:\s*(sec|s|min))?$/i);
      if (xMatch) {
        sets = clamp(Number(xMatch[1]), 1, 20);
        reps = normalizeReps(`${xMatch[2]}${xMatch[3] ? ` ${xMatch[3]}` : ''}`);
        explicitPrescription = true;
        continue;
      }

      const setLabel = value.match(/^(?:serie|set|sets)\s*[:=]?\s*(\d{1,2})$/i) || value.match(/^(\d{1,2})\s*(?:serie|set|sets)$/i);
      if (setLabel) {
        sets = clamp(Number(setLabel[1]), 1, 20);
        explicitPrescription = true;
        continue;
      }

      const repLabel = value.match(/^(?:rip(?:etizioni)?|reps?)\s*[:=]?\s*(.+)$/i) || value.match(/^(.+?)\s*(?:rip(?:etizioni)?|reps?)$/i);
      if (repLabel && isRepToken(repLabel[1])) {
        reps = parseRepToken(repLabel[1]);
        explicitPrescription = true;
        continue;
      }

      const duration = durationToSeconds(cell);
      if (duration !== null) {
        if (!reps && sets !== null) reps = normalizeReps(cell);
        else if (rest === null) rest = duration;
        else notes.push(cell);
        continue;
      }

      if (sets === null && isIntegerToken(value, 1, 20)) {
        sets = Number(value);
        explicitPrescription = true;
        continue;
      }
      if (!reps && sets !== null && isRepToken(value)) {
        reps = parseRepToken(value);
        explicitPrescription = true;
        continue;
      }
      if (rest === null && sets !== null && reps && isIntegerToken(value, 20, 600)) {
        rest = Number(value);
        continue;
      }
      if (/\bkg\b|\blb\b|\blbs\b|\brpe\b|\brir\b/.test(value)) {
        notes.push(cell);
        continue;
      }
      if (!name && looksLikeExerciseName(cell)) {
        name = cleanExerciseName(cell);
        continue;
      }
      if (!name && /[a-zà-ÿ]/i.test(cell) && !muscleFromLabel(cell)) {
        name = cleanExerciseName(cell);
        continue;
      }
      notes.push(cell);
    }

    if (!name) {
      const candidate = cells.find(cell => looksLikeExerciseName(cell));
      if (candidate) name = cleanExerciseName(candidate);
    }

    return { name, muscle, sets, reps, rest, notes: notes.join(' · ').slice(0, 180), explicitPrescription };
  }

  function parseExerciseLine(input, options = {}) {
    const line = input && typeof input === 'object' ? input : { text: input };
    const original = normalizeLine(line.text);
    const value = canonical(original);
    if (!original || isGenericMetadata(original) || detectDayHeading(original)) return null;

    const structuredTable = parseStructuredTableCells(line);
    if (structuredTable) return structuredTable;

    const verticalCombined = splitVerticalExerciseAndPrescription(original);
    if (verticalCombined?.name && verticalCombined?.prescription) {
      const prescription = verticalCombined.prescription;
      return {
        exercise: {
          name: verticalCombined.name,
          muscle: inferMuscle(verticalCombined.name),
          sets: prescription.count,
          setScheme: prescription.scheme,
          setTargets: prescription.targets,
          reps: prescription.reps,
          rest: 90,
          notes: (prescription.notes || []).join(' · ').slice(0, 240),
        },
        meta: {
          structured: true,
          hasBulletOrIndex: false,
          defaultedPrescription: false,
          defaultedRest: true,
          advancedPrescription: Boolean(prescription.advanced),
          verticalLayout: true,
        },
      };
    }

    const hasBulletOrIndex = /^\s*(?:[-*]\s+|(?:\d{1,3}|[a-z])[.)-]\s+)/i.test(original) || /^\s*\d{1,3}\s*\|/.test(original);
    const table = parseTableColumns(original);
    let name = table?.name || '';
    let muscle = table?.muscle || '';
    let sets = table?.sets ?? null;
    let reps = table?.reps || '';
    let setScheme = table?.setScheme || '';
    let setTargets = table?.setTargets || [];
    let rest = table?.rest ?? null;
    let notes = table?.notes || '';
    let explicitPrescription = Boolean(table?.explicitPrescription);
    let working = original;

    const explicitX = working.match(/(?:^|[\s|,:;-])(\d{1,2})\s*[xX]\s*(\d{1,3}(?:\s*[-/]\s*\d{1,3})?(?:\s*\/\s*(?:lato|side))?|amrap|max|cedimento|failure)(?:\s*(sec|s|min|minuti))?/i);
    if (explicitX) {
      if (sets === null) sets = clamp(Number(explicitX[1]), 1, 20);
      if (!reps) reps = normalizeReps(`${explicitX[2]}${explicitX[3] ? ` ${explicitX[3]}` : ''}`);
      explicitPrescription = true;
      working = working.replace(explicitX[0], ' ');
    }

    const labeledSets = working.match(/(\d{1,2})\s*(?:serie|sets?)\b/i)
      || working.match(/(?:serie|sets?)\s*[:=]\s*(\d{1,2})\b/i)
      || working.match(/^(?:serie|sets?)\s+(\d{1,2})\b/i);
    if (labeledSets) {
      if (sets === null) sets = clamp(Number(labeledSets[1]), 1, 20);
      explicitPrescription = true;
      working = working.replace(labeledSets[0], ' ');
    }

    const labeledReps = working.match(/(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento|failure)\s*(?:rip(?:etizioni)?|reps?)\b/i)
      || working.match(/(?:rip(?:etizioni)?|reps?)\s*[:=]\s*(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento|failure)/i)
      || working.match(/^(?:rip(?:etizioni)?|reps?)\s+(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max|cedimento|failure)\b/i);
    if (labeledReps) {
      if (!reps) reps = normalizeReps(labeledReps[1]);
      explicitPrescription = true;
      working = working.replace(labeledReps[0], ' ');
    }

    if (sets === null || !reps) {
      const rightColumns = working.match(/^(.*?)[\s|;-]+(\d{1,2})[\s|;-]+(\d{1,3}(?:\s*[-/]\s*\d{1,3})?|amrap|max)(?:[\s|;-]+(\d{2,3})(?:\s*(?:s|sec|secondi))?)?\s*$/i);
      if (rightColumns && !/\b(?:kg|lb|rpe|rir)\b/i.test(rightColumns[0])) {
        if (!name) name = cleanExerciseName(rightColumns[1]);
        if (sets === null) sets = clamp(Number(rightColumns[2]), 1, 20);
        if (!reps) reps = normalizeReps(rightColumns[3]);
        if (rest === null && rightColumns[4]) rest = clamp(Number(rightColumns[4]), 0, 600);
        explicitPrescription = true;
        working = rightColumns[1];
      }
    }

    const durationMatches = [...working.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(min|minuti|minuto|s|sec|secondi|secondo)\b/gi)];
    if (rest === null && durationMatches.length) {
      const durationMatch = durationMatches[durationMatches.length - 1];
      const parsed = durationToSeconds(`${durationMatch[1]} ${durationMatch[2]}`);
      if (parsed !== null) {
        rest = parsed;
        working = working.replace(durationMatch[0], ' ');
      }
    }

    if (rest === null) {
      const quoteRest = working.match(/\b(\d{1,2})\s*'\s*(\d{1,2})?\s*"?/);
      if (quoteRest) {
        rest = clamp(Number(quoteRest[1]) * 60 + Number(quoteRest[2] || 0), 0, 600);
        working = working.replace(quoteRest[0], ' ');
      } else {
        const secondsQuote = working.match(/\b(\d{2,3})\s*"/);
        if (secondsQuote) {
          rest = clamp(Number(secondsQuote[1]), 0, 600);
          working = working.replace(secondsQuote[0], ' ');
        }
      }
    }

    const effortMatch = working.match(/(?:@?\s*\b(?:rpe|rir)\b\s*[:=]?\s*\d+(?:[.,]\d+)?|\b\d{1,3}\s*%\s*(?:1rm)?)/i);
    if (effortMatch) {
      notes = [notes, normalizeLine(effortMatch[0])].filter(Boolean).join(' · ').slice(0, 180);
      working = working.replace(effortMatch[0], ' ');
    }

    if (!name) {
      let nameSource = working
        .replace(/\b(?:recupero|rest|pausa)\s*[:=]?/gi, ' ')
        .replace(/\b(?:serie|sets?|rip(?:etizioni)?|reps?)\b\s*[:=]?/gi, ' ')
        .replace(/(?:^|\s)\bx\b(?=\s|$)/gi, ' ')
        .replace(/\s*\|\s*(?:petto|schiena|dorso|gambe|spalle|bicipiti|tricipiti|glutei|femorali|polpacci|core)\b/gi, ' ')
        .replace(/\s*[|,:;-]+\s*$/g, ' ');
      if (nameSource.includes('|')) {
        const candidate = nameSource.split('|').map(part => cleanExerciseName(part)).find(part => looksLikeExerciseName(part, { hasBulletOrIndex }));
        nameSource = candidate || nameSource.split('|')[0];
      }
      name = cleanExerciseName(nameSource);
    }

    if (!muscle) muscle = inferMuscle(name);
    const structured = explicitPrescription || sets !== null || Boolean(reps) || rest !== null;
    const allowPlain = Boolean(options.allowPlain);
    if (!name || (!structured && !allowPlain && !hasBulletOrIndex)) return null;
    if (!looksLikeExerciseName(name, { hasBulletOrIndex }) && !structured) return null;

    const defaultedPrescription = sets === null || !reps;
    const defaultedRest = rest === null;
    return {
      exercise: {
        name,
        muscle,
        sets: clamp(sets ?? 3, 1, 20),
        setScheme: setScheme || String(clamp(sets ?? 3, 1, 20)),
        setTargets: setTargets.length
          ? setTargets
          : parseRepTargets(normalizeReps(reps || '8-10'), parseSeriesSpec(String(clamp(sets ?? 3, 1, 20)))),
        reps: normalizeReps(reps || '8-10'),
        rest: clamp(rest ?? 90, 0, 600),
        notes,
      },
      meta: {
        structured,
        hasBulletOrIndex,
        defaultedPrescription,
        defaultedRest,
        advancedPrescription: Boolean(table?.advancedPrescription),
      },
    };
  }

  function removeRepeatedHeaders(pages) {
    const occurrences = new Map();
    pages.forEach(page => {
      const pageLines = page.lines || [];
      pageLines.forEach((line, index) => {
        if (index > 3 && index < pageLines.length - 3) return;
        const key = canonical(line.text);
        if (key.length < 3 || key.length > 90 || isPageNumberLine(key)) return;
        if (!occurrences.has(key)) occurrences.set(key, new Set());
        occurrences.get(key).add(page.pageNumber);
      });
    });
    const repeated = new Set([...occurrences.entries()].filter(([, pageSet]) => pageSet.size >= 2).map(([key]) => key));
    return pages.map(page => ({
      ...page,
      lines: (page.lines || []).filter((line, index) => {
        const edge = index <= 3 || index >= (page.lines || []).length - 3;
        return !(edge && repeated.has(canonical(line.text)) && !looksLikePlanTitle(line.text, index, page.pageNumber));
      }),
    }));
  }

  function parsePages(inputPages, fileName = 'scheda.pdf') {
    const pages = removeRepeatedHeaders((inputPages || []).map((page, index) => ({
      pageNumber: page.pageNumber || index + 1,
      width: Number(page.width) || 0,
      height: Number(page.height) || 0,
      lines: (page.lines || []).map((line, lineIndex) => typeof line === 'string'
        ? { pageNumber: page.pageNumber || index + 1, lineNumber: lineIndex + 1, text: normalizeLine(line), cells: [] }
        : { ...line, text: normalizeLine(line.text) }).filter(line => line.text),
    })));

    const allLines = pages.flatMap(page => page.lines.map((line, index) => ({ ...line, pageNumber: page.pageNumber, pageLineIndex: index })));
    if (!allLines.length) throw makeError('NO_TEXT', 'Il PDF non contiene testo selezionabile.');

    const multiColumn = parseMultiColumnPages(pages);
    const explicitDayCount = allLines.filter(line => detectDayHeading(line.text)).length + multiColumn.days.length;
    const splitByPage = multiColumn.days.length === 0 && explicitDayCount === 0 && pages.length > 1;
    let detectedTitle = '';
    let titleLineKey = '';
    for (const line of allLines) {
      if (looksLikePlanTitle(line.text, line.pageLineIndex, line.pageNumber)) {
        detectedTitle = normalizeLine(line.text).replace(/\s*[:|]\s*$/, '').slice(0, 60);
        titleLineKey = `${line.pageNumber}:${line.lineNumber}`;
        break;
      }
    }
    if (!detectedTitle || GENERIC_TITLES.has(canonical(detectedTitle))) detectedTitle = titleFromFileName(fileName);

    const days = [];
    let currentDay = null;
    const stats = {
      pages: pages.length,
      textLines: allLines.length,
      exercises: 0,
      structuredExercises: 0,
      defaultedPrescription: 0,
      defaultedRest: 0,
      advancedPrescriptions: 0,
      explicitDays: explicitDayCount,
      ignoredLines: 0,
      multiColumnLayouts: multiColumn.layouts,
      verticalExercises: 0,
    };

    function createDay(name) {
      const day = { name: String(name || `Giorno ${days.length + 1}`).slice(0, 80), notes: '', exercises: [], _keys: new Map() };
      days.push(day);
      currentDay = day;
      return day;
    }

    function addExercise(day, parsed) {
      const key = canonical(parsed.exercise.name).replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
      if (!key) return;
      const existingIndex = day._keys.get(key);
      if (existingIndex !== undefined) {
        const existing = day.exercises[existingIndex];
        if (existing._meta.defaultedPrescription && !parsed.meta.defaultedPrescription) day.exercises[existingIndex] = { ...parsed.exercise, _meta: parsed.meta };
        return;
      }
      day._keys.set(key, day.exercises.length);
      day.exercises.push({ ...parsed.exercise, _meta: parsed.meta });
    }

    multiColumn.days.forEach(importedDay => {
      const day = createDay(importedDay.name);
      day.notes = importedDay.notes || '';
      importedDay.exercises.forEach(item => {
        const { _meta, ...exercise } = item;
        addExercise(day, { exercise, meta: _meta || { structured: true, defaultedPrescription: false, defaultedRest: true, advancedPrescription: false, verticalLayout: true } });
      });
    });
    currentDay = null;

    pages.forEach(page => {
      if (multiColumn.consumedPages.has(page.pageNumber)) return;
      if (splitByPage) currentDay = createDay(`Giorno ${page.pageNumber}`);
      let inNotesSection = false;
      page.lines.forEach(line => {
        const key = `${line.pageNumber}:${line.lineNumber}`;
        const lineValue = canonical(line.text).replace(/[:|]+$/g, '').trim();
        if (/^(?:note|notes|annotazioni|indicazioni generali)$/.test(lineValue)) {
          inNotesSection = true;
          stats.ignoredLines += 1;
          return;
        }
        if (inNotesSection) {
          stats.ignoredLines += 1;
          return;
        }
        if (key === titleLineKey || isGenericMetadata(line.text)) {
          stats.ignoredLines += 1;
          return;
        }

        const heading = detectDayHeading(line.text);
        if (heading) {
          if (!currentDay || canonical(currentDay.name) !== canonical(heading)) createDay(heading);
          return;
        }

        const parsedStructured = parseExerciseLine(line, { allowPlain: false });
        if (parsedStructured) {
          if (!currentDay) createDay('Giorno 1');
          addExercise(currentDay, parsedStructured);
          return;
        }

        const parsedPlain = parseExerciseLine(line, { allowPlain: true });
        if (parsedPlain && (parsedPlain.meta.hasBulletOrIndex || looksLikeExerciseName(line.text))) {
          if (!currentDay) createDay('Giorno 1');
          addExercise(currentDay, parsedPlain);
          return;
        }

        stats.ignoredLines += 1;
      });
    });

    const cleanDays = days
      .map(day => {
        const exercises = day.exercises.map(item => {
          stats.exercises += 1;
          if (item._meta.structured) stats.structuredExercises += 1;
          if (item._meta.defaultedPrescription) stats.defaultedPrescription += 1;
          if (item._meta.defaultedRest) stats.defaultedRest += 1;
          if (item._meta.advancedPrescription) stats.advancedPrescriptions += 1;
          if (item._meta.verticalLayout) stats.verticalExercises += 1;
          const { _meta, ...exercise } = item;
          return exercise;
        });
        return { name: day.name, notes: day.notes, exercises };
      })
      .filter(day => day.exercises.length);

    if (!cleanDays.length || !stats.exercises) throw makeError('NO_EXERCISES', 'Non sono riuscito a riconoscere esercizi nel PDF.');

    const warnings = [];
    if (stats.multiColumnLayouts) warnings.push(`Riconosciuto un layout verticale a ${multiColumn.days.length} giorni: nome e prescrizione sono stati ricomposti nella stessa colonna.`);
    if (stats.defaultedPrescription) warnings.push(`${stats.defaultedPrescription} esercizi non avevano serie o ripetizioni riconoscibili: sono stati impostati su 3 x 8-10.`);
    if (stats.defaultedRest) warnings.push(`${stats.defaultedRest} recuperi mancanti sono stati impostati a 90 secondi.`);
    if (stats.advancedPrescriptions) warnings.push(`${stats.advancedPrescriptions} esercizi con back-off, drop set, rest pause o target diversi per serie sono stati riconosciuti e mantenuti.`);
    if (splitByPage) warnings.push('Non ho trovato titoli dei giorni: ogni pagina è stata importata come un giorno separato.');
    if (stats.structuredExercises / stats.exercises < 0.5) warnings.push('Molti dati sono stati ricostruiti in modo automatico: controlla la scheda prima di usarla.');

    return {
      plan: {
        name: detectedTitle,
        description: `Importata dal PDF “${String(fileName).slice(0, 90)}”. Controlla serie, ripetizioni e recuperi prima del primo allenamento.`,
        days: cleanDays,
      },
      stats,
      warnings,
    };
  }
  function resolvePdfJsGlobal() {
    return root.pdfjsLib || root['pdfjs-dist/build/pdf'] || null;
  }

  function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(makeError('LIBRARY_LOAD', 'Il lettore PDF richiede un browser.'));
        return;
      }
      const absoluteSrc = new URL(src, document.baseURI).href;
      const existing = [...document.scripts].find(script => script.src === absoluteSrc);
      if (existing) {
        if (resolvePdfJsGlobal()) {
          resolve();
          return;
        }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(makeError('LIBRARY_LOAD', 'Impossibile caricare il lettore PDF.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = absoluteSrc;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(makeError('LIBRARY_LOAD', 'Impossibile caricare il lettore PDF.'));
      document.head.appendChild(script);
    });
  }

  async function loadPdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = (async () => {
        let pdfjsLib = resolvePdfJsGlobal();
        if (!pdfjsLib) {
          await loadClassicScript('./vendor/pdf.min.js');
          pdfjsLib = resolvePdfJsGlobal();
        }
        if (!pdfjsLib?.getDocument) throw makeError('LIBRARY_LOAD', 'Il lettore PDF non è disponibile su questo dispositivo.');
        if (typeof document !== 'undefined') {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', document.baseURI).href;
        }
        return pdfjsLib;
      })().catch(error => {
        pdfJsPromise = null;
        throw error;
      });
    }
    return pdfJsPromise;
  }

  function readFileAsArrayBuffer(file) {
    if (typeof file?.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        reject(makeError('PDF_READ', 'Il browser non permette di leggere il file selezionato.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(makeError('PDF_READ', 'Il file selezionato non può essere letto.'));
      reader.onabort = () => reject(makeError('PDF_READ', 'La lettura del file è stata annullata.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function extractPages(file, options = {}) {
    if (!file) throw makeError('NO_FILE', 'Nessun PDF selezionato.');
    if (Number(file.size) > MAX_FILE_BYTES) throw makeError('FILE_TOO_LARGE', 'Il PDF supera il limite di 25 MB.');
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') throw makeError('INVALID_FILE', 'Seleziona un file PDF.');

    let pdfjsLib;
    try {
      pdfjsLib = await loadPdfJs();
    } catch (error) {
      throw makeError('LIBRARY_LOAD', 'Impossibile avviare il lettore PDF.', error);
    }

    let loadingTask;
    try {
      const sourceBuffer = await readFileAsArrayBuffer(file);
      const startLoading = () => {
        const copy = sourceBuffer.slice ? sourceBuffer.slice(0) : sourceBuffer;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(copy), useSystemFonts: true });
        return loadingTask.promise;
      };

      let pdf;
      try {
        pdf = await startLoading();
      } catch (firstError) {
        const workerProblem = /worker|importscripts|dynamically imported module|loading chunk/i.test(`${firstError?.name || ''} ${firstError?.message || ''}`);
        if (!workerProblem || typeof document === 'undefined') throw firstError;

        // Alcune PWA iOS impediscono l'avvio del Web Worker anche quando il
        // file è presente. Caricando lo stesso worker nella pagina, PDF.js
        // passa automaticamente alla modalità "fake worker" e può continuare.
        try { await loadingTask?.destroy?.(); } catch (_) { /* nessuna azione */ }
        await loadClassicScript('./vendor/pdf.worker.min.js');
        pdf = await startLoading();
      }

      if (pdf.numPages > MAX_PAGES) throw makeError('TOO_MANY_PAGES', `Il PDF contiene ${pdf.numPages} pagine; il limite è ${MAX_PAGES}.`);

      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        options.onProgress?.({ pageNumber, totalPages: pdf.numPages, phase: 'reading' });
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          lines: reconstructPageLines(textContent.items, pageNumber),
        });
        page.cleanup?.();
      }
      await pdf.destroy?.();
      return pages;
    } catch (error) {
      if (error?.code) throw error;
      const name = String(error?.name || '');
      if (/password/i.test(name) || /password/i.test(String(error?.message || ''))) throw makeError('PASSWORD', 'Il PDF è protetto da password. Rimuovi la protezione e riprova.', error);
      throw makeError('PDF_READ', 'Il PDF non può essere letto oppure è danneggiato.', error);
    } finally {
      try { await loadingTask?.destroy?.(); } catch (_) { /* nessuna azione */ }
    }
  }

  async function importPdf(file, options = {}) {
    const pages = await extractPages(file, options);
    options.onProgress?.({ pageNumber: pages.length, totalPages: pages.length, phase: 'parsing' });
    return parsePages(pages, file.name || 'scheda.pdf');
  }

  root.ProgressivoPdfImporter = {
    importPdf,
    extractPages,
    parsePages,
    reconstructPageLines,
    limits: { maxBytes: MAX_FILE_BYTES, maxPages: MAX_PAGES },
  };
})();
