(() => {
  'use strict';

  const STORAGE_KEY = 'progressivo.state.v1';
  const APP_VERSION = 12;
  const KG_TO_LB = 2.2046226218;

  const app = document.querySelector('#app');
  const titleEl = document.querySelector('#screen-title');
  const eyebrowEl = document.querySelector('#screen-eyebrow');
  const headerAction = document.querySelector('#header-action');
  const accountButton = document.querySelector('#account-button');
  const accountInitialsEl = document.querySelector('#account-initials');
  const modal = document.querySelector('#modal');
  const modalForm = document.querySelector('#modal-form');
  const modalTitle = document.querySelector('#modal-title');
  const modalEyebrow = document.querySelector('#modal-eyebrow');
  const modalBody = document.querySelector('#modal-body');
  const modalActions = document.querySelector('#modal-actions');
  const importFile = document.querySelector('#import-file');
  const universalFile = document.querySelector('#universal-file');
  const cameraFile = document.querySelector('#camera-file');
  const profileImageFile = document.querySelector('#profile-image-file');
  const toastRegion = document.querySelector('#toast-region');

  const EXERCISE_CATALOG = Array.isArray(window.VANTA_EXERCISE_CATALOG) ? window.VANTA_EXERCISE_CATALOG : [];
  const CATALOG_BY_ID = new Map(EXERCISE_CATALOG.map(entry => [entry.id, entry]));

  let modalHandler = null;
  let deferredInstallPrompt = null;
  let restTimer = null;
  let pendingImportState = null;
  let pendingSharedPlan = null;
  let pendingPdfPlan = null;
  let pdfImportToken = 0;
  let pdfImportLoading = false;
  const catalogBrowser = { query: '', page: 1, pageSize: 12 };

  const ui = {
    route: 'home',
    progressExercise: '',
    progressMetric: 'weight',
    progressRange: '90',
    expandedDays: new Set(),
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calendarSelectedDate: localDateKey(new Date()),
  };

  function uid(prefix = 'id') {
    if (window.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundWeight(value) {
    return Math.round(value * 2) / 2;
  }

  function formatNumber(value, maximumFractionDigits = 1) {
    return new Intl.NumberFormat('it-IT', { maximumFractionDigits }).format(Number(value) || 0);
  }

  function formatCompact(value) {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${formatNumber(n / 1_000_000, 1)}M`;
    if (n >= 1_000) return `${formatNumber(n / 1_000, 1)}k`;
    return formatNumber(n, 0);
  }

  function formatDate(dateValue, options = {}) {
    const date = new Date(dateValue);
    const { year, ...rest } = options;
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: 'short',
      year: year ? 'numeric' : undefined,
      ...rest,
    }).format(date);
  }

  function formatDateLong(dateValue) {
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(dateValue));
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(minutes || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return hours ? `${hours}h ${mins}m` : `${mins} min`;
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function startOfWeek(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function dateDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d;
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return localDateKey(new Date());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeDateKey(value = '') {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return localDateKey(new Date());
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? localDateKey(new Date()) : localDateKey(date);
  }

  function dateFromKey(key) {
    const normalized = normalizeDateKey(key);
    const [year, month, day] = normalized.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function sessionDateForSchedule(key) {
    const selected = dateFromKey(key);
    const now = new Date();
    selected.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return selected.toISOString();
  }

  function addDaysToKey(key, days) {
    const date = dateFromKey(key);
    date.setDate(date.getDate() + Number(days || 0));
    return localDateKey(date);
  }

  function monthTitle(date) {
    return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(date);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function initials(name) {
    return String(name || 'A')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || '')
      .join('') || 'A';
  }

  function safeProfileImage(value = '') {
    const dataUrl = String(value || '').trim();
    if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) return '';
    return dataUrl.length <= 900_000 ? dataUrl : '';
  }

  function profileAvatarMarkup(className = 'profile-avatar') {
    const image = safeProfileImage(state?.profile?.avatarDataUrl);
    if (image) {
      return `<span class="${escapeHtml(className)} has-photo"><img src="${escapeHtml(image)}" alt="Foto profilo di ${escapeHtml(state?.profile?.name || 'Atleta')}"></span>`;
    }
    return `<span class="${escapeHtml(className)}">${escapeHtml(initials(state?.profile?.name || 'Atleta'))}</span>`;
  }

  function normalizeCatalogText(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(?:con|su|alla|alle|ai|agli|al|a|da|dal|dalla|di|del|della|dei|delle|per|the)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function catalogTokens(value) {
    return new Set(normalizeCatalogText(value).split(' ').filter(token => token.length > 1));
  }

  function catalogTextScore(left, right) {
    const a = normalizeCatalogText(left);
    const b = normalizeCatalogText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      return 0.70 + ratio * 0.22;
    }
    const aTokens = catalogTokens(a);
    const bTokens = catalogTokens(b);
    const shared = [...aTokens].filter(token => bTokens.has(token)).length;
    if (!shared) return 0;
    return (2 * shared) / (aTokens.size + bTokens.size);
  }

  function rankedCatalogMatches(name, muscle = '') {
    const normalizedName = normalizeCatalogText(name);
    if (!normalizedName) return [];
    const normalizedMuscle = normalizeCatalogText(muscle);
    return EXERCISE_CATALOG
      .map(entry => {
        const candidates = [entry.name, ...(entry.aliases || [])];
        const scored = candidates.map(candidate => ({
          candidate,
          normalized: normalizeCatalogText(candidate),
          score: catalogTextScore(normalizedName, candidate),
        }));
        const bestCandidate = scored.sort((a, b) => b.score - a.score)[0] || { score: 0, normalized: '' };
        const exact = bestCandidate.normalized === normalizedName;
        const muscleCompatible = normalizedMuscle && (
          catalogTextScore(normalizedMuscle, entry.muscle) >= 0.72 ||
          (entry.primary || []).some(item => catalogTextScore(normalizedMuscle, item) >= 0.72)
        );
        const score = Math.min(1, bestCandidate.score + (muscleCompatible ? 0.055 : 0));
        return { entry, score, exact, muscleCompatible };
      })
      .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.entry.name.localeCompare(b.entry.name, 'it'));
  }

  function catalogMatchDetails(name, muscle = '') {
    const normalizedName = normalizeCatalogText(name);
    if (!normalizedName) return { entry: null, suggestion: null, score: 0, confident: false, ambiguous: false };
    const matches = rankedCatalogMatches(name, muscle);
    const best = matches[0] || null;
    const second = matches[1] || null;
    if (!best) return { entry: null, suggestion: null, score: 0, confident: false, ambiguous: false };
    const tokenCount = catalogTokens(normalizedName).size;
    const minimum = best.exact ? 0.90 : tokenCount <= 1 ? 0.84 : 0.69;
    const margin = best.score - (second?.score || 0);
    const confident = best.exact || (best.score >= minimum && (best.score >= 0.93 || margin >= 0.07));
    return {
      entry: confident ? best.entry : null,
      suggestion: best.entry,
      score: best.score,
      confident,
      ambiguous: !confident && best.score >= 0.50,
      margin,
    };
  }

  function normalizeCatalogMode(mode, catalogId = '') {
    if (mode === 'manual' && catalogId && CATALOG_BY_ID.has(catalogId)) return 'manual';
    if (mode === 'none') return 'none';
    return 'auto';
  }

  function matchCatalogEntry(name, muscle = '', preferredId = '', mode = 'auto') {
    const normalizedMode = normalizeCatalogMode(mode, preferredId);
    if (normalizedMode === 'manual') return CATALOG_BY_ID.get(preferredId) || null;
    if (normalizedMode === 'none') return null;
    return catalogMatchDetails(name, muscle).entry;
  }

  function catalogEntryForExercise(exercise) {
    if (!exercise) return null;
    return matchCatalogEntry(exercise.name, exercise.muscle, exercise.catalogId, exercise.catalogMode || 'auto');
  }

  function safeYoutubeUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      return ['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host) || host.endsWith('.youtube.com') ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function youtubeUrlForExercise(exercise, entry = catalogEntryForExercise(exercise)) {
    const custom = safeYoutubeUrl(exercise?.videoUrl);
    if (custom) return custom;
    const query = entry?.youtubeQuery || `${exercise?.name || 'esercizio palestra'} esecuzione corretta tecnica`;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }

  function exerciseKey(exercise) {
    const entry = catalogEntryForExercise(exercise);
    const manualId = exercise?.catalogMode === 'manual' && CATALOG_BY_ID.has(exercise?.catalogId) ? exercise.catalogId : '';
    return entry?.id || manualId || normalizeCatalogText(exercise?.name || 'esercizio');
  }

  function updateAccountButton() {
    if (!accountButton || !accountInitialsEl) return;
    const profileName = state?.profile?.name || 'Atleta';
    const image = safeProfileImage(state?.profile?.avatarDataUrl);
    accountButton.classList.toggle('has-photo', Boolean(image));
    accountButton.style.backgroundImage = image ? `url("${image}")` : '';
    accountInitialsEl.hidden = Boolean(image);
    accountInitialsEl.textContent = image ? '' : initials(profileName);
    accountButton.title = `Account di ${profileName}`;
    accountButton.setAttribute('aria-label', `Apri account di ${profileName} e modifica profilo`);
  }

  function createSeedPlan() {
    return {
      id: uid('plan'),
      name: 'Full Body • esempio',
      description: 'Una scheda iniziale modificabile. Sostituiscila con il tuo programma.',
      createdAt: new Date().toISOString(),
      days: [
        {
          id: uid('day'),
          name: 'Giorno A',
          notes: 'Spinta + gambe',
          exercises: [
            { id: uid('ex'), name: 'Squat', muscle: 'Gambe', sets: 4, reps: '6-8', rest: 150, notes: '' },
            { id: uid('ex'), name: 'Panca piana', muscle: 'Petto', sets: 4, reps: '6-8', rest: 120, notes: '' },
            { id: uid('ex'), name: 'Rematore', muscle: 'Schiena', sets: 3, reps: '8-10', rest: 90, notes: '' },
          ],
        },
        {
          id: uid('day'),
          name: 'Giorno B',
          notes: 'Tirata + posterior chain',
          exercises: [
            { id: uid('ex'), name: 'Stacco rumeno', muscle: 'Femorali', sets: 4, reps: '6-8', rest: 150, notes: '' },
            { id: uid('ex'), name: 'Military press', muscle: 'Spalle', sets: 4, reps: '6-8', rest: 120, notes: '' },
            { id: uid('ex'), name: 'Lat machine', muscle: 'Schiena', sets: 3, reps: '8-12', rest: 90, notes: '' },
          ],
        },
      ],
    };
  }

  function createDefaultState() {
    return {
      version: APP_VERSION,
      profile: {
        name: 'Atleta',
        unit: 'kg',
        weeklyGoal: 3,
        avatarDataUrl: '',
      },
      plans: [normalizePlan(createSeedPlan())],
      sessions: [],
      scheduledWorkouts: [],
      activeSession: null,
      preferences: {
        installDismissed: false,
      },
    };
  }

  function labelsFromInput(value, fallbackCount = 0) {
    const raw = String(value || '').trim();
    const count = clamp(Math.round(toNumber(fallbackCount, 3)), 1, 20);
    if (!raw) return [];

    if (/^\d{1,2}$/.test(raw)) {
      const standardCount = clamp(Number(raw), 1, 20);
      return Array.from({ length: standardCount }, (_, index) => String(index + 1));
    }

    const shorthand = raw.toUpperCase()
      .replace(/BACK\s*[- ]?OFF/g, 'BO')
      .replace(/\s+/g, ' ')
      .match(/^(\d{1,2})\s*\+\s*(?:(\d{1,2})\s*)?BO$/);
    if (shorthand) {
      const working = clamp(Number(shorthand[1]), 1, 19);
      const backoff = clamp(Number(shorthand[2] || 1), 1, 20 - working);
      return [
        ...Array.from({ length: working }, (_, index) => String(index + 1)),
        ...Array.from({ length: backoff }, (_, index) => backoff === 1 ? 'BO' : `BO ${index + 1}`),
      ];
    }

    if (/^(?:BO|BACK\s*[- ]?OFF)$/i.test(raw) && count > 1) {
      return [
        ...Array.from({ length: count - 1 }, (_, index) => String(index + 1)),
        'BO',
      ];
    }

    const tokens = raw
      .replace(/[–—]/g, '-')
      .split(/\s*(?:\||;|,|\/|\+|-)\s*/)
      .map((label, index) => normalizeSetLabel(label, index))
      .filter(Boolean)
      .slice(0, 20);

    if (tokens.length) return tokens;

    return raw
      .split(/\s+/)
      .map((label, index) => normalizeSetLabel(label, index))
      .filter(Boolean)
      .slice(0, 20);
  }

  function inferSetScheme(labels) {
    const values = (labels || []).map((label, index) => normalizeSetLabel(label, index));
    if (!values.length) return '1';
    const firstBackoff = values.findIndex(label => /^BO\b/i.test(label));
    const standardLabels = firstBackoff < 0 ? values : values.slice(0, firstBackoff);
    const sequential = standardLabels.every((label, index) => label === String(index + 1));
    const allBackoffAfter = firstBackoff >= 0 && values.slice(firstBackoff).every(label => /^BO\b/i.test(label));
    if (sequential && allBackoffAfter) {
      const backoffCount = values.length - firstBackoff;
      return backoffCount === 1 ? `${firstBackoff} + BO` : `${firstBackoff} + ${backoffCount} BO`;
    }
    if (sequential && firstBackoff < 0) return String(values.length);
    return values.join(' | ');
  }

  function normalizeSetLabel(value, index = 0) {
    const cleaned = String(value || '').trim().toUpperCase().replace(/BACK\s*[- ]?OFF/g, 'BO').replace(/\s+/g, ' ');
    if (!cleaned) return String(index + 1);
    const backoffMatch = cleaned.match(/^BO(?:\s*(\d+))?$/);
    if (backoffMatch) return backoffMatch[1] ? `BO ${backoffMatch[1]}` : 'BO';
    return cleaned;
  }


  function setTypeFromLabel(value = '', explicitType = '') {
    const normalizedType = String(explicitType || '').trim().toLowerCase();
    if (['backoff', 'drop', 'rest-pause'].includes(normalizedType)) return normalizedType;
    const label = normalizeSetLabel(value);
    if (/^BO\b/i.test(label)) return 'backoff';
    if (/^(?:DROP|DS)\b/i.test(label)) return 'drop';
    if (/^(?:RP|REST\s*PAUSE)\b/i.test(label)) return 'rest-pause';
    return 'standard';
  }

  function setRowClass(type = '') {
    const value = String(type || 'standard');
    if (value === 'backoff') return 'backoff-row';
    if (value === 'drop') return 'drop-row';
    if (value === 'rest-pause') return 'rest-pause-row';
    return '';
  }

  function parseSetSchemeDetails(setScheme, totalSetsFallback = 0) {
    const fallbackCount = clamp(Math.round(toNumber(totalSetsFallback, 3)) || 3, 1, 20);
    const raw = String(setScheme ?? '').trim();
    if (!raw) {
      return {
        count: fallbackCount,
        labels: Array.from({ length: fallbackCount }, (_, index) => String(index + 1)),
        normalized: String(fallbackCount),
      };
    }

    const value = raw.toUpperCase()
      .replace(/[–—]/g, '-')
      .replace(/BACK\s*[- ]?OFF/g, 'BO')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^\d{1,2}$/.test(value)) {
      const count = clamp(Number(value), 1, 20);
      return {
        count,
        labels: Array.from({ length: count }, (_, index) => String(index + 1)),
        normalized: String(count),
      };
    }

    const backoffMatch = value.match(/^(\d{1,2})\s*\+\s*(?:(\d{1,2})\s*)?BO$/);
    if (backoffMatch) {
      const working = clamp(Number(backoffMatch[1]), 1, 20);
      const backoff = clamp(Number(backoffMatch[2] || 1), 1, 20);
      const labels = [
        ...Array.from({ length: working }, (_, index) => String(index + 1)),
        ...Array.from({ length: backoff }, (_, index) => backoff === 1 ? 'BO' : `BO ${index + 1}`),
      ].slice(0, 20);
      const normalized = backoff === 1 ? `${working} + BO` : `${working} + ${backoff} BO`;
      return { count: labels.length, labels, normalized };
    }

    const explicitTokens = value.split(/\s*(?:\||,|;|\/|\+|-)\s*/).map(token => normalizeSetLabel(token)).filter(Boolean);
    if (explicitTokens.length && explicitTokens.every(token => /^(?:\d{1,2}|BO(?:\s*\d+)?|[A-Z]{1,6}\d*)$/i.test(token))) {
      const labels = explicitTokens.slice(0, 20);
      return { count: labels.length, labels, normalized: labels.join(' - ') };
    }

    const spaceTokens = value.split(/\s+/).map(token => normalizeSetLabel(token)).filter(Boolean);
    if (spaceTokens.length > 1 && spaceTokens.every(token => /^(?:\d{1,2}|BO(?:\s*\d+)?|[A-Z]{1,6}\d*)$/i.test(token))) {
      const labels = spaceTokens.slice(0, 20);
      return { count: labels.length, labels, normalized: labels.join(' - ') };
    }

    return {
      count: fallbackCount,
      labels: Array.from({ length: fallbackCount }, (_, index) => String(index + 1)),
      normalized: raw.slice(0, 40),
    };
  }

  function deriveSetLabels(setScheme, totalSets) {
    return parseSetSchemeDetails(setScheme, totalSets).labels;
  }

  function deriveRepTargets(totalSets, reps, setScheme) {
    const count = clamp(Math.round(toNumber(totalSets, 3)), 1, 20);
    const raw = String(reps || '8-10').trim();
    const labels = deriveSetLabels(setScheme, count);
    let values = [];
    const backoffIndex = labels.findIndex(label => /^BO\b/i.test(label));

    if (backoffIndex > 0 && raw.includes('+')) {
      const parts = raw.split(/\s*\+\s*/).map(item => item.trim()).filter(Boolean);
      if (parts.length >= 2) {
        values = [
          ...Array.from({ length: backoffIndex }, () => parts[0]),
          ...Array.from({ length: count - backoffIndex }, () => parts.slice(1).join(' + ')),
        ];
      }
    }

    if (!values.length && count >= 3 && /^\d{1,3}(?:-\d{1,3}){2,}$/.test(raw)) {
      const parts = raw.split('-');
      if (parts.length === count) values = parts;
    }

    if (!values.length) values = Array.from({ length: count }, () => raw);
    return values.map((targetReps, index) => ({
      label: labels[index],
      reps: String(targetReps || raw).trim(),
      type: setTypeFromLabel(labels[index]),
    }));
  }

  function normalizeSetTargets(targets, totalSets, reps, setScheme) {
    const count = clamp(Math.round(toNumber(totalSets, 3)), 1, 20);
    const fallback = deriveRepTargets(count, reps, setScheme);
    if (!Array.isArray(targets) || !targets.length) return fallback;
    const labels = deriveSetLabels(setScheme, count);
    return Array.from({ length: count }, (_, index) => {
      const source = targets[index] || fallback[index];
      const label = String(source?.label || labels[index] || index + 1).trim();
      return {
        label,
        reps: String(source?.reps || fallback[index]?.reps || reps || '8-10').trim(),
        type: setTypeFromLabel(label, source?.type),
      };
    });
  }

  function targetInputValue(exercise) {
    return (exercise?.setTargets || []).map(target => target.reps).join(' | ');
  }

  function setLabelInputValue(exercise) {
    const count = clamp(Math.round(toNumber(exercise?.sets, 3)), 1, 20);
    const targets = normalizeSetTargets(exercise?.setTargets, count, exercise?.reps, exercise?.setScheme);
    return targets.map((target, index) => normalizeSetLabel(target.label, index)).join(' | ');
  }

  function targetsFromInput(value) {
    return String(value || '')
      .split(/\s*[|;]\s*/)
      .map(reps => reps.trim())
      .filter(Boolean)
      .map(reps => ({ reps }));
  }

  function buildSetTargets(labels, repTargets, fallbackReps) {
    const cleanLabels = (labels || []).map((label, index) => normalizeSetLabel(label, index));
    const reps = Array.isArray(repTargets) ? repTargets : [];
    return cleanLabels.map((label, index) => ({
      label,
      reps: String(reps[index]?.reps || reps[reps.length - 1]?.reps || fallbackReps || '8-10').trim(),
      type: setTypeFromLabel(label),
    }));
  }

  function exercisePrescriptionLabel(exercise) {
    const scheme = String(exercise?.setScheme || exercise?.sets || 3).trim();
    return `${scheme} · ${String(exercise?.reps || '8-10').trim()}`;
  }

  function repPlaceholder(value) {
    return String(value || '').match(/\d{1,3}/)?.[0] || '';
  }

  function normalizeExercise(exercise) {
    const reps = String(exercise?.reps || '8-10');
    const schemeInput = String(exercise?.setScheme || '').trim();
    const fallbackSets = clamp(Math.round(toNumber(exercise?.sets, 3)) || 0, 0, 20);
    const scheme = parseSetSchemeDetails(schemeInput || exercise?.sets, fallbackSets || 3);
    const sets = scheme.count;
    const setScheme = String(scheme.normalized || sets).trim().slice(0, 40) || String(sets);
    const name = String(exercise?.name || 'Esercizio').trim() || 'Esercizio';
    const suppliedMuscle = String(exercise?.muscle || '').trim();
    const requestedCatalogId = String(exercise?.catalogId || '');
    const catalogMode = normalizeCatalogMode(exercise?.catalogMode, requestedCatalogId);
    const catalog = matchCatalogEntry(name, suppliedMuscle, requestedCatalogId, catalogMode);
    return {
      id: exercise?.id || uid('ex'),
      name,
      muscle: suppliedMuscle || catalog?.muscle || '',
      catalogId: catalog?.id || '',
      catalogMode,
      videoUrl: safeYoutubeUrl(exercise?.videoUrl),
      sets,
      setScheme,
      setTargets: normalizeSetTargets(exercise?.setTargets, sets, reps, setScheme),
      reps,
      rest: clamp(Math.round(toNumber(exercise?.rest, 90)), 0, 600),
      notes: String(exercise?.notes || ''),
    };
  }

  function normalizePlan(plan) {
    return {
      id: plan?.id || uid('plan'),
      name: String(plan?.name || 'Scheda senza nome'),
      description: String(plan?.description || ''),
      createdAt: plan?.createdAt || new Date().toISOString(),
      days: Array.isArray(plan?.days) ? plan.days.map(day => ({
        id: day?.id || uid('day'),
        name: String(day?.name || 'Giorno'),
        notes: String(day?.notes || ''),
        exercises: Array.isArray(day?.exercises) ? day.exercises.map(normalizeExercise) : [],
      })) : [],
    };
  }

  function normalizeSessionExercise(exercise) {
    const name = String(exercise?.name || 'Esercizio').trim() || 'Esercizio';
    const suppliedMuscle = String(exercise?.muscle || '').trim();
    const requestedCatalogId = String(exercise?.catalogId || '');
    const catalogMode = normalizeCatalogMode(exercise?.catalogMode, requestedCatalogId);
    const catalog = matchCatalogEntry(name, suppliedMuscle, requestedCatalogId, catalogMode);
    const targetSets = clamp(Math.round(toNumber(exercise?.targetSets ?? exercise?.sets?.length, 1)), 1, 20);
    return {
      ...exercise,
      exerciseId: exercise?.exerciseId || exercise?.id || '',
      name,
      muscle: suppliedMuscle || catalog?.muscle || '',
      catalogId: catalog?.id || '',
      catalogMode,
      videoUrl: safeYoutubeUrl(exercise?.videoUrl),
      targetSets,
      targetScheme: String(exercise?.targetScheme || targetSets),
      targetReps: String(exercise?.targetReps || exercise?.reps || ''),
      rest: clamp(Math.round(toNumber(exercise?.rest, 90)), 0, 600),
      notes: String(exercise?.notes || ''),
      ghostDate: exercise?.ghostDate || '',
      sets: Array.isArray(exercise?.sets) ? exercise.sets.map((set, index) => {
        const label = normalizeSetLabel(set?.targetLabel || set?.label || index + 1, index);
        return {
          ...set,
          id: set?.id || uid('set'),
          weight: set?.weight ?? '',
          reps: set?.reps ?? '',
          completed: set?.completed === undefined ? (toNumber(set?.weight) > 0 && toNumber(set?.reps) > 0) : Boolean(set?.completed),
          targetLabel: label,
          targetReps: String(set?.targetReps || exercise?.targetReps || ''),
          setType: setTypeFromLabel(label, set?.setType),
          previousWeight: set?.previousWeight ?? '',
          previousReps: set?.previousReps ?? '',
          previousLabel: String(set?.previousLabel || label),
        };
      }) : [],
    };
  }

  function normalizeSession(session, active = false) {
    if (!session || typeof session !== 'object') return null;
    return {
      ...session,
      id: session.id || uid('session'),
      planId: String(session.planId || ''),
      dayId: String(session.dayId || ''),
      planName: String(session.planName || 'Scheda'),
      dayName: String(session.dayName || 'Allenamento'),
      date: session.date || session.startedAt || new Date().toISOString(),
      startedAt: session.startedAt || session.date || new Date().toISOString(),
      notes: String(session.notes || ''),
      exercises: Array.isArray(session.exercises) ? session.exercises.map(normalizeSessionExercise) : [],
      ...(active ? {} : { durationMin: Math.max(0, toNumber(session.durationMin, 0)) }),
    };
  }

  function normalizeScheduledWorkout(item) {
    if (!item || typeof item !== 'object') return null;
    const status = ['planned', 'completed', 'skipped'].includes(item.status) ? item.status : 'planned';
    return {
      id: item.id || uid('schedule'),
      date: normalizeDateKey(item.date),
      planId: String(item.planId || ''),
      dayId: String(item.dayId || ''),
      status,
      sessionId: String(item.sessionId || ''),
      notes: String(item.notes || ''),
      createdAt: item.createdAt || new Date().toISOString(),
      completedAt: item.completedAt || '',
    };
  }

  function normalizeState(input) {
    const base = createDefaultState();
    if (!input || typeof input !== 'object') return base;
    const state = {
      version: APP_VERSION,
      profile: {
        name: String(input.profile?.name || base.profile.name),
        unit: input.profile?.unit === 'lb' ? 'lb' : 'kg',
        weeklyGoal: clamp(Math.round(toNumber(input.profile?.weeklyGoal, 3)), 1, 14),
        avatarDataUrl: safeProfileImage(input.profile?.avatarDataUrl),
      },
      plans: Array.isArray(input.plans) ? input.plans.map(normalizePlan) : base.plans,
      sessions: Array.isArray(input.sessions) ? input.sessions.map(session => normalizeSession(session)).filter(Boolean) : [],
      scheduledWorkouts: Array.isArray(input.scheduledWorkouts) ? input.scheduledWorkouts.map(normalizeScheduledWorkout).filter(Boolean) : [],
      activeSession: input.activeSession && typeof input.activeSession === 'object' ? normalizeSession(input.activeSession, true) : null,
      preferences: {
        installDismissed: Boolean(input.preferences?.installDismissed),
      },
    };
    return state;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : createDefaultState();
    } catch (error) {
      console.error('Impossibile caricare i dati', error);
      return createDefaultState();
    }
  }

  let state = loadState();

  function saveState({ silent = false } = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error('Impossibile salvare i dati', error);
      if (!silent) toast('Spazio di archiviazione non disponibile.', 'error');
      return false;
    }
  }

  // Persist normalized migrations (including the calendar introduced in v12) immediately.
  saveState({ silent: true });

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`.trim();
    el.textContent = message;
    toastRegion.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
  }

  function openModal({ eyebrow = 'MODIFICA', title, body, actions, onSubmit, autoFocus = true }) {
    modalEyebrow.textContent = eyebrow;
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    modalActions.innerHTML = actions || `
      <button type="button" class="button secondary" data-action="close-modal">Annulla</button>
      <button type="submit" class="button" value="save">Salva</button>`;
    modalHandler = onSubmit || null;
    if (!modal.open) {
      if (typeof modal.showModal === 'function') modal.showModal();
      else modal.setAttribute('open', '');
    }
    if (autoFocus) {
      const firstInput = modalBody.querySelector('input:not([type="hidden"]), select, textarea');
      window.setTimeout(() => firstInput?.focus({ preventScroll: true }), 80);
    }
  }

  function closeModal() {
    if (pdfImportLoading) {
      pdfImportToken += 1;
      pdfImportLoading = false;
    }
    if (modal.open) {
      if (typeof modal.close === 'function') modal.close();
      else modal.removeAttribute('open');
    }
    modalHandler = null;
  }

  function confirmModal({ title, message, confirmLabel = 'Conferma', danger = false, onConfirm }) {
    openModal({
      eyebrow: danger ? 'ATTENZIONE' : 'CONFERMA',
      title,
      body: `<p class="muted no-margin" style="line-height:1.55">${escapeHtml(message)}</p>`,
      actions: `
        <button type="button" class="button secondary" data-action="close-modal">Annulla</button>
        <button type="submit" class="button ${danger ? 'danger' : ''}" value="confirm">${escapeHtml(confirmLabel)}</button>`,
      onSubmit: () => {
        closeModal();
        onConfirm?.();
      },
    });
  }

  function getRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [route = 'home', id = ''] = hash.split('/');
    return { route: route || 'home', id };
  }

  function navigate(path) {
    const normalized = path.replace(/^#?\/?/, '');
    if (location.hash === `#/${normalized}`) {
      render();
    } else {
      location.hash = `#/${normalized}`;
    }
  }

  function setHeader(eyebrow, title, action = null) {
    eyebrowEl.textContent = eyebrow;
    titleEl.textContent = title;
    if (!action) {
      headerAction.hidden = true;
      headerAction.removeAttribute('data-action');
      headerAction.textContent = '';
      return;
    }
    headerAction.hidden = false;
    headerAction.textContent = action.label;
    headerAction.setAttribute('aria-label', action.ariaLabel || action.label);
    headerAction.dataset.action = action.action;
    Object.entries(action.data || {}).forEach(([key, value]) => { headerAction.dataset[key] = value; });
  }

  function setActiveNav(route) {
    document.querySelectorAll('.nav-item').forEach(item => {
      const target = item.dataset.route;
      item.classList.toggle('is-active', route === target || (route === 'plan' && target === 'plans'));
    });
  }

  function getPlan(planId) {
    return state.plans.find(plan => plan.id === planId);
  }

  function getDay(planId, dayId) {
    return getPlan(planId)?.days.find(day => day.id === dayId);
  }

  function getScheduledWorkout(scheduleId) {
    return state.scheduledWorkouts.find(item => item.id === scheduleId) || null;
  }

  function resolveScheduledWorkout(item) {
    if (!item) return null;
    const plan = getPlan(item.planId);
    const day = getDay(item.planId, item.dayId);
    if (!plan || !day) return null;
    return { item, plan, day };
  }

  function scheduledWorkoutsForDate(dateKey) {
    return state.scheduledWorkouts
      .filter(item => item.date === normalizeDateKey(dateKey))
      .sort((a, b) => {
        const order = { planned: 0, completed: 1, skipped: 2 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.createdAt.localeCompare(b.createdAt);
      });
  }

  function upcomingScheduledWorkouts(limit = 4) {
    const today = localDateKey(new Date());
    return [...state.scheduledWorkouts]
      .filter(item => item.date >= today && item.status === 'planned' && resolveScheduledWorkout(item))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  function scheduleStatusLabel(status) {
    if (status === 'completed') return 'Completato';
    if (status === 'skipped') return 'Saltato';
    return 'Programmato';
  }

  function getSessionVolume(session) {
    return (session?.exercises || []).reduce((total, exercise) => total + (exercise.sets || []).reduce((sum, set) => {
      const valid = set.completed !== false && toNumber(set.weight) > 0 && toNumber(set.reps) > 0;
      return sum + (valid ? toNumber(set.weight) * toNumber(set.reps) : 0);
    }, 0), 0);
  }

  function getSessionSets(session) {
    return (session?.exercises || []).reduce((total, exercise) => total + (exercise.sets || []).filter(set => set.completed !== false && toNumber(set.weight) > 0 && toNumber(set.reps) > 0).length, 0);
  }

  function e1rm(weight, reps) {
    const w = toNumber(weight);
    const r = toNumber(reps);
    return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
  }

  function calculateRecordEvents() {
    const ordered = [...state.sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const records = new Map();
    const events = [];
    ordered.forEach(session => {
      (session.exercises || []).forEach(exercise => {
        const validSets = (exercise.sets || []).filter(set => set.completed !== false && toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
        if (!validSets.length) return;
        const bestWeight = Math.max(...validSets.map(set => toNumber(set.weight)));
        const bestE1rm = Math.max(...validSets.map(set => e1rm(set.weight, set.reps)));
        const key = exerciseKey(exercise);
        const previous = records.get(key) || { weight: 0, e1rm: 0 };
        if (bestWeight > previous.weight || bestE1rm > previous.e1rm + 0.1) {
          events.push({ date: session.date, name: catalogEntryForExercise(exercise)?.name || exercise.name, weight: bestWeight, e1rm: bestE1rm });
        }
        records.set(key, {
          weight: Math.max(previous.weight, bestWeight),
          e1rm: Math.max(previous.e1rm, bestE1rm),
        });
      });
    });
    return events;
  }

  function latestSessionForDay(planId, dayId) {
    return [...state.sessions]
      .filter(session => session.planId === planId && session.dayId === dayId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
  }

  function previousExerciseSnapshot(exerciseName, catalogId = '', catalogMode = 'auto', muscle = '') {
    const targetKey = exerciseKey({ name: exerciseName, catalogId, catalogMode, muscle });
    const normalizedTarget = normalizeCatalogText(exerciseName);
    const sessions = [...state.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const session of sessions) {
      const exercise = (session.exercises || []).find(item => {
        const itemKey = exerciseKey(item);
        return itemKey === targetKey || normalizeCatalogText(item.name) === normalizedTarget;
      });
      if (exercise) return { exercise, session };
    }
    return null;
  }

  function previousExercisePerformance(exerciseName, catalogId = '', catalogMode = 'auto', muscle = '') {
    return previousExerciseSnapshot(exerciseName, catalogId, catalogMode, muscle)?.exercise || null;
  }

  function previousSetForTarget(previousExercise, target, index) {
    if (!previousExercise?.sets?.length) return null;
    const targetLabel = normalizeSetLabel(target?.label || target?.targetLabel || index + 1, index);
    const byLabel = previousExercise.sets.find((set, previousIndex) => normalizeSetLabel(set.targetLabel || previousIndex + 1, previousIndex) === targetLabel);
    return byLabel || previousExercise.sets[index] || null;
  }

  function ghostSetComparison(set) {
    const previousVolume = toNumber(set?.previousWeight) * toNumber(set?.previousReps);
    const currentVolume = toNumber(set?.weight) * toNumber(set?.reps);
    if (!previousVolume) return { status: 'new', deltaPct: 0, currentVolume, previousVolume };
    if (!currentVolume) return { status: 'waiting', deltaPct: -100, currentVolume, previousVolume };
    const deltaPct = ((currentVolume - previousVolume) / previousVolume) * 100;
    const status = deltaPct > 0.5 ? 'ahead' : deltaPct < -0.5 ? 'behind' : 'even';
    return { status, deltaPct, currentVolume, previousVolume };
  }

  function ghostComparison(exercise) {
    const comparable = (exercise?.sets || []).filter(set => toNumber(set.previousWeight) > 0 && toNumber(set.previousReps) > 0);
    if (!comparable.length) {
      return { status: 'new', label: 'Prima sfida: crea il tuo fantasma', deltaPct: 0, fill: 0, today: 0, previous: 0, comparedSets: 0 };
    }
    const filled = comparable.filter(set => toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
    if (!filled.length) {
      return { status: 'waiting', label: 'Il fantasma dell’ultima volta ti aspetta', deltaPct: 0, fill: 0, today: 0, previous: 0, comparedSets: 0 };
    }
    const today = filled.reduce((sum, set) => sum + toNumber(set.weight) * toNumber(set.reps), 0);
    const previous = filled.reduce((sum, set) => sum + toNumber(set.previousWeight) * toNumber(set.previousReps), 0);
    const deltaPct = previous ? ((today - previous) / previous) * 100 : 0;
    const status = deltaPct > 0.5 ? 'ahead' : deltaPct < -0.5 ? 'behind' : 'even';
    const label = status === 'ahead'
      ? `Sei avanti del ${formatNumber(Math.abs(deltaPct), 1)}%`
      : status === 'behind'
        ? `Sei indietro del ${formatNumber(Math.abs(deltaPct), 1)}%`
        : 'Sei in pari con il tuo fantasma';
    return {
      status,
      label,
      deltaPct,
      fill: clamp(previous ? (today / previous) * 100 : 0, 0, 100),
      today,
      previous,
      comparedSets: filled.length,
    };
  }

  function ghostStatusMarkup(set) {
    const comparison = ghostSetComparison(set);
    const symbol = comparison.status === 'ahead' ? '↑' : comparison.status === 'behind' ? '↓' : comparison.status === 'even' ? '=' : '·';
    const label = comparison.status === 'ahead' ? 'Avanti' : comparison.status === 'behind' ? 'Indietro' : comparison.status === 'even' ? 'Pari' : comparison.status === 'waiting' ? 'Da fare' : 'Nuovo';
    return `<span class="ghost-set-status is-${comparison.status}" data-ghost-set-status title="${escapeHtml(label)}">${symbol}</span>`;
  }

  function updateGhostComparison(exerciseIndex) {
    const exercise = state.activeSession?.exercises?.[exerciseIndex];
    if (!exercise) return;
    const comparison = ghostComparison(exercise);
    const panel = document.querySelector(`[data-ghost-panel="${exerciseIndex}"]`);
    if (panel) {
      panel.className = `ghost-panel is-${comparison.status}`;
      const label = panel.querySelector('[data-ghost-label]');
      const detail = panel.querySelector('[data-ghost-detail]');
      const fill = panel.querySelector('[data-ghost-fill]');
      if (label) label.textContent = comparison.label;
      if (detail) detail.textContent = comparison.comparedSets
        ? `${formatCompact(comparison.today)} vs ${formatCompact(comparison.previous)} ${state.profile.unit}·rep su ${comparison.comparedSets} ${comparison.comparedSets === 1 ? 'serie' : 'serie'}`
        : comparison.status === 'new' ? 'Questa sessione diventerà il riferimento futuro.' : 'Compila peso e ripetizioni per iniziare il confronto.';
      if (fill) fill.style.width = `${comparison.fill}%`;
    }
    exercise.sets.forEach((set, setIndex) => {
      const cell = document.querySelector(`[data-ghost-status-cell="${exerciseIndex}-${setIndex}"]`);
      if (cell) cell.innerHTML = ghostStatusMarkup(set);
    });
  }

  function findSuggestedWorkout() {
    const options = [];
    state.plans.forEach(plan => plan.days.forEach(day => {
      const last = latestSessionForDay(plan.id, day.id);
      options.push({ plan, day, lastDate: last ? new Date(last.date).getTime() : 0 });
    }));
    options.sort((a, b) => a.lastDate - b.lastDate);
    return options[0] || null;
  }

  function render() {
    updateAccountButton();
    const { route, id } = getRoute();
    ui.route = route;
    setActiveNav(route);

    if (route === 'plan' && id) return renderPlan(id);
    if (route === 'plans') return renderPlans();
    if (route === 'calendar') return renderCalendar();
    if (route === 'workout') return renderWorkout();
    if (route === 'progress') return renderProgress();
    if (route === 'profile') return renderProfile();
    return renderHome();
  }

  function renderHome() {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekSessions = state.sessions.filter(session => new Date(session.date) >= weekStart);
    const weekVolume = weekSessions.reduce((sum, session) => sum + getSessionVolume(session), 0);
    const recordEvents = calculateRecordEvents();
    const weekPrs = recordEvents.filter(event => new Date(event.date) >= weekStart).length;
    const goal = state.profile.weeklyGoal || 3;
    const goalProgress = clamp(Math.round((weekSessions.length / goal) * 100), 0, 100);
    const recentSessions = [...state.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
    const todayKey = localDateKey(now);
    const todaySchedules = scheduledWorkoutsForDate(todayKey);
    const todayPlanned = todaySchedules.map(resolveScheduledWorkout).find(entry => entry?.item?.status === 'planned');
    const todayCompleted = todaySchedules.map(resolveScheduledWorkout).find(entry => entry?.item?.status === 'completed');
    const upcoming = upcomingScheduledWorkouts(4);
    const active = state.activeSession;

    setHeader('IL TUO ALLENAMENTO', `Ciao, ${state.profile.name.split(/\s+/)[0] || 'Atleta'}`);

    const hero = active ? `
      <section class="card hero-card hero-media-card">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="hero-kicker-dot"></span> ALLENAMENTO IN CORSO</div>
          <h2>Riprendi ${escapeHtml(active.dayName)}</h2>
          <p class="no-margin">${escapeHtml(active.planName)} · iniziato ${new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(active.startedAt))}</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="button" data-action="navigate" data-route="workout">Riprendi</button>
          <span class="hero-status-pill">Fantasma attivo</span>
        </div>
      </section>` : todayPlanned ? `
      <section class="card hero-card hero-media-card">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="hero-kicker-dot"></span> ALLENAMENTO DI OGGI</div>
          <h2>${escapeHtml(todayPlanned.day.name)}</h2>
          <p class="no-margin">${escapeHtml(todayPlanned.plan.name)} · ${todayPlanned.day.exercises.length} esercizi</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="button" data-action="start-scheduled-workout" data-schedule-id="${escapeHtml(todayPlanned.item.id)}">Inizia ora <span aria-hidden="true">›</span></button>
          <button type="button" class="button secondary" data-action="navigate" data-route="calendar">Apri calendario <span aria-hidden="true">›</span></button>
        </div>
      </section>` : todayCompleted ? `
      <section class="card hero-card hero-media-card hero-completed">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="hero-kicker-dot"></span> ALLENAMENTO COMPLETATO</div>
          <h2>${escapeHtml(todayCompleted.day.name)}</h2>
          <p class="no-margin">${escapeHtml(todayCompleted.plan.name)} · oggi hai portato a termine il programma.</p>
        </div>
        <div class="hero-actions">
          ${todayCompleted.item.sessionId ? `<button type="button" class="button" data-action="session-detail" data-session-id="${escapeHtml(todayCompleted.item.sessionId)}">Vedi sessione</button>` : ''}
          <button type="button" class="button secondary" data-action="navigate" data-route="calendar">Calendario</button>
        </div>
      </section>` : state.plans.some(plan => plan.days.some(day => day.exercises.length)) ? `
      <section class="card hero-card hero-media-card">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="hero-kicker-dot"></span> DECIDI TU IL PROGRAMMA</div>
          <h2>Nessun allenamento pianificato</h2>
          <p class="no-margin">Scegli dal calendario quale giorno della scheda vuoi eseguire oggi.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="button" data-action="schedule-workout" data-date="${escapeHtml(todayKey)}">Pianifica oggi <span aria-hidden="true">›</span></button>
          <button type="button" class="button secondary" data-action="navigate" data-route="workout">Allenamento libero</button>
        </div>
      </section>` : `
      <section class="card hero-card hero-media-card">
        <div class="hero-copy">
          <div class="hero-kicker"><span class="hero-kicker-dot"></span> PRIMO PASSO</div>
          <h2>Crea la tua prima scheda</h2>
          <p class="no-margin">Aggiungi giorni ed esercizi, poi pianificali sul calendario.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="button" data-action="new-plan">Crea scheda</button>
        </div>
      </section>`;

    const planningOverview = `
      <section class="card calendar-overview-card">
        <div class="section-header compact">
          <div>
            <p class="eyebrow">CALENDARIO</p>
            <h2 class="no-margin">La tua programmazione</h2>
          </div>
          <button type="button" class="button small secondary" data-action="navigate" data-route="calendar">Apri</button>
        </div>
        ${upcoming.length ? `<div class="calendar-upcoming-list">${upcoming.map(item => {
          const resolved = resolveScheduledWorkout(item);
          return resolved ? `<button type="button" class="calendar-upcoming-row" data-action="calendar-open-date" data-date="${escapeHtml(item.date)}">
            <span class="calendar-upcoming-date"><strong>${dateFromKey(item.date).getDate()}</strong><small>${new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(dateFromKey(item.date))}</small></span>
            <span class="grow"><strong>${escapeHtml(resolved.day.name)}</strong><small>${escapeHtml(resolved.plan.name)}</small></span>
            <span aria-hidden="true">›</span>
          </button>` : '';
        }).join('')}</div>` : `<div class="calendar-empty-inline"><span>Non hai ancora programmato le prossime sessioni.</span><button type="button" class="button small ghost" data-action="schedule-workout" data-date="${escapeHtml(todayKey)}">+ Aggiungi</button></div>`}
      </section>`;

    const accountNudge = normalizeCatalogText(state.profile.name) === 'atleta' ? `
      <section class="card account-nudge">
        <div class="account-nudge-icon">A</div>
        <div class="grow">
          <strong>Rendi VANTA davvero tua</strong>
          <p class="small muted no-margin" style="margin-top:4px">Sostituisci “Atleta” con il tuo nome: apparirà sempre in alto nell’app.</p>
        </div>
        <button type="button" class="button small secondary" data-action="edit-profile">Personalizza</button>
      </section>` : '';

    const installCard = !isStandalone() && !state.preferences.installDismissed ? `
      <section class="card install-banner">
        <div class="install-icon">⇩</div>
        <div class="grow">
          <strong>Installala come un'app</strong>
          <p class="small muted no-margin" style="margin-top:3px">Schermata Home, avvio rapido e uso offline.</p>
        </div>
        <button type="button" class="button small secondary" data-action="install-app">Installa</button>
        <button type="button" class="icon-button small subtle" data-action="dismiss-install" aria-label="Nascondi">×</button>
      </section>` : '';

    app.innerHTML = `
      <div class="stack-lg">
        ${hero}

        ${planningOverview}

        ${accountNudge}

        <section>
          <div class="section-header">
            <div>
              <h2>Questa settimana</h2>
              <p class="small muted">Da lunedì a oggi</p>
            </div>
            <div class="progress-ring" style="--progress:${goalProgress}"><span>${weekSessions.length}/${goal}</span></div>
          </div>
          <div class="stats-grid">
            <div class="card stat-card">
              <span class="stat-value">${weekSessions.length}</span>
              <span class="stat-label">Sessioni</span>
            </div>
            <div class="card stat-card">
              <span class="stat-value">${formatCompact(weekVolume)}</span>
              <span class="stat-label">Volume ${escapeHtml(state.profile.unit)}</span>
            </div>
            <div class="card stat-card">
              <span class="stat-value">${weekPrs}</span>
              <span class="stat-label">Nuovi record</span>
            </div>
          </div>
        </section>

        ${installCard}

        <section>
          <div class="section-header">
            <div>
              <h2>Ultimi allenamenti</h2>
              <p class="small muted">Il tuo diario recente</p>
            </div>
            ${recentSessions.length ? '<button type="button" class="button small ghost" data-action="navigate" data-route="progress">Tutti</button>' : ''}
          </div>
          ${recentSessions.length ? `<div class="card">${recentSessions.map(renderSessionListRow).join('')}</div>` : `
            <div class="card empty-state">
              <div class="empty-icon">↗</div>
              <h3>Nessun allenamento registrato</h3>
              <p>Quando completi una sessione, qui compariranno volume, durata e progressi.</p>
              <button type="button" class="button" data-action="navigate" data-route="workout">Inizia ad allenarti</button>
            </div>`}
        </section>
      </div>`;
  }

  function renderCalendar() {
    const month = ui.calendarMonth instanceof Date && !Number.isNaN(ui.calendarMonth.getTime())
      ? new Date(ui.calendarMonth.getFullYear(), ui.calendarMonth.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    ui.calendarMonth = month;
    ui.calendarSelectedDate = normalizeDateKey(ui.calendarSelectedDate);

    const firstGridDate = new Date(month);
    const mondayOffset = (firstGridDate.getDay() + 6) % 7;
    firstGridDate.setDate(firstGridDate.getDate() - mondayOffset);
    const cells = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstGridDate);
      date.setDate(firstGridDate.getDate() + index);
      const key = localDateKey(date);
      const schedules = scheduledWorkoutsForDate(key);
      return { date, key, schedules };
    });
    const selectedDate = dateFromKey(ui.calendarSelectedDate);
    const selectedItems = scheduledWorkoutsForDate(ui.calendarSelectedDate);
    const weekdays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    const todayKey = localDateKey(new Date());

    setHeader('PIANIFICAZIONE', 'Calendario', { label: '+', ariaLabel: 'Programma allenamento', action: 'schedule-workout', data: { date: ui.calendarSelectedDate } });

    app.innerHTML = `
      <div class="stack-lg calendar-page">
        <section class="card calendar-card">
          <div class="calendar-toolbar">
            <button type="button" class="icon-button subtle" data-action="calendar-prev-month" aria-label="Mese precedente">‹</button>
            <button type="button" class="calendar-month-title" data-action="calendar-today">
              <strong>${escapeHtml(monthTitle(month))}</strong>
              <small>Torna a oggi</small>
            </button>
            <button type="button" class="icon-button subtle" data-action="calendar-next-month" aria-label="Mese successivo">›</button>
          </div>
          <div class="calendar-grid calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
          <div class="calendar-grid calendar-days">
            ${cells.map(({ date, key, schedules }) => {
              const outside = date.getMonth() !== month.getMonth();
              const isToday = key === todayKey;
              const selected = key === ui.calendarSelectedDate;
              const completed = schedules.some(item => item.status === 'completed');
              const planned = schedules.some(item => item.status === 'planned');
              const skipped = schedules.some(item => item.status === 'skipped');
              return `<button type="button" class="calendar-day${outside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}${selected ? ' is-selected' : ''}" data-action="select-calendar-date" data-date="${escapeHtml(key)}" aria-label="${escapeHtml(formatDateLong(date))}">
                <span class="calendar-day-number">${date.getDate()}</span>
                <span class="calendar-dots" aria-hidden="true">${planned ? '<i class="is-planned"></i>' : ''}${completed ? '<i class="is-completed"></i>' : ''}${skipped ? '<i class="is-skipped"></i>' : ''}</span>
              </button>`;
            }).join('')}
          </div>
          <div class="calendar-legend">
            <span><i class="is-planned"></i> Programmato</span>
            <span><i class="is-completed"></i> Completato</span>
            <span><i class="is-skipped"></i> Saltato</span>
          </div>
        </section>

        <section>
          <div class="section-header">
            <div>
              <p class="eyebrow">GIORNO SELEZIONATO</p>
              <h2>${escapeHtml(formatDateLong(selectedDate))}</h2>
            </div>
            <button type="button" class="button small" data-action="schedule-workout" data-date="${escapeHtml(ui.calendarSelectedDate)}">+ Allenamento</button>
          </div>
          <div class="stack">
            ${selectedItems.length ? selectedItems.map(renderScheduledWorkoutCard).join('') : `
              <div class="card empty-state calendar-empty-state">
                <div class="empty-icon">▦</div>
                <h3>Giornata libera</h3>
                <p>Scegli una scheda e il relativo giorno. VANTA non dedurrà più automaticamente cosa devi allenare.</p>
                <button type="button" class="button" data-action="schedule-workout" data-date="${escapeHtml(ui.calendarSelectedDate)}">Pianifica allenamento</button>
              </div>`}
          </div>
        </section>

        <section class="card card-soft calendar-help">
          <strong>Come funziona</strong>
          <p class="small muted no-margin">Programma il giorno dal calendario. Quando lo avvii, VANTA collega la sessione alla data scelta e continua a confrontare ogni esercizio con il suo ultimo Fantasma.</p>
        </section>
      </div>`;
  }

  function renderScheduledWorkoutCard(item) {
    const resolved = resolveScheduledWorkout(item);
    if (!resolved) {
      return `<article class="card schedule-card is-missing">
        <div class="row-between"><div><strong>Scheda non più disponibile</strong><p class="small muted no-margin">Il giorno collegato è stato eliminato.</p></div><button type="button" class="button small danger" data-action="delete-schedule" data-schedule-id="${escapeHtml(item.id)}">Rimuovi</button></div>
      </article>`;
    }
    const { plan, day } = resolved;
    const status = scheduleStatusLabel(item.status);
    return `<article class="card schedule-card is-${escapeHtml(item.status)}">
      <div class="row-between schedule-card-head">
        <div class="grow">
          <p class="eyebrow">${escapeHtml(plan.name).toUpperCase()}</p>
          <h3>${escapeHtml(day.name)}</h3>
          <p class="small muted no-margin">${day.exercises.length} esercizi${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</p>
        </div>
        <span class="schedule-status is-${escapeHtml(item.status)}">${escapeHtml(status)}</span>
      </div>
      <div class="exercise-meta schedule-exercises">${day.exercises.slice(0, 5).map(exercise => `<span class="badge">${escapeHtml(exercise.name)}</span>`).join('')}${day.exercises.length > 5 ? `<span class="badge">+${day.exercises.length - 5}</span>` : ''}</div>
      <div class="row wrap schedule-actions">
        ${item.status === 'completed' && item.sessionId ? `<button type="button" class="button small" data-action="session-detail" data-session-id="${escapeHtml(item.sessionId)}">Vedi sessione</button>` : ''}
        ${item.status !== 'completed' ? `<button type="button" class="button small" data-action="start-scheduled-workout" data-schedule-id="${escapeHtml(item.id)}">${item.status === 'skipped' ? 'Allenati comunque' : 'Inizia'}</button>` : ''}
        ${item.status === 'planned' ? `<button type="button" class="button small secondary" data-action="edit-schedule" data-schedule-id="${escapeHtml(item.id)}">Modifica</button><button type="button" class="button small ghost" data-action="skip-schedule" data-schedule-id="${escapeHtml(item.id)}">Segna saltato</button>` : ''}
        ${item.status === 'skipped' ? `<button type="button" class="button small secondary" data-action="restore-schedule" data-schedule-id="${escapeHtml(item.id)}">Ripristina</button>` : ''}
        <button type="button" class="button small ghost" data-action="delete-schedule" data-schedule-id="${escapeHtml(item.id)}">Rimuovi</button>
      </div>
    </article>`;
  }

  function openScheduleWorkoutModal(dateKey = ui.calendarSelectedDate, scheduleId = '') {
    const existing = scheduleId ? getScheduledWorkout(scheduleId) : null;
    const available = state.plans.flatMap(plan => plan.days
      .filter(day => day.exercises.length)
      .map(day => ({ plan, day })));
    if (!available.length) {
      toast('Crea prima una scheda con almeno un esercizio.', 'error');
      navigate('plans');
      return;
    }
    const selectedValue = existing ? `${existing.planId}::${existing.dayId}` : `${available[0].plan.id}::${available[0].day.id}`;
    openModal({
      eyebrow: existing ? 'MODIFICA CALENDARIO' : 'PIANIFICA',
      title: existing ? 'Modifica allenamento' : 'Scegli l’allenamento',
      body: `
        <div class="form-grid">
          <div class="input-group">
            <label for="schedule-date">Data</label>
            <input id="schedule-date" class="input" name="date" type="date" required value="${escapeHtml(existing?.date || normalizeDateKey(dateKey))}">
          </div>
          <div class="input-group">
            <label for="schedule-workout-choice">Scheda e giorno</label>
            <select id="schedule-workout-choice" class="select" name="choice" required>
              ${available.map(({ plan, day }) => {
                const value = `${plan.id}::${day.id}`;
                return `<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(plan.name)} — ${escapeHtml(day.name)}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="input-group">
            <label for="schedule-notes">Nota facoltativa</label>
            <textarea id="schedule-notes" class="textarea" name="notes" placeholder="Esempio: allenamento serale, palestra diversa…">${escapeHtml(existing?.notes || '')}</textarea>
          </div>
        </div>`,
      actions: `<button type="button" class="button secondary" data-action="close-modal">Annulla</button><button type="submit" class="button" value="save">${existing ? 'Salva modifiche' : 'Aggiungi al calendario'}</button>`,
      onSubmit: form => {
        const selectedDate = normalizeDateKey(form.get('date'));
        const [planId, dayId] = String(form.get('choice') || '').split('::');
        const plan = getPlan(planId);
        const day = getDay(planId, dayId);
        if (!plan || !day) {
          toast('La scheda selezionata non è più disponibile.', 'error');
          return;
        }
        if (state.scheduledWorkouts.some(item => item.id !== existing?.id && item.date === selectedDate && item.planId === planId && item.dayId === dayId && item.status !== 'completed')) {
          toast('Questo allenamento è già presente nella data scelta.', 'error');
          return;
        }
        if (existing) {
          existing.date = selectedDate;
          existing.planId = planId;
          existing.dayId = dayId;
          existing.notes = String(form.get('notes') || '').trim();
        } else {
          state.scheduledWorkouts.push(normalizeScheduledWorkout({
            id: uid('schedule'),
            date: selectedDate,
            planId,
            dayId,
            notes: String(form.get('notes') || '').trim(),
            status: 'planned',
            createdAt: new Date().toISOString(),
          }));
        }
        ui.calendarSelectedDate = selectedDate;
        ui.calendarMonth = new Date(dateFromKey(selectedDate).getFullYear(), dateFromKey(selectedDate).getMonth(), 1);
        saveState();
        closeModal();
        if (getRoute().route !== 'calendar') navigate('calendar');
        else renderCalendar();
        toast(existing ? 'Programmazione aggiornata.' : 'Allenamento programmato.', 'success');
      },
    });
  }

  function deleteScheduledWorkout(scheduleId) {
    const item = getScheduledWorkout(scheduleId);
    if (!item) return;
    confirmModal({
      title: 'Rimuovere dal calendario?',
      message: item.status === 'completed' ? 'La sessione nello storico non verrà eliminata.' : 'La programmazione verrà rimossa. La scheda resterà disponibile.',
      confirmLabel: 'Rimuovi',
      danger: true,
      onConfirm: () => {
        state.scheduledWorkouts = state.scheduledWorkouts.filter(entry => entry.id !== scheduleId);
        if (state.activeSession?.scheduleId === scheduleId) state.activeSession.scheduleId = '';
        saveState();
        renderCalendar();
        toast('Programmazione rimossa.', 'success');
      },
    });
  }

  function renderSessionListRow(session) {
    return `
      <div class="list-row session-card" data-action="session-detail" data-session-id="${escapeHtml(session.id)}">
        <div class="list-index">${new Date(session.date).getDate()}</div>
        <div class="grow">
          <strong>${escapeHtml(session.dayName || 'Allenamento')}</strong>
          <p class="small muted no-margin" style="margin-top:3px">${formatDate(session.date, { year: true })} · ${formatDuration(session.durationMin)} · ${getSessionSets(session)} serie</p>
        </div>
        <div style="text-align:right">
          <strong>${formatCompact(getSessionVolume(session))}</strong>
          <p class="tiny muted no-margin">volume</p>
        </div>
      </div>`;
  }

  function renderPlans() {
    setHeader('PROGRAMMA', 'Le tue schede', { label: '+', ariaLabel: 'Nuova scheda', action: 'new-plan' });
    const plans = state.plans;

    app.innerHTML = `
      <div class="stack-lg">
        <section class="card card-soft">
          <div class="row-between wrap">
            <div class="grow">
              <strong>Organizza la settimana</strong>
              <p class="small muted no-margin" style="margin-top:4px">Crea una scheda manualmente oppure importa esercizi, serie e ripetizioni da file, foto, Word o Note.</p>
            </div>
            <div class="row wrap">
              <button type="button" class="button small secondary" data-action="import-workout">Importa scheda</button>
              <button type="button" class="button small" data-action="new-plan">Nuova</button>
            </div>
          </div>
        </section>

        <section class="stack">
          ${plans.length ? plans.map(plan => {
            const exerciseCount = plan.days.reduce((sum, day) => sum + day.exercises.length, 0);
            const lastSession = [...state.sessions]
              .filter(session => session.planId === plan.id)
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            return `
              <article class="card plan-card" data-action="open-plan" data-plan-id="${escapeHtml(plan.id)}">
                <div class="row">
                  <div class="plan-icon">P</div>
                  <div class="grow">
                    <h3 class="no-margin">${escapeHtml(plan.name)}</h3>
                    <p class="small muted no-margin" style="margin-top:4px">${plan.description ? escapeHtml(plan.description) : 'Nessuna descrizione'}</p>
                  </div>
                  <span class="subtle-text">›</span>
                </div>
                <div class="exercise-meta" style="margin-top:14px">
                  <span class="badge accent">${plan.days.length} ${plan.days.length === 1 ? 'giorno' : 'giorni'}</span>
                  <span class="badge">${exerciseCount} ${exerciseCount === 1 ? 'esercizio' : 'esercizi'}</span>
                  ${lastSession ? `<span class="badge">Ultima: ${formatDate(lastSession.date)}</span>` : '<span class="badge">Mai usata</span>'}
                </div>
              </article>`;
          }).join('') : `
            <div class="card empty-state">
              <div class="empty-icon">▤</div>
              <h2>Crea una scheda</h2>
              <p>Importa schede da PDF, fotografie, Word, fogli di calcolo, presentazioni, file di testo o Note incollate.</p>
              <div class="row wrap" style="justify-content:center">
                <button type="button" class="button secondary" data-action="import-workout">Importa scheda</button>
                <button type="button" class="button" data-action="new-plan">Nuova scheda</button>
              </div>
            </div>`}
        </section>
      </div>`;
  }

  function renderPlan(planId) {
    const plan = getPlan(planId);
    if (!plan) {
      toast('Scheda non trovata.', 'error');
      navigate('plans');
      return;
    }

    setHeader('SCHEDA', plan.name, { label: '•••', ariaLabel: 'Opzioni scheda', action: 'plan-options', data: { planId } });

    app.innerHTML = `
      <div class="stack-lg">
        <section class="card workout-header-card">
          <div class="row-between">
            <div class="grow">
              <p class="eyebrow">PROGRAMMA ATTIVO</p>
              <h2 style="margin:6px 0 4px">${escapeHtml(plan.name)}</h2>
              <p class="muted no-margin">${plan.description ? escapeHtml(plan.description) : 'Aggiungi una descrizione per ricordare l’obiettivo della scheda.'}</p>
            </div>
          </div>
          <div class="exercise-meta" style="margin-top:16px">
            <span class="badge accent">${plan.days.length} ${plan.days.length === 1 ? 'giorno' : 'giorni'}</span>
            <span class="badge">${plan.days.reduce((sum, day) => sum + day.exercises.length, 0)} esercizi</span>
          </div>
          <div class="row wrap" style="margin-top:16px">
            <button type="button" class="button small secondary" data-action="edit-plan" data-plan-id="${escapeHtml(plan.id)}">Modifica info</button>
            <button type="button" class="button small secondary" data-action="share-plan" data-plan-id="${escapeHtml(plan.id)}">Condividi</button>
            <button type="button" class="button small ghost" data-action="add-day" data-plan-id="${escapeHtml(plan.id)}">+ Giorno</button>
          </div>
        </section>

        <section>
          <div class="section-header">
            <div>
              <h2>Giorni di allenamento</h2>
              <p class="small muted">Tocca un giorno per gestire gli esercizi</p>
            </div>
          </div>
          <div class="stack">
            ${plan.days.length ? plan.days.map((day, dayIndex) => renderDayEditor(plan, day, dayIndex)).join('') : `
              <div class="card empty-state">
                <div class="empty-icon">＋</div>
                <h3>Nessun giorno</h3>
                <p>Aggiungi il primo giorno e poi inserisci gli esercizi.</p>
                <button type="button" class="button" data-action="add-day" data-plan-id="${escapeHtml(plan.id)}">Aggiungi giorno</button>
              </div>`}
          </div>
        </section>
      </div>`;
  }

  function renderDayEditor(plan, day, dayIndex) {
    const expanded = ui.expandedDays.has(day.id) || plan.days.length === 1;
    return `
      <article class="card day-card">
        <div class="row-between" data-action="toggle-day" data-day-id="${escapeHtml(day.id)}">
          <div class="row grow">
            <div class="list-index">${dayIndex + 1}</div>
            <div class="grow">
              <h3 class="no-margin">${escapeHtml(day.name)}</h3>
              <p class="small muted no-margin" style="margin-top:3px">${day.exercises.length} ${day.exercises.length === 1 ? 'esercizio' : 'esercizi'}${day.notes ? ` · ${escapeHtml(day.notes)}` : ''}</p>
            </div>
          </div>
          <span class="subtle-text">${expanded ? '⌃' : '⌄'}</span>
        </div>

        ${expanded ? `
          <hr class="divider">
          <div class="row wrap" style="margin-bottom:14px">
            <button type="button" class="button small" data-action="start-workout" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}" ${day.exercises.length ? '' : 'disabled'}>Inizia</button>
            <button type="button" class="button small secondary" data-action="add-exercise" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}">+ Esercizio</button>
            <button type="button" class="button small ghost" data-action="edit-day" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}">Modifica giorno</button>
          </div>
          <div>
            ${day.exercises.length ? day.exercises.map((exercise, index) => `
              <div class="exercise-card card-soft">
                <div class="row-between">
                  <div class="grow">
                    <strong>${escapeHtml(exercise.name)}</strong>
                    <div class="exercise-meta">
                      <span class="badge accent">${escapeHtml(exercisePrescriptionLabel(exercise))}</span>
                      ${exercise.muscle ? `<span class="badge">${escapeHtml(exercise.muscle)}</span>` : ''}
                      ${exercise.rest ? `<span class="badge">${exercise.rest}s recupero</span>` : ''}
                    </div>
                    ${exercise.notes ? `<p class="small muted no-margin" style="margin-top:8px">${escapeHtml(exercise.notes)}</p>` : ''}
                  </div>
                  <div class="drag-controls">
                    <button type="button" class="icon-button small subtle" data-action="move-exercise" data-direction="up" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="Sposta su" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="icon-button small subtle" data-action="move-exercise" data-direction="down" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="Sposta giù" ${index === day.exercises.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="icon-button small info" data-action="exercise-info" data-exercise-name="${escapeHtml(exercise.name)}" data-catalog-id="${escapeHtml(exercise.catalogId || '')}" data-catalog-mode="${escapeHtml(exercise.catalogMode || 'auto')}" data-muscle="${escapeHtml(exercise.muscle || '')}" data-video-url="${escapeHtml(exercise.videoUrl || '')}" aria-label="Tecnica e video di ${escapeHtml(exercise.name)}">i</button>
                    <button type="button" class="icon-button small" data-action="edit-exercise" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="Modifica esercizio">✎</button>
                  </div>
                </div>
              </div>`).join('') : `
              <div class="card-soft center">
                <p class="small muted no-margin">Nessun esercizio. Aggiungi il primo per poter iniziare.</p>
              </div>`}
          </div>` : ''}
      </article>`;
  }

  function startWorkout(planId, dayId, options = {}) {
    const plan = getPlan(planId);
    const day = getDay(planId, dayId);
    if (!plan || !day) {
      toast('Allenamento non trovato.', 'error');
      return;
    }
    if (!day.exercises.length) {
      toast('Aggiungi almeno un esercizio prima di iniziare.', 'error');
      return;
    }

    const begin = () => {
      const startedAt = new Date().toISOString();
      const schedule = options.scheduleId ? getScheduledWorkout(options.scheduleId) : null;
      const sessionDate = schedule ? sessionDateForSchedule(schedule.date) : startedAt;
      if (schedule && schedule.status === 'skipped') schedule.status = 'planned';
      state.activeSession = {
        id: uid('session'),
        planId: plan.id,
        dayId: day.id,
        planName: plan.name,
        dayName: day.name,
        date: sessionDate,
        startedAt,
        scheduleId: schedule?.id || '',
        scheduledDate: schedule?.date || '',
        notes: '',
        exercises: day.exercises.map(exercise => {
          const snapshot = previousExerciseSnapshot(exercise.name, exercise.catalogId, exercise.catalogMode, exercise.muscle);
          const previous = snapshot?.exercise || null;
          return {
            exerciseId: exercise.id,
            name: exercise.name,
            muscle: exercise.muscle,
            catalogId: catalogEntryForExercise(exercise)?.id || '',
            catalogMode: exercise.catalogMode || 'auto',
            videoUrl: exercise.videoUrl || '',
            targetSets: exercise.sets,
            targetScheme: exercise.setScheme || String(exercise.sets),
            targetReps: exercise.reps,
            rest: exercise.rest,
            notes: exercise.notes,
            ghostDate: snapshot?.session?.date || '',
            sets: exercise.setTargets.map((target, index) => {
              const previousSet = previousSetForTarget(previous, target, index);
              return {
                id: uid('set'),
                weight: '',
                reps: '',
                completed: false,
                targetLabel: target.label || String(index + 1),
                targetReps: target.reps || exercise.reps,
                setType: target.type || 'standard',
                previousWeight: previousSet?.weight ?? '',
                previousReps: previousSet?.reps ?? '',
                previousLabel: previousSet?.targetLabel || target.label || String(index + 1),
              };
            }),
          };
        }),
      };
      saveState();
      navigate('workout');
      toast('Allenamento avviato.', 'success');
    };

    if (state.activeSession) {
      confirmModal({
        title: 'Sostituire la sessione in corso?',
        message: `Hai già iniziato “${state.activeSession.dayName}”. I dati non completati verranno eliminati.`,
        confirmLabel: 'Sostituisci',
        danger: true,
        onConfirm: begin,
      });
    } else {
      begin();
    }
  }

  function renderWorkout() {
    if (!state.activeSession) return renderWorkoutPicker();
    return renderActiveWorkout();
  }

  function renderWorkoutPicker() {
    setHeader('ALLENAMENTO', 'Scegli una sessione');
    const available = state.plans.flatMap(plan => plan.days.map(day => ({ plan, day })));
    const todayKey = localDateKey(new Date());
    const todayScheduled = scheduledWorkoutsForDate(todayKey).map(resolveScheduledWorkout).filter(entry => entry?.item?.status === 'planned');

    app.innerHTML = `
      <div class="stack-lg">
        <section class="card hero-card hero-media-card workout-picker-hero">
          <div class="hero-copy">
            <div class="hero-kicker"><span class="hero-kicker-dot"></span> SFIDA IL TUO FANTASMA</div>
            <h2>Pronto a superarti?</h2>
            <p class="no-margin">Durante ogni esercizio vedrai Oggi e Ultima volta affiancati, con il confronto in tempo reale.</p>
          </div>
        </section>

        ${todayScheduled.length ? `<section>
          <div class="section-header"><div><p class="eyebrow">CALENDARIO</p><h2>Programmato per oggi</h2></div><button type="button" class="button small secondary" data-action="navigate" data-route="calendar">Calendario</button></div>
          <div class="stack">${todayScheduled.map(({ item }) => renderScheduledWorkoutCard(item)).join('')}</div>
        </section>` : `<section class="card card-soft row-between wrap"><div><strong>Nessun allenamento programmato oggi</strong><p class="small muted no-margin" style="margin-top:4px">Puoi pianificarne uno oppure iniziare liberamente da una scheda.</p></div><button type="button" class="button small secondary" data-action="schedule-workout" data-date="${escapeHtml(todayKey)}">Pianifica</button></section>`}

        <section>
          <div class="section-header">
            <div>
              <h2>Allenamento libero</h2>
              <p class="small muted">Scegli un giorno senza aggiungerlo al calendario</p>
            </div>
          </div>
          <div class="stack">
            ${available.length ? available.map(({ plan, day }) => {
              const last = latestSessionForDay(plan.id, day.id);
              return `
                <article class="card day-card">
                  <div class="row-between">
                    <div class="grow">
                      <p class="eyebrow">${escapeHtml(plan.name).toUpperCase()}</p>
                      <h3 style="margin:5px 0 4px">${escapeHtml(day.name)}</h3>
                      <p class="small muted no-margin">${day.exercises.length} esercizi${last ? ` · ultima ${formatDate(last.date)}` : ' · mai eseguita'}</p>
                    </div>
                    <button type="button" class="button small" data-action="start-workout" data-plan-id="${escapeHtml(plan.id)}" data-day-id="${escapeHtml(day.id)}" ${day.exercises.length ? '' : 'disabled'}>Inizia</button>
                  </div>
                  ${day.exercises.length ? `<div class="exercise-meta" style="margin-top:12px">${day.exercises.slice(0, 4).map(exercise => `<span class="badge">${escapeHtml(exercise.name)}</span>`).join('')}${day.exercises.length > 4 ? `<span class="badge">+${day.exercises.length - 4}</span>` : ''}</div>` : '<p class="small muted no-margin" style="margin-top:10px">Aggiungi esercizi dalla sezione Schede.</p>'}
                </article>`;
            }).join('') : `
              <div class="card empty-state">
                <div class="empty-icon">＋</div>
                <h2>Nessuna sessione disponibile</h2>
                <p>Crea una scheda con almeno un giorno e un esercizio.</p>
                <button type="button" class="button" data-action="new-plan">Crea scheda</button>
              </div>`}
          </div>
        </section>
      </div>`;
  }

  function renderActiveWorkout() {
    const session = state.activeSession;
    setHeader('SESSIONE IN CORSO', session.dayName);
    const completedSets = getSessionSets(session);
    const totalSets = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    const progress = totalSets ? Math.round((completedSets / totalSets) * 100) : 0;

    app.innerHTML = `
      <div class="stack-lg">
        <section class="card workout-header-card">
          <div class="row-between">
            <div class="grow">
              <p class="eyebrow">${escapeHtml(session.planName).toUpperCase()}</p>
              <h2 style="margin:6px 0 4px">${escapeHtml(session.dayName)}</h2>
              <p class="small muted no-margin">${formatDateLong(session.date)}${session.scheduledDate ? ' · dal calendario' : ''}</p>
            </div>
            <div class="progress-ring" style="--progress:${progress}"><span>${progress}%</span></div>
          </div>
          <div class="row-between" style="margin-top:18px">
            <div>
              <p class="tiny muted no-margin">DURATA</p>
              <div class="timer" id="workout-timer">${formatElapsed(Date.now() - new Date(session.startedAt).getTime())}</div>
            </div>
            <div id="rest-timer-container"></div>
            <div style="text-align:right">
              <p class="tiny muted no-margin">VOLUME</p>
              <strong id="live-volume">${formatCompact(getSessionVolume(session))} ${escapeHtml(state.profile.unit)}</strong>
            </div>
          </div>
          <div class="row wrap" style="margin-top:16px">
            <button type="button" class="button small" data-action="finish-workout">Completa</button>
            <button type="button" class="button small danger" data-action="abandon-workout">Abbandona</button>
          </div>
        </section>

        <section class="stack">
          ${session.exercises.map((exercise, exerciseIndex) => renderWorkoutExercise(exercise, exerciseIndex)).join('')}
        </section>

        <section class="card">
          <div class="input-group">
            <label for="session-notes">Note della sessione</label>
            <textarea id="session-notes" class="textarea" data-field="session-notes" placeholder="Sensazioni, tecnica, energia…">${escapeHtml(session.notes || '')}</textarea>
          </div>
        </section>

        <button type="button" class="button block" data-action="finish-workout">Completa allenamento</button>
      </div>`;

    updateTimers();
  }

  function renderWorkoutExercise(exercise, exerciseIndex) {
    const validSets = exercise.sets.filter(set => set.completed && toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
    const isComplete = validSets.length === exercise.sets.length && exercise.sets.length > 0;
    const previousAvailable = exercise.sets.some(set => toNumber(set.previousWeight) > 0 || toNumber(set.previousReps) > 0);
    const ghost = ghostComparison(exercise);
    const catalog = catalogEntryForExercise(exercise);
    const ghostDate = exercise.ghostDate ? formatDate(exercise.ghostDate, { year: true }) : '';
    const ghostDetail = ghost.comparedSets
      ? `${formatCompact(ghost.today)} vs ${formatCompact(ghost.previous)} ${state.profile.unit}·rep su ${ghost.comparedSets} ${ghost.comparedSets === 1 ? 'serie' : 'serie'}`
      : ghost.status === 'new' ? 'Questa sessione diventerà il riferimento futuro.' : 'Compila peso e ripetizioni per iniziare il confronto.';

    return `
      <article class="card exercise-card ${isComplete ? 'is-complete' : ''}" data-exercise-index="${exerciseIndex}">
        <div class="row-between exercise-heading">
          <div class="grow">
            <h3 class="no-margin">${escapeHtml(exercise.name)}</h3>
            <div class="exercise-meta">
              <span class="badge accent">Target ${escapeHtml(exercise.targetScheme || exercise.targetSets)} · ${escapeHtml(exercise.targetReps)}</span>
              ${exercise.muscle ? `<span class="badge">${escapeHtml(exercise.muscle)}</span>` : ''}
              ${catalog ? '<span class="badge knowledge-badge">Guida disponibile</span>' : ''}
            </div>
          </div>
          <div class="exercise-heading-actions">
            <button type="button" class="icon-button small info" data-action="exercise-info" data-exercise-name="${escapeHtml(exercise.name)}" data-catalog-id="${escapeHtml(exercise.catalogId || '')}" data-catalog-mode="${escapeHtml(exercise.catalogMode || 'auto')}" data-muscle="${escapeHtml(exercise.muscle || '')}" data-video-url="${escapeHtml(exercise.videoUrl || '')}" aria-label="Tecnica e video di ${escapeHtml(exercise.name)}">i</button>
            ${exercise.rest ? `<button type="button" class="button small secondary" data-action="start-rest" data-seconds="${exercise.rest}" data-label="${escapeHtml(exercise.name)}">${exercise.rest}s</button>` : ''}
          </div>
        </div>
        ${exercise.notes ? `<p class="small muted exercise-notes">${escapeHtml(exercise.notes)}</p>` : ''}

        <div class="ghost-panel is-${ghost.status}" data-ghost-panel="${exerciseIndex}">
          <div class="ghost-panel-head">
            <div>
              <span class="ghost-kicker">FANTASMA${ghostDate ? ` · ${escapeHtml(ghostDate)}` : ''}</span>
              <strong data-ghost-label>${escapeHtml(ghost.label)}</strong>
            </div>
            <span class="ghost-icon" aria-hidden="true">◌</span>
          </div>
          <div class="ghost-track" aria-hidden="true">
            <span class="ghost-fill" data-ghost-fill style="width:${ghost.fill}%"></span>
            <span class="ghost-finish"></span>
          </div>
          <p class="tiny muted no-margin" data-ghost-detail>${escapeHtml(ghostDetail)}</p>
        </div>

        <div class="set-table-wrap">
          <table class="set-table ghost-set-table">
            <thead>
              <tr>
                <th class="set-col">Serie</th>
                <th>Oggi</th>
                <th>Ultima volta</th>
                <th class="check-col">OK</th>
              </tr>
            </thead>
            <tbody>
              ${exercise.sets.map((set, setIndex) => {
                const hasPrevious = toNumber(set.previousWeight) > 0 || toNumber(set.previousReps) > 0;
                return `
                <tr class="${setRowClass(set.setType)}">
                  <td class="set-number"><input class="set-label-input" type="text" maxlength="12" value="${escapeHtml(set.targetLabel || String(setIndex + 1))}" data-set-field="label" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="Etichetta serie ${setIndex + 1}"></td>
                  <td>
                    <div class="today-set-inputs">
                      <label class="mini-set-field"><input class="set-input" inputmode="decimal" type="number" step="0.5" min="0" placeholder="0" value="${escapeHtml(set.weight)}" data-set-field="weight" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="Peso serie ${setIndex + 1}"><span>${escapeHtml(state.profile.unit)}</span></label>
                      <span class="set-times" aria-hidden="true">×</span>
                      <label class="mini-set-field reps"><input class="set-input" inputmode="numeric" type="number" step="1" min="0" placeholder="${escapeHtml(repPlaceholder(set.targetReps || exercise.targetReps))}" value="${escapeHtml(set.reps)}" data-set-field="reps" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="Ripetizioni serie ${setIndex + 1}"><span>rip</span></label>
                    </div>
                    <span class="set-target">Target ${escapeHtml(set.targetReps || exercise.targetReps || '')}</span>
                  </td>
                  <td class="ghost-previous-cell">
                    <div class="ghost-previous-value">${hasPrevious ? `${formatNumber(set.previousWeight)} <span>${escapeHtml(state.profile.unit)}</span> × ${formatNumber(set.previousReps, 0)}` : '—'}</div>
                    <div class="ghost-set-meta">
                      ${hasPrevious && set.previousLabel ? `<span>${escapeHtml(set.previousLabel)}</span>` : '<span>Nessun dato</span>'}
                      <span data-ghost-status-cell="${exerciseIndex}-${setIndex}">${ghostStatusMarkup(set)}</span>
                    </div>
                  </td>
                  <td class="set-check"><input class="set-checkbox" type="checkbox" ${set.completed ? 'checked' : ''} data-set-field="completed" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="Completa serie ${setIndex + 1}"></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="row wrap exercise-actions">
          <button type="button" class="button small ghost" data-action="add-set" data-exercise-index="${exerciseIndex}">+ Serie</button>
          ${exercise.sets.length > 1 ? `<button type="button" class="button small ghost" data-action="remove-set" data-exercise-index="${exerciseIndex}">− Serie</button>` : ''}
          ${previousAvailable ? `<button type="button" class="button small secondary" data-action="copy-previous" data-exercise-index="${exerciseIndex}">Copia Fantasma</button>` : ''}
          <button type="button" class="button small secondary" data-action="exercise-info" data-exercise-name="${escapeHtml(exercise.name)}" data-catalog-id="${escapeHtml(exercise.catalogId || '')}" data-catalog-mode="${escapeHtml(exercise.catalogMode || 'auto')}" data-muscle="${escapeHtml(exercise.muscle || '')}" data-video-url="${escapeHtml(exercise.videoUrl || '')}">Tecnica e video</button>
        </div>
      </article>`;
  }

  function updateActiveWorkoutSummary() {
    if (!state.activeSession) return;
    const volume = document.querySelector('#live-volume');
    if (volume) volume.textContent = `${formatCompact(getSessionVolume(state.activeSession))} ${state.profile.unit}`;
    const completedSets = getSessionSets(state.activeSession);
    const totalSets = state.activeSession.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    const progress = totalSets ? Math.round((completedSets / totalSets) * 100) : 0;
    const ring = document.querySelector('.workout-header-card .progress-ring');
    if (ring) {
      ring.style.setProperty('--progress', progress);
      const span = ring.querySelector('span');
      if (span) span.textContent = `${progress}%`;
    }
    document.querySelectorAll('[data-exercise-index]').forEach(card => {
      if (!card.classList.contains('exercise-card')) return;
      const index = Number(card.dataset.exerciseIndex);
      const exercise = state.activeSession.exercises[index];
      const isComplete = exercise?.sets?.length > 0 && exercise.sets.every(set => set.completed && toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
      card.classList.toggle('is-complete', Boolean(isComplete));
      updateGhostComparison(index);
    });
  }

  function updateTimers() {
    const workoutTimer = document.querySelector('#workout-timer');
    if (workoutTimer && state.activeSession) {
      workoutTimer.textContent = formatElapsed(Date.now() - new Date(state.activeSession.startedAt).getTime());
    }
    const restContainer = document.querySelector('#rest-timer-container');
    if (!restContainer) return;
    if (!restTimer) {
      restContainer.innerHTML = '';
      return;
    }
    const remaining = Math.max(0, Math.ceil((restTimer.endsAt - Date.now()) / 1000));
    if (remaining <= 0) {
      if ('vibrate' in navigator) navigator.vibrate?.([120, 70, 120]);
      toast('Recupero terminato.', 'success');
      restTimer = null;
      restContainer.innerHTML = '';
      return;
    }
    restContainer.innerHTML = `
      <button type="button" class="button small secondary" data-action="cancel-rest">
        Recupero ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}
      </button>`;
  }

  function openFinishWorkoutModal() {
    const session = state.activeSession;
    if (!session) return;
    const validSets = getSessionSets(session);
    if (!validSets) {
      toast('Inserisci almeno una serie con peso e ripetizioni.', 'error');
      return;
    }
    const durationMin = Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000));
    const volume = getSessionVolume(session);
    openModal({
      eyebrow: 'SESSIONE COMPLETATA',
      title: 'Ottimo lavoro',
      body: `
        <div class="stats-grid">
          <div class="card-soft stat-card"><span class="stat-value">${validSets}</span><span class="stat-label">Serie</span></div>
          <div class="card-soft stat-card"><span class="stat-value">${formatCompact(volume)}</span><span class="stat-label">Volume</span></div>
          <div class="card-soft stat-card"><span class="stat-value">${durationMin}</span><span class="stat-label">Minuti</span></div>
        </div>
        <p class="small muted" style="margin:16px 0 0;line-height:1.5">La sessione verrà aggiunta allo storico e aggiornerà i grafici dei progressi.</p>`,
      actions: `
        <button type="button" class="button secondary" data-action="close-modal">Torna indietro</button>
        <button type="submit" class="button" value="save">Salva sessione</button>`,
      onSubmit: () => {
        const completed = deepClone(state.activeSession);
        completed.endedAt = new Date().toISOString();
        completed.durationMin = durationMin;
        completed.exercises = completed.exercises.map(exercise => ({
          ...exercise,
          sets: exercise.sets.map(set => ({
            id: set.id || uid('set'),
            weight: toNumber(set.weight),
            reps: Math.round(toNumber(set.reps)),
            completed: Boolean(set.completed && toNumber(set.weight) > 0 && toNumber(set.reps) > 0),
            targetLabel: String(set.targetLabel || ''),
            targetReps: String(set.targetReps || ''),
            setType: setTypeFromLabel(set.targetLabel, set.setType),
          })),
        }));
        state.sessions.push(completed);
        if (completed.scheduleId) {
          const scheduled = getScheduledWorkout(completed.scheduleId);
          if (scheduled) {
            scheduled.status = 'completed';
            scheduled.sessionId = completed.id;
            scheduled.completedAt = completed.endedAt;
          }
        }
        state.activeSession = null;
        saveState();
        closeModal();
        navigate('progress');
        toast('Sessione salvata.', 'success');
      },
    });
  }

  function getExerciseOptions() {
    const latest = new Map();
    state.sessions.forEach(session => {
      (session.exercises || []).forEach(exercise => {
        const key = exerciseKey(exercise);
        const time = new Date(session.date).getTime();
        const catalog = catalogEntryForExercise(exercise);
        const name = catalog?.name || exercise.name;
        if (!latest.has(key) || time > latest.get(key).time) latest.set(key, { key, name, time });
      });
    });
    return [...latest.values()].sort((a, b) => b.time - a.time);
  }

  function getExercisePoints(exerciseKeyValue) {
    return [...state.sessions]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(session => {
        const exercise = (session.exercises || []).find(item => exerciseKey(item) === exerciseKeyValue);
        if (!exercise) return null;
        const validSets = (exercise.sets || []).filter(set => set.completed !== false && toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
        if (!validSets.length) return null;
        const weight = Math.max(...validSets.map(set => toNumber(set.weight)));
        const oneRm = Math.max(...validSets.map(set => e1rm(set.weight, set.reps)));
        const volume = validSets.reduce((sum, set) => sum + toNumber(set.weight) * toNumber(set.reps), 0);
        const bestSet = [...validSets].sort((a, b) => e1rm(b.weight, b.reps) - e1rm(a.weight, a.reps))[0];
        return {
          sessionId: session.id,
          date: session.date,
          weight,
          e1rm: oneRm,
          volume,
          bestWeight: toNumber(bestSet.weight),
          bestReps: toNumber(bestSet.reps),
        };
      })
      .filter(Boolean);
  }

  function filterPointsByRange(points, range) {
    if (range === 'all') return points;
    const cutoff = dateDaysAgo(Number(range));
    return points.filter(point => new Date(point.date) >= cutoff);
  }

  function renderProgress() {
    setHeader('ANALISI', 'I tuoi progressi');
    const exerciseOptions = getExerciseOptions();
    if (!exerciseOptions.length) {
      app.innerHTML = `
        <div class="stack-lg">
          <section class="card empty-state">
            <div class="empty-icon">↗</div>
            <h2>I grafici nasceranno qui</h2>
            <p>Completa almeno un allenamento con peso e ripetizioni per vedere carico, volume e stima del massimale.</p>
            <button type="button" class="button" data-action="navigate" data-route="workout">Registra un allenamento</button>
          </section>
          <section class="card">
            <div class="row-between">
              <div>
                <strong>Hai già dati altrove?</strong>
                <p class="small muted no-margin" style="margin-top:4px">Importa un backup VANTA dalla sezione Profilo.</p>
              </div>
              <button type="button" class="button small secondary" data-action="navigate" data-route="profile">Profilo</button>
            </div>
          </section>
        </div>`;
      return;
    }

    if (!ui.progressExercise || !exerciseOptions.some(option => option.key === ui.progressExercise)) {
      ui.progressExercise = exerciseOptions[0].key;
    }
    const selectedExercise = exerciseOptions.find(option => option.key === ui.progressExercise) || exerciseOptions[0];
    const allPoints = getExercisePoints(ui.progressExercise);
    const points = filterPointsByRange(allPoints, ui.progressRange);
    const metric = ui.progressMetric;
    const metricInfo = {
      weight: { label: 'Carico migliore', unit: state.profile.unit, key: 'weight' },
      e1rm: { label: 'Massimale stimato', unit: state.profile.unit, key: 'e1rm' },
      volume: { label: 'Volume esercizio', unit: `${state.profile.unit}·rep`, key: 'volume' },
    }[metric];
    const values = points.map(point => point[metricInfo.key]);
    const latestValue = values.at(-1) || 0;
    const previousValue = values.at(-2) || 0;
    const deltaPct = previousValue ? ((latestValue - previousValue) / previousValue) * 100 : 0;
    const allValues = allPoints.map(point => point[metricInfo.key]);
    const bestValue = allValues.length ? Math.max(...allValues) : 0;

    const totalVolume = state.sessions.reduce((sum, session) => sum + getSessionVolume(session), 0);
    const totalSets = state.sessions.reduce((sum, session) => sum + getSessionSets(session), 0);
    const bestFrequency = mostFrequentExercise();

    app.innerHTML = `
      <div class="stack-lg">
        <section class="stats-grid">
          <div class="card stat-card"><span class="stat-value">${state.sessions.length}</span><span class="stat-label">Sessioni</span></div>
          <div class="card stat-card"><span class="stat-value">${formatCompact(totalVolume)}</span><span class="stat-label">Volume totale</span></div>
          <div class="card stat-card"><span class="stat-value">${totalSets}</span><span class="stat-label">Serie valide</span></div>
        </section>

        <section class="card stack">
          <div class="input-group">
            <label for="progress-exercise">Esercizio</label>
            <select class="select" id="progress-exercise" data-progress-control="exercise">
              ${exerciseOptions.map(option => `<option value="${escapeHtml(option.key)}" ${option.key === ui.progressExercise ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
            </select>
          </div>
          <div class="segmented" aria-label="Metrica del grafico">
            <button type="button" class="${metric === 'weight' ? 'is-active' : ''}" data-action="set-progress-metric" data-metric="weight">Carico</button>
            <button type="button" class="${metric === 'e1rm' ? 'is-active' : ''}" data-action="set-progress-metric" data-metric="e1rm">1RM stimato</button>
            <button type="button" class="${metric === 'volume' ? 'is-active' : ''}" data-action="set-progress-metric" data-metric="volume">Volume</button>
          </div>
        </section>

        <section class="card">
          <div class="row-between" style="align-items:flex-end">
            <div>
              <p class="tiny muted no-margin">${metricInfo.label.toUpperCase()}</p>
              <div class="metric-highlight" style="margin-top:5px">
                <strong>${formatNumber(latestValue, metric === 'volume' ? 0 : 1)}</strong>
                <span>${escapeHtml(metricInfo.unit)}</span>
              </div>
              ${values.length > 1 ? `<p class="delta ${deltaPct > 0.05 ? 'positive' : deltaPct < -0.05 ? 'negative' : 'neutral'} no-margin" style="margin-top:7px">${deltaPct > 0 ? '↑' : deltaPct < 0 ? '↓' : '→'} ${formatNumber(Math.abs(deltaPct), 1)}% rispetto alla sessione precedente</p>` : '<p class="small muted no-margin" style="margin-top:7px">Prima rilevazione disponibile</p>'}
            </div>
            <div class="segmented" style="min-width:148px">
              <button type="button" class="${ui.progressRange === '30' ? 'is-active' : ''}" data-action="set-progress-range" data-range="30">30g</button>
              <button type="button" class="${ui.progressRange === '90' ? 'is-active' : ''}" data-action="set-progress-range" data-range="90">90g</button>
              <button type="button" class="${ui.progressRange === 'all' ? 'is-active' : ''}" data-action="set-progress-range" data-range="all">Tutto</button>
            </div>
          </div>
          <div class="chart-wrap" style="margin-top:16px">
            ${renderLineChart(points, metricInfo.key, metricInfo.unit)}
          </div>
        </section>

        <section>
          <div class="section-header">
            <div>
              <h2>Record di ${escapeHtml(selectedExercise.name)}</h2>
              <p class="small muted">Migliori risultati registrati</p>
            </div>
          </div>
          <div class="card">
            ${renderExerciseRecords(allPoints)}
          </div>
        </section>

        <section>
          <div class="section-header">
            <div>
              <h2>Storico esercizio</h2>
              <p class="small muted">Tocca una sessione per i dettagli</p>
            </div>
          </div>
          <div class="card">
            ${[...allPoints].reverse().slice(0, 12).map(point => `
              <div class="list-row session-card" data-action="session-detail" data-session-id="${escapeHtml(point.sessionId)}">
                <div class="list-index">${new Date(point.date).getDate()}</div>
                <div class="grow">
                  <strong>${formatNumber(point.bestWeight)} ${escapeHtml(state.profile.unit)} × ${formatNumber(point.bestReps, 0)}</strong>
                  <p class="small muted no-margin" style="margin-top:3px">${formatDate(point.date, { year: true })}</p>
                </div>
                <div style="text-align:right">
                  <strong>${formatNumber(point.e1rm, 1)} ${escapeHtml(state.profile.unit)}</strong>
                  <p class="tiny muted no-margin">1RM stimato</p>
                </div>
              </div>`).join('')}
          </div>
        </section>

        ${bestFrequency ? `
          <section class="card card-soft">
            <p class="eyebrow">COSTANZA</p>
            <h3 style="margin:6px 0 4px">${escapeHtml(bestFrequency.name)} è il tuo esercizio più registrato</h3>
            <p class="small muted no-margin">${bestFrequency.count} sessioni totali. La costanza rende i confronti più affidabili.</p>
          </section>` : ''}
      </div>`;
  }

  function mostFrequentExercise() {
    const counts = new Map();
    state.sessions.forEach(session => (session.exercises || []).forEach(exercise => {
      const key = exerciseKey(exercise);
      const item = counts.get(key) || { name: catalogEntryForExercise(exercise)?.name || exercise.name, count: 0 };
      item.count += 1;
      counts.set(key, item);
    }));
    return [...counts.values()].sort((a, b) => b.count - a.count)[0] || null;
  }

  function renderExerciseRecords(points) {
    if (!points.length) return '<p class="small muted no-margin">Nessun dato nel periodo.</p>';
    const bestWeightPoint = [...points].sort((a, b) => b.weight - a.weight)[0];
    const bestE1rmPoint = [...points].sort((a, b) => b.e1rm - a.e1rm)[0];
    const bestVolumePoint = [...points].sort((a, b) => b.volume - a.volume)[0];
    return `
      <div class="record-row">
        <div><strong>Carico massimo</strong><p class="small muted no-margin" style="margin-top:3px">${formatDate(bestWeightPoint.date, { year: true })}</p></div>
        <div class="record-value">${formatNumber(bestWeightPoint.weight)} ${escapeHtml(state.profile.unit)}</div>
      </div>
      <div class="record-row">
        <div><strong>1RM stimato</strong><p class="small muted no-margin" style="margin-top:3px">Formula di Epley</p></div>
        <div class="record-value">${formatNumber(bestE1rmPoint.e1rm, 1)} ${escapeHtml(state.profile.unit)}</div>
      </div>
      <div class="record-row">
        <div><strong>Volume in una sessione</strong><p class="small muted no-margin" style="margin-top:3px">${formatDate(bestVolumePoint.date, { year: true })}</p></div>
        <div class="record-value">${formatCompact(bestVolumePoint.volume)} ${escapeHtml(state.profile.unit)}</div>
      </div>`;
  }

  function renderLineChart(points, key, unit) {
    if (!points.length) return '<div class="chart-empty">Nessun dato nel periodo selezionato.</div>';

    const width = 360;
    const height = 225;
    const margin = { top: 22, right: 18, bottom: 34, left: 42 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const rawValues = points.map(point => toNumber(point[key]));
    let min = Math.min(...rawValues);
    let max = Math.max(...rawValues);
    if (min === max) {
      const padding = Math.max(1, max * 0.12);
      min = Math.max(0, min - padding);
      max += padding;
    } else {
      const padding = (max - min) * 0.18;
      min = Math.max(0, min - padding);
      max += padding;
    }
    const xFor = index => margin.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = value => margin.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
    const coords = points.map((point, index) => ({ x: xFor(index), y: yFor(point[key]), value: point[key], date: point.date }));
    const linePath = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${coords.at(-1).x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} Z`;
    const gridLines = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const y = margin.top + plotHeight * ratio;
      const value = max - (max - min) * ratio;
      return `<line class="chart-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"></line><text class="chart-label" x="${margin.left - 7}" y="${y + 3}" text-anchor="end">${formatCompact(value)}</text>`;
    }).join('');
    const xIndexes = points.length <= 3 ? points.map((_, index) => index) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
    const xLabels = [...new Set(xIndexes)].map(index => `<text class="chart-label" x="${xFor(index)}" y="${height - 9}" text-anchor="middle">${new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short' }).format(new Date(points[index].date))}</text>`).join('');
    const circles = coords.map((point, index) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="${index === coords.length - 1 ? 4.5 : 3.5}"><title>${formatDate(point.date, { year: true })}: ${formatNumber(point.value, key === 'volume' ? 0 : 1)} ${escapeHtml(unit)}</title></circle>`).join('');
    const last = coords.at(-1);

    return `
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico di ${escapeHtml(key)} per ${points.length} sessioni">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#A46CFF"></stop>
            <stop offset="100%" stop-color="#5C2E91" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${gridLines}
        <path class="chart-area" d="${areaPath}"></path>
        <path class="chart-line" d="${linePath}"></path>
        ${circles}
        ${xLabels}
        <text class="chart-value" x="${Math.min(width - margin.right, last.x + 7)}" y="${Math.max(13, last.y - 9)}" text-anchor="${last.x > width - 70 ? 'end' : 'start'}">${formatNumber(last.value, key === 'volume' ? 0 : 1)}</text>
      </svg>`;
  }

  function guideList(items, emptyLabel = 'Nessuna informazione disponibile.') {
    const values = (items || []).filter(Boolean);
    if (!values.length) return `<p class="small muted no-margin">${escapeHtml(emptyLabel)}</p>`;
    return `<ul class="guide-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function openExerciseInfo({ name = 'Esercizio', catalogId = '', catalogMode = 'auto', videoUrl = '', muscle = '', returnToCatalog = false } = {}) {
    const exercise = { name, catalogId, catalogMode, videoUrl, muscle };
    const entry = matchCatalogEntry(name, muscle, catalogId, catalogMode);
    const fallback = {
      id: '',
      name,
      muscle: muscle || 'Da definire',
      primary: muscle ? [muscle] : [],
      secondary: [],
      equipment: [],
      difficulty: 'Da definire',
      description: 'Questo esercizio non è ancora associato a una voce precisa del catalogo. Puoi comunque aprire YouTube e salvare un collegamento personalizzato dalla modifica dell’esercizio.',
      setup: ['Prepara una posizione stabile e un carico gestibile.'],
      execution: ['Mantieni un movimento controllato e coerente con la variante scelta.'],
      errors: ['Usare un carico che impedisce il controllo.', 'Continuare nonostante dolore articolare non abituale.'],
      tips: ['Associa l’esercizio a una voce del catalogo per ottenere una guida più specifica.'],
      alternatives: [],
      aliases: [],
      youtubeQuery: `${name} esecuzione corretta tecnica`,
    };
    const guide = entry || fallback;
    const youtubeUrl = youtubeUrlForExercise(exercise, guide);
    const primary = guide.primary || [];
    const secondary = guide.secondary || [];

    openModal({
      eyebrow: entry ? 'CATALOGO ESERCIZI' : 'GUIDA GENERICA',
      title: guide.name || name,
      body: `
        <div class="exercise-guide stack">
          <section class="exercise-guide-hero">
            <div class="guide-hero-icon">V</div>
            <div class="grow">
              <div class="exercise-meta no-top-margin">
                <span class="badge accent">${escapeHtml(guide.muscle || muscle || 'Esercizio')}</span>
                <span class="badge">${escapeHtml(guide.difficulty || 'Da definire')}</span>
                ${(guide.equipment || []).slice(0, 2).map(item => `<span class="badge">${escapeHtml(item)}</span>`).join('')}
              </div>
              <p class="small muted guide-description">${escapeHtml(guide.description || '')}</p>
            </div>
          </section>

          <a class="button block youtube-button" href="${escapeHtml(youtubeUrl)}" target="_blank" rel="noopener noreferrer">
            <span class="youtube-play" aria-hidden="true">▶</span>
            ${safeYoutubeUrl(videoUrl) ? 'Apri il video su YouTube' : 'Cerca il video su YouTube'}
          </a>
          <p class="tiny muted center no-margin">Il contenuto resta ospitato su YouTube e si apre nell’app YouTube o nel browser.</p>

          <section class="guide-section">
            <div class="guide-section-title"><span>01</span><h3>Muscoli coinvolti</h3></div>
            <div class="muscle-groups">
              <div class="muscle-group"><span>PRIMARI</span><strong>${primary.length ? escapeHtml(primary.join(' · ')) : 'Non specificati'}</strong></div>
              <div class="muscle-group"><span>SECONDARI</span><strong>${secondary.length ? escapeHtml(secondary.join(' · ')) : '—'}</strong></div>
            </div>
          </section>

          <section class="guide-section">
            <div class="guide-section-title"><span>02</span><h3>Preparazione</h3></div>
            ${guideList(guide.setup)}
          </section>

          <section class="guide-section">
            <div class="guide-section-title"><span>03</span><h3>Esecuzione</h3></div>
            ${guideList(guide.execution)}
          </section>

          <section class="guide-section guide-section-errors">
            <div class="guide-section-title"><span>04</span><h3>Errori comuni</h3></div>
            ${guideList(guide.errors)}
          </section>

          <section class="guide-section">
            <div class="guide-section-title"><span>05</span><h3>Consigli</h3></div>
            ${guideList(guide.tips)}
          </section>

          ${guide.alternatives?.length ? `<section class="guide-section"><div class="guide-section-title"><span>06</span><h3>Alternative</h3></div><div class="exercise-meta no-top-margin">${guide.alternatives.map(item => `<span class="badge">${escapeHtml(item)}</span>`).join('')}</div></section>` : ''}

          ${!entry ? `<section class="card-soft"><strong>Associazione non trovata</strong><p class="small muted no-margin" style="margin-top:5px">Apri la modifica dell’esercizio e scegli una voce nel campo “Associa al catalogo”.</p></section>` : ''}
          <p class="tiny muted no-margin guide-safety">Indicazioni educative generali: adatta tecnica e carico alle tue capacità e interrompi l’esercizio in presenza di dolore.</p>
        </div>`,
      actions: returnToCatalog
        ? '<button type="button" class="button secondary" data-action="return-catalog">← Catalogo</button><button type="button" class="button secondary" data-action="close-modal">Chiudi</button>'
        : '<button type="button" class="button secondary block" data-action="close-modal">Chiudi</button>',
    });
  }

  function catalogFieldSearchScore(query, value, weight = 1) {
    const normalizedQuery = normalizeCatalogText(query);
    const normalizedValue = normalizeCatalogText(value);
    if (!normalizedQuery || !normalizedValue) return 0;
    let score = catalogTextScore(normalizedQuery, normalizedValue);
    if (normalizedValue === normalizedQuery) score = 1;
    else if (normalizedValue.startsWith(normalizedQuery)) score = Math.max(score, 0.96);
    else if (normalizedValue.split(' ').some(token => token.startsWith(normalizedQuery))) score = Math.max(score, 0.91);
    else if (normalizedValue.includes(normalizedQuery)) score = Math.max(score, 0.82);
    return score * weight;
  }

  function filteredCatalogResults(query = '') {
    const normalizedQuery = normalizeCatalogText(query);
    return EXERCISE_CATALOG
      .map(entry => {
        if (!normalizedQuery) return { entry, score: 1 };
        const scores = [
          catalogFieldSearchScore(normalizedQuery, entry.name, 1),
          ...(entry.aliases || []).map(value => catalogFieldSearchScore(normalizedQuery, value, 0.98)),
          catalogFieldSearchScore(normalizedQuery, entry.muscle, 0.82),
          ...(entry.primary || []).map(value => catalogFieldSearchScore(normalizedQuery, value, 0.80)),
          ...(entry.secondary || []).map(value => catalogFieldSearchScore(normalizedQuery, value, 0.66)),
          ...(entry.equipment || []).map(value => catalogFieldSearchScore(normalizedQuery, value, 0.62)),
        ];
        return { entry, score: Math.max(...scores, 0) };
      })
      .filter(item => !normalizedQuery || item.score >= 0.30)
      .sort((a, b) => normalizedQuery
        ? b.score - a.score || a.entry.name.localeCompare(b.entry.name, 'it')
        : a.entry.name.localeCompare(b.entry.name, 'it'));
  }

  function catalogResultItemsMarkup(items) {
    if (!items.length) {
      return '<div class="card-soft center catalog-empty"><p class="small muted no-margin">Nessun esercizio trovato. Prova un nome, un muscolo o un alias diverso.</p></div>';
    }
    return items.map(({ entry }) => `
      <button type="button" class="catalog-result" data-action="exercise-info" data-exercise-name="${escapeHtml(entry.name)}" data-catalog-id="${escapeHtml(entry.id)}" data-catalog-mode="manual" data-muscle="${escapeHtml(entry.muscle || '')}" data-return-catalog="true">
        <span class="catalog-result-icon">V</span>
        <span class="grow">
          <strong>${escapeHtml(entry.name)}</strong>
          <small>${escapeHtml(entry.muscle)} · ${escapeHtml(entry.equipment?.[0] || 'Attrezzatura variabile')}</small>
        </span>
        <span class="catalog-chevron">›</span>
      </button>`).join('');
  }

  function catalogPagerMarkup(page, totalPages, disabled = false) {
    return `
      <div class="catalog-pager" aria-label="Pagine del catalogo">
        <button type="button" class="icon-button small subtle" data-action="catalog-page-prev" aria-label="Pagina precedente" ${disabled || page <= 1 ? 'disabled' : ''}>←</button>
        <span class="catalog-page-label">Pagina <strong>${page}</strong> di <strong>${totalPages}</strong></span>
        <button type="button" class="icon-button small subtle" data-action="catalog-page-next" aria-label="Pagina successiva" ${disabled || page >= totalPages ? 'disabled' : ''}>→</button>
      </div>`;
  }

  function catalogBrowserSnapshot() {
    const all = filteredCatalogResults(catalogBrowser.query);
    const totalPages = Math.max(1, Math.ceil(all.length / catalogBrowser.pageSize));
    catalogBrowser.page = clamp(catalogBrowser.page, 1, totalPages);
    const startIndex = (catalogBrowser.page - 1) * catalogBrowser.pageSize;
    return {
      all,
      totalPages,
      page: catalogBrowser.page,
      items: all.slice(startIndex, startIndex + catalogBrowser.pageSize),
    };
  }

  function renderCatalogBrowser({ resetScroll = false } = {}) {
    const results = document.querySelector('#catalog-results');
    const summary = document.querySelector('#catalog-summary');
    const pagerTop = document.querySelector('#catalog-pager-top');
    const pagerBottom = document.querySelector('#catalog-pager-bottom');
    if (!results || !summary || !pagerTop || !pagerBottom) return;
    const snapshot = catalogBrowserSnapshot();
    const total = snapshot.all.length;
    summary.textContent = catalogBrowser.query
      ? `${total} ${total === 1 ? 'risultato' : 'risultati'} su ${EXERCISE_CATALOG.length}`
      : `${EXERCISE_CATALOG.length} esercizi disponibili`;
    results.innerHTML = catalogResultItemsMarkup(snapshot.items);
    const pager = catalogPagerMarkup(snapshot.page, snapshot.totalPages, total === 0);
    pagerTop.innerHTML = pager;
    pagerBottom.innerHTML = pager;
    if (resetScroll) modalBody.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openExerciseCatalogModal({ preserve = false } = {}) {
    if (!preserve) {
      catalogBrowser.query = '';
      catalogBrowser.page = 1;
    }
    const snapshot = catalogBrowserSnapshot();
    const total = snapshot.all.length;
    openModal({
      eyebrow: 'DATABASE VANTA',
      title: `${EXERCISE_CATALOG.length} esercizi`,
      autoFocus: false,
      body: `
        <div class="stack catalog-browser">
          <div class="input-group catalog-search-group">
            <label for="catalog-search">Cerca per nome, alias, muscolo o attrezzatura</label>
            <input class="input" id="catalog-search" type="search" data-catalog-search autocomplete="off" placeholder="Es. Lat machine, petto, curl…" value="${escapeHtml(catalogBrowser.query)}">
          </div>
          <div class="catalog-toolbar">
            <p class="small muted no-margin" id="catalog-summary">${catalogBrowser.query ? `${total} ${total === 1 ? 'risultato' : 'risultati'} su ${EXERCISE_CATALOG.length}` : `${EXERCISE_CATALOG.length} esercizi disponibili`}</p>
            <div id="catalog-pager-top">${catalogPagerMarkup(snapshot.page, snapshot.totalPages, total === 0)}</div>
          </div>
          <div class="catalog-results" id="catalog-results" aria-live="polite">${catalogResultItemsMarkup(snapshot.items)}</div>
          <div id="catalog-pager-bottom">${catalogPagerMarkup(snapshot.page, snapshot.totalPages, total === 0)}</div>
        </div>`,
      actions: '<button type="button" class="button secondary block" data-action="close-modal">Chiudi</button>',
    });
  }

  function renderProfile() {
    setHeader('ACCOUNT', state.profile.name);
    const totalVolume = state.sessions.reduce((sum, session) => sum + getSessionVolume(session), 0);
    const installLabel = isStandalone() ? 'Già installata' : 'Installa';

    app.innerHTML = `
      <div class="stack-lg">
        <section class="card">
          <div class="row">
            <button type="button" class="profile-avatar-button" data-action="choose-profile-image" aria-label="Cambia foto profilo">${profileAvatarMarkup('profile-avatar')}</button>
            <div class="grow">
              <p class="eyebrow">ACCOUNT VANTA</p>
              <h2 style="margin:5px 0 4px">${escapeHtml(state.profile.name)}</h2>
              <p class="small muted no-margin">Questo nome appare nell’intestazione dell’app · obiettivo ${state.profile.weeklyGoal}/settimana · ${escapeHtml(state.profile.unit)}</p>
            </div>
            <button type="button" class="icon-button small" data-action="edit-profile" aria-label="Modifica profilo">✎</button>
          </div>
        </section>

        <section class="stats-grid">
          <div class="card stat-card"><span class="stat-value">${state.sessions.length}</span><span class="stat-label">Allenamenti</span></div>
          <div class="card stat-card"><span class="stat-value">${state.plans.length}</span><span class="stat-label">Schede</span></div>
          <div class="card stat-card"><span class="stat-value">${formatCompact(totalVolume)}</span><span class="stat-label">Volume</span></div>
        </section>

        <section>
          <div class="section-header"><div><h2>App e condivisione</h2><p class="small muted">Portala con te o passala agli amici</p></div></div>
          <div class="card">
            <div class="settings-row">
              <div><strong>Installa sul telefono</strong><p class="small muted no-margin" style="margin-top:3px">Funziona come una normale app e anche offline.</p></div>
              <button type="button" class="button small secondary" data-action="install-app" ${isStandalone() ? 'disabled' : ''}>${installLabel}</button>
            </div>
            <div class="settings-row">
              <div><strong>Condividi VANTA</strong><p class="small muted no-margin" style="margin-top:3px">Invia il link dell’app a un amico.</p></div>
              <button type="button" class="button small secondary" data-action="share-app">Condividi</button>
            </div>
            <div class="settings-row">
              <div><strong>Catalogo esercizi</strong><p class="small muted no-margin" style="margin-top:3px">${EXERCISE_CATALOG.length} esercizi con muscoli, tecnica, errori e accesso a YouTube.</p></div>
              <button type="button" class="button small secondary" data-action="open-catalog">Apri</button>
            </div>
          </div>
        </section>

        <section>
          <div class="section-header"><div><h2>Importazione schede</h2><p class="small muted">Trasforma file, foto e Note in una scheda modificabile</p></div></div>
          <div class="card">
            <div class="settings-row">
              <div><strong>Importazione universale</strong><p class="small muted no-margin" style="margin-top:3px">PDF, foto, Word, Excel, PowerPoint, testo e Note con tabelle, colonne, drop set, rest pause e back-off.</p></div>
              <button type="button" class="button small secondary" data-action="import-workout">Importa</button>
            </div>
          </div>
        </section>

        <section>
          <div class="section-header"><div><h2>Backup dei dati</h2><p class="small muted">I dati sono salvati solo su questo dispositivo</p></div></div>
          <div class="card">
            <div class="settings-row">
              <div><strong>Esporta backup</strong><p class="small muted no-margin" style="margin-top:3px">Scarica schede, sessioni e impostazioni.</p></div>
              <button type="button" class="button small secondary" data-action="export-data">Esporta</button>
            </div>
            <div class="settings-row">
              <div><strong>Importa file</strong><p class="small muted no-margin" style="margin-top:3px">Ripristina un backup o importa una scheda condivisa.</p></div>
              <button type="button" class="button small secondary" data-action="import-data">Importa</button>
            </div>
          </div>
        </section>

        <section>
          <div class="section-header"><div><h2>Privacy e manutenzione</h2><p class="small muted">Nessun account, nessun tracciamento</p></div></div>
          <div class="card">
            <div class="settings-row">
              <div><strong>Dati locali</strong><p class="small muted no-margin" style="margin-top:3px">Le informazioni non lasciano il tuo dispositivo.</p></div>
              <span class="badge success">Offline</span>
            </div>
            <div class="settings-row">
              <div><strong>Elimina tutti i dati</strong><p class="small muted no-margin" style="margin-top:3px">Cancella schede, storico e sessioni in corso.</p></div>
              <button type="button" class="button small danger" data-action="reset-data">Elimina</button>
            </div>
          </div>
        </section>

        <p class="tiny muted center">VANTA v${APP_VERSION} · PWA personale</p>
      </div>`;
  }

  function openNewPlanModal() {
    openModal({
      eyebrow: 'NUOVA SCHEDA',
      title: 'Crea il programma',
      body: `
        <div class="stack">
          <div class="input-group">
            <label for="plan-name">Nome scheda</label>
            <input class="input" id="plan-name" name="name" maxlength="60" required placeholder="Es. Ipertrofia 4 giorni">
          </div>
          <div class="input-group">
            <label for="plan-description">Descrizione</label>
            <textarea class="textarea" id="plan-description" name="description" maxlength="240" placeholder="Obiettivo, durata, note generali…"></textarea>
          </div>
          <div class="input-group">
            <label for="first-day-name">Nome del primo giorno</label>
            <input class="input" id="first-day-name" name="dayName" maxlength="50" value="Giorno 1" required>
          </div>
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        const dayName = String(formData.get('dayName') || '').trim();
        if (!name || !dayName) {
          toast('Compila i campi obbligatori.', 'error');
          return;
        }
        const plan = {
          id: uid('plan'),
          name,
          description: String(formData.get('description') || '').trim(),
          createdAt: new Date().toISOString(),
          days: [{ id: uid('day'), name: dayName, notes: '', exercises: [] }],
        };
        state.plans.push(plan);
        ui.expandedDays.add(plan.days[0].id);
        saveState();
        closeModal();
        navigate(`plan/${plan.id}`);
        toast('Scheda creata.', 'success');
      },
    });
  }

  function openEditPlanModal(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    openModal({
      eyebrow: 'SCHEDA',
      title: 'Modifica informazioni',
      body: `
        <div class="stack">
          <div class="input-group">
            <label for="plan-name">Nome scheda</label>
            <input class="input" id="plan-name" name="name" maxlength="60" required value="${escapeHtml(plan.name)}">
          </div>
          <div class="input-group">
            <label for="plan-description">Descrizione</label>
            <textarea class="textarea" id="plan-description" name="description" maxlength="240">${escapeHtml(plan.description || '')}</textarea>
          </div>
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        if (!name) return toast('Inserisci un nome.', 'error');
        plan.name = name;
        plan.description = String(formData.get('description') || '').trim();
        saveState();
        closeModal();
        renderPlan(plan.id);
        toast('Scheda aggiornata.', 'success');
      },
    });
  }

  function openAddDayModal(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    openModal({
      eyebrow: 'NUOVO GIORNO',
      title: 'Aggiungi una sessione',
      body: `
        <div class="stack">
          <div class="input-group">
            <label for="day-name">Nome</label>
            <input class="input" id="day-name" name="name" maxlength="50" required value="Giorno ${plan.days.length + 1}">
          </div>
          <div class="input-group">
            <label for="day-notes">Nota breve</label>
            <input class="input" id="day-notes" name="notes" maxlength="100" placeholder="Es. Petto e tricipiti">
          </div>
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        if (!name) return toast('Inserisci un nome.', 'error');
        const day = { id: uid('day'), name, notes: String(formData.get('notes') || '').trim(), exercises: [] };
        plan.days.push(day);
        ui.expandedDays.add(day.id);
        saveState();
        closeModal();
        renderPlan(plan.id);
        toast('Giorno aggiunto.', 'success');
      },
    });
  }

  function openEditDayModal(planId, dayId) {
    const plan = getPlan(planId);
    const day = getDay(planId, dayId);
    if (!plan || !day) return;
    openModal({
      eyebrow: 'GIORNO',
      title: 'Modifica sessione',
      body: `
        <div class="stack">
          <div class="input-group">
            <label for="day-name">Nome</label>
            <input class="input" id="day-name" name="name" maxlength="50" required value="${escapeHtml(day.name)}">
          </div>
          <div class="input-group">
            <label for="day-notes">Nota breve</label>
            <input class="input" id="day-notes" name="notes" maxlength="100" value="${escapeHtml(day.notes || '')}">
          </div>
          <button type="button" class="button danger block" data-action="delete-day" data-plan-id="${escapeHtml(planId)}" data-day-id="${escapeHtml(dayId)}">Elimina questo giorno</button>
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        if (!name) return toast('Inserisci un nome.', 'error');
        day.name = name;
        day.notes = String(formData.get('notes') || '').trim();
        saveState();
        closeModal();
        renderPlan(plan.id);
        toast('Giorno aggiornato.', 'success');
      },
    });
  }

  function catalogAssociationStatusMarkup(name, muscle, selection = '__auto__') {
    if (selection === '__none__') {
      return '<div class="catalog-association-status is-none"><span aria-hidden="true">×</span><div><strong>Nessuna associazione</strong><small>Questo esercizio userà solo il nome scritto nella scheda.</small></div></div>';
    }
    if (selection && selection !== '__auto__') {
      const entry = CATALOG_BY_ID.get(selection);
      if (!entry) return '<div class="catalog-association-status is-warning"><span aria-hidden="true">!</span><div><strong>Associazione non disponibile</strong><small>Scegli un’altra voce del catalogo.</small></div></div>';
      return `<div class="catalog-association-status is-manual"><span aria-hidden="true">✓</span><div><strong>Manuale: ${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.muscle)} · resta fissa anche se cambi il nome.</small></div></div>`;
    }

    const details = catalogMatchDetails(name, muscle);
    if (details.entry) {
      return `<div class="catalog-association-status is-match"><span aria-hidden="true">✓</span><div><strong>Automatico: ${escapeHtml(details.entry.name)}</strong><small>${escapeHtml(details.entry.muscle)} · si aggiorna mentre modifichi il nome.</small></div></div>`;
    }
    if (details.ambiguous && details.suggestion) {
      return `<div class="catalog-association-status is-warning"><span aria-hidden="true">?</span><div><strong>Nome ancora ambiguo</strong><small>Miglior suggerimento: ${escapeHtml(details.suggestion.name)}. Completa il nome oppure scegli manualmente.</small></div></div>`;
    }
    return '<div class="catalog-association-status is-neutral"><span aria-hidden="true">…</span><div><strong>In attesa di un nome preciso</strong><small>VANTA assocerà video, tecnica e storico solo quando il riconoscimento sarà sicuro.</small></div></div>';
  }

  function updateCatalogAssociationPreview({ autoFillMuscle = false } = {}) {
    const nameInput = document.querySelector('#exercise-name');
    const muscleInput = document.querySelector('#exercise-muscle');
    const select = document.querySelector('#exercise-catalog');
    const status = document.querySelector('#exercise-catalog-status');
    if (!nameInput || !muscleInput || !select || !status) return;

    const muscleWasEdited = muscleInput.dataset.userEdited === 'true';
    if (select.value === '__auto__') {
      const details = catalogMatchDetails(nameInput.value, muscleWasEdited ? muscleInput.value : '');
      if (autoFillMuscle && !muscleWasEdited) {
        muscleInput.value = details.entry?.muscle || '';
        muscleInput.dataset.autoFilled = details.entry ? 'true' : 'false';
      }
    } else if (select.value && select.value !== '__none__') {
      const entry = CATALOG_BY_ID.get(select.value);
      if (entry && autoFillMuscle && !muscleWasEdited) {
        muscleInput.value = entry.muscle || '';
        muscleInput.dataset.autoFilled = 'true';
      }
    }
    const statusMuscle = muscleWasEdited ? muscleInput.value : '';
    status.innerHTML = catalogAssociationStatusMarkup(nameInput.value, statusMuscle, select.value);
  }

  function openExerciseModal(planId, dayId, exerciseId = '') {
    const plan = getPlan(planId);
    const day = getDay(planId, dayId);
    const exercise = exerciseId ? day?.exercises.find(item => item.id === exerciseId) : null;
    if (!plan || !day) return;
    const value = exercise || {
      id: '',
      name: '',
      muscle: '',
      catalogId: '',
      catalogMode: 'auto',
      videoUrl: '',
      sets: 3,
      setScheme: '3',
      setTargets: deriveRepTargets(3, '8-10', '3'),
      reps: '8-10',
      rest: 90,
      notes: '',
    };
    const catalogMode = normalizeCatalogMode(value.catalogMode, value.catalogId);
    const automaticMatch = matchCatalogEntry(value.name, value.muscle, '', 'auto');
    const selectValue = catalogMode === 'manual' && value.catalogId ? value.catalogId : catalogMode === 'none' ? '__none__' : '__auto__';
    const muscleWasAuto = catalogMode === 'auto' && automaticMatch && normalizeCatalogText(value.muscle) === normalizeCatalogText(automaticMatch.muscle);
    const catalogOptions = EXERCISE_CATALOG
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'it'))
      .map(entry => `<option value="${escapeHtml(entry.id)}" ${selectValue === entry.id ? 'selected' : ''}>${escapeHtml(entry.name)} — ${escapeHtml(entry.muscle)}</option>`)
      .join('');
    const catalogDatalist = EXERCISE_CATALOG.map(entry => `<option value="${escapeHtml(entry.name)}"></option>`).join('');
    openModal({
      eyebrow: exercise ? 'ESERCIZIO' : 'NUOVO ESERCIZIO',
      title: exercise ? 'Modifica esercizio' : 'Aggiungi esercizio',
      body: `
        <div class="form-grid">
          <div class="input-group span-2">
            <label for="exercise-name">Nome</label>
            <input class="input" id="exercise-name" name="name" list="exercise-name-catalog" maxlength="70" required placeholder="Es. Panca piana" value="${escapeHtml(value.name)}">
            <datalist id="exercise-name-catalog">${catalogDatalist}</datalist>
          </div>
          <div class="input-group span-2">
            <label for="exercise-catalog">Associa al catalogo VANTA</label>
            <select class="select" id="exercise-catalog" name="catalogSelection">
              <option value="__auto__" ${selectValue === '__auto__' ? 'selected' : ''}>Automatico — segue il nome dell’esercizio</option>
              <option value="__none__" ${selectValue === '__none__' ? 'selected' : ''}>Nessuna associazione</option>
              ${catalogOptions}
            </select>
            <div id="exercise-catalog-status">${catalogAssociationStatusMarkup(value.name, value.muscle, selectValue)}</div>
            <p class="tiny muted no-margin">In modalità automatica l’associazione viene ricalcolata a ogni modifica del nome; una scelta manuale rimane invece fissa.</p>
          </div>
          <div class="input-group span-2">
            <label for="exercise-muscle">Gruppo muscolare</label>
            <input class="input" id="exercise-muscle" name="muscle" maxlength="40" placeholder="Es. Petto" value="${escapeHtml(value.muscle)}" data-auto-filled="${muscleWasAuto ? 'true' : 'false'}" data-user-edited="false">
          </div>
          <div class="input-group">
            <label for="exercise-sets">Numero totale di serie</label>
            <input class="input" id="exercise-sets" name="sets" type="number" inputmode="numeric" min="1" max="20" required value="${escapeHtml(value.sets)}">
          </div>
          <div class="input-group">
            <label for="exercise-reps">Ripetizioni</label>
            <input class="input" id="exercise-reps" name="reps" maxlength="40" required placeholder="8-10 oppure 6-8 + 10-12" value="${escapeHtml(value.reps)}">
          </div>
          <div class="input-group span-2">
            <label for="exercise-set-labels">Etichette delle serie</label>
            <input class="input" id="exercise-set-labels" name="setLabels" maxlength="160" placeholder="Es. 1 | 2 | BO oppure 1-2-BO" value="${escapeHtml(setLabelInputValue(value))}">
            <p class="tiny muted no-margin">Puoi usare numeri o lettere. Esempio: <strong>1 | 2 | BO</strong> indica tre serie. Sono accettati anche <strong>2 + BO</strong>, <strong>1-2-BO</strong> o la sola sigla <strong>BO</strong>.</p>
          </div>
          <div class="input-group span-2">
            <label for="exercise-set-targets">Target per ogni serie</label>
            <input class="input" id="exercise-set-targets" name="setTargets" maxlength="160" placeholder="Es. 6-8 | 6-8 | 10-12" value="${escapeHtml(targetInputValue(value))}">
            <p class="tiny muted no-margin">Separa i target con il simbolo |. Puoi lasciarlo invariato per usare lo stesso target in tutte le serie.</p>
          </div>
          <div class="input-group span-2">
            <label for="exercise-rest">Recupero in secondi</label>
            <input class="input" id="exercise-rest" name="rest" type="number" inputmode="numeric" min="0" max="600" step="5" value="${escapeHtml(value.rest)}">
          </div>
          <div class="input-group span-2">
            <label for="exercise-video-url">Link YouTube personalizzato (facoltativo)</label>
            <input class="input" id="exercise-video-url" name="videoUrl" inputmode="url" autocomplete="url" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(value.videoUrl || '')}">
            <p class="tiny muted no-margin">Se lo lasci vuoto, VANTA aprirà una ricerca YouTube specifica per l’esercizio.</p>
          </div>
          <div class="input-group span-2">
            <label for="exercise-notes">Note tecniche</label>
            <textarea class="textarea" id="exercise-notes" name="notes" maxlength="240" placeholder="Esecuzione, RIR, indicazioni…">${escapeHtml(value.notes || '')}</textarea>
          </div>
          ${exercise ? `<div class="span-2"><button type="button" class="button danger block" data-action="delete-exercise" data-plan-id="${escapeHtml(planId)}" data-day-id="${escapeHtml(dayId)}" data-exercise-id="${escapeHtml(exerciseId)}">Elimina esercizio</button></div>` : ''}
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        if (!name) return toast('Inserisci il nome dell’esercizio.', 'error');
        const requestedSets = clamp(Math.round(toNumber(formData.get('sets'), 3)), 1, 20);
        const labels = labelsFromInput(formData.get('setLabels'), requestedSets);
        const totalSets = labels.length || requestedSets;
        const finalLabels = labels.length ? labels : Array.from({ length: totalSets }, (_, index) => String(index + 1));
        const reps = String(formData.get('reps') || '').trim();
        const muscle = String(formData.get('muscle') || '').trim();
        const associationSelection = String(formData.get('catalogSelection') || '__auto__');
        let catalogMode = 'auto';
        let requestedCatalogId = '';
        let selectedCatalog = null;
        if (associationSelection === '__none__') {
          catalogMode = 'none';
        } else if (associationSelection !== '__auto__') {
          catalogMode = 'manual';
          requestedCatalogId = associationSelection;
          selectedCatalog = CATALOG_BY_ID.get(requestedCatalogId) || null;
          if (!selectedCatalog) return toast('La voce scelta non è più disponibile nel catalogo.', 'error');
        } else {
          selectedCatalog = matchCatalogEntry(name, muscle, '', 'auto');
          requestedCatalogId = selectedCatalog?.id || '';
        }
        const rawVideoUrl = String(formData.get('videoUrl') || '').trim();
        if (rawVideoUrl && !safeYoutubeUrl(rawVideoUrl)) return toast('Inserisci un link YouTube valido oppure lascia il campo vuoto.', 'error');
        const updated = normalizeExercise({
          id: exercise?.id || uid('ex'),
          name,
          muscle: muscle || selectedCatalog?.muscle || '',
          catalogId: requestedCatalogId,
          catalogMode,
          videoUrl: rawVideoUrl,
          sets: totalSets,
          reps,
          setScheme: inferSetScheme(finalLabels),
          setTargets: buildSetTargets(finalLabels, targetsFromInput(formData.get('setTargets')), reps),
          rest: formData.get('rest'),
          notes: String(formData.get('notes') || '').trim(),
        });
        if (exercise) Object.assign(exercise, updated);
        else day.exercises.push(updated);
        ui.expandedDays.add(day.id);
        saveState();
        closeModal();
        renderPlan(plan.id);
        toast(exercise ? 'Esercizio aggiornato.' : 'Esercizio aggiunto.', 'success');
      },
    });
  }

  function openPlanOptions(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    openModal({
      eyebrow: 'OPZIONI',
      title: plan.name,
      body: `
        <div class="stack">
          <button type="button" class="button secondary block" data-action="edit-plan" data-plan-id="${escapeHtml(planId)}">Modifica nome e descrizione</button>
          <button type="button" class="button secondary block" data-action="share-plan" data-plan-id="${escapeHtml(planId)}">Condividi scheda</button>
          <button type="button" class="button secondary block" data-action="duplicate-plan" data-plan-id="${escapeHtml(planId)}">Duplica scheda</button>
          <button type="button" class="button danger block" data-action="delete-plan" data-plan-id="${escapeHtml(planId)}">Elimina scheda</button>
        </div>`,
      actions: '<button type="button" class="button secondary block" data-action="close-modal">Chiudi</button>',
    });
  }

  function profilePhotoEditorAvatarMarkup() {
    return profileAvatarMarkup('profile-photo-preview');
  }

  function refreshProfilePhotoUi() {
    updateAccountButton();
    const preview = document.querySelector('#profile-photo-editor-avatar');
    if (preview) preview.innerHTML = profilePhotoEditorAvatarMarkup();
    const removeButton = document.querySelector('[data-action="remove-profile-image"]');
    if (removeButton) removeButton.hidden = !safeProfileImage(state.profile.avatarDataUrl);
    if (getRoute().route === 'profile') renderProfile();
  }

  function chooseProfileImage() {
    if (!profileImageFile) return toast('Selettore immagini non disponibile.', 'error');
    profileImageFile.value = '';
    profileImageFile.click();
  }

  function removeProfileImage() {
    if (!safeProfileImage(state.profile.avatarDataUrl)) return;
    const previous = state.profile.avatarDataUrl;
    state.profile.avatarDataUrl = '';
    if (!saveState({ silent: true })) {
      state.profile.avatarDataUrl = previous;
      toast('Impossibile rimuovere la foto: spazio locale non disponibile.', 'error');
      return;
    }
    refreshProfilePhotoUi();
    toast('Foto profilo rimossa.', 'success');
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Formato immagine non leggibile.'));
      };
      image.src = url;
    });
  }

  async function prepareProfileImage(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Seleziona un file immagine.');
    if (file.size > 12 * 1024 * 1024) throw new Error('L’immagine supera 12 MB. Scegline una più leggera.');
    const image = await loadImageElement(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error('Dimensioni dell’immagine non valide.');

    const outputSize = 384;
    const cropSize = Math.min(sourceWidth, sourceHeight);
    const sourceX = Math.max(0, (sourceWidth - cropSize) / 2);
    const sourceY = Math.max(0, (sourceHeight - cropSize) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Elaborazione immagine non supportata.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#0B0A12';
    context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, outputSize, outputSize);

    let dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    if (dataUrl.length > 650_000) dataUrl = canvas.toDataURL('image/jpeg', 0.70);
    const safe = safeProfileImage(dataUrl);
    if (!safe) throw new Error('Non è stato possibile ottimizzare l’immagine.');
    return safe;
  }

  async function handleProfileImageFile(file) {
    const previous = state.profile.avatarDataUrl || '';
    try {
      toast('Ottimizzazione della foto in corso…');
      const dataUrl = await prepareProfileImage(file);
      state.profile.avatarDataUrl = dataUrl;
      if (!saveState({ silent: true })) {
        state.profile.avatarDataUrl = previous;
        throw new Error('Spazio locale insufficiente per salvare la foto.');
      }
      refreshProfilePhotoUi();
      toast('Foto profilo aggiornata.', 'success');
    } catch (error) {
      console.error('Errore foto profilo', error);
      state.profile.avatarDataUrl = previous;
      toast(error?.message || 'Impossibile usare questa immagine.', 'error');
    }
  }

  function openEditProfileModal() {
    openModal({
      eyebrow: 'ACCOUNT VANTA',
      title: 'Profilo e preferenze',
      autoFocus: false,
      body: `
        <div class="stack">
          <section class="profile-photo-editor card-soft">
            <div id="profile-photo-editor-avatar">${profilePhotoEditorAvatarMarkup()}</div>
            <div class="grow">
              <strong>Foto profilo</strong>
              <p class="small muted" style="margin:4px 0 10px">Viene ritagliata in formato quadrato, compressa e salvata solo su questo dispositivo.</p>
              <div class="row wrap">
                <button type="button" class="button small secondary" data-action="choose-profile-image">Scegli foto</button>
                <button type="button" class="button small ghost" data-action="remove-profile-image" ${safeProfileImage(state.profile.avatarDataUrl) ? '' : 'hidden'}>Rimuovi</button>
              </div>
            </div>
          </section>
          <div class="input-group">
            <label for="profile-name">Nome visualizzato in alto</label>
            <input class="input" id="profile-name" name="name" maxlength="60" required value="${escapeHtml(state.profile.name)}">
          </div>
          <div class="form-grid">
            <div class="input-group">
              <label for="weekly-goal">Obiettivo settimanale</label>
              <input class="input" id="weekly-goal" name="weeklyGoal" type="number" min="1" max="14" required value="${state.profile.weeklyGoal}">
            </div>
            <div class="input-group">
              <label for="unit">Unità dei pesi</label>
              <select class="select" id="unit" name="unit">
                <option value="kg" ${state.profile.unit === 'kg' ? 'selected' : ''}>Chilogrammi</option>
                <option value="lb" ${state.profile.unit === 'lb' ? 'selected' : ''}>Libbre</option>
              </select>
            </div>
          </div>
          <p class="small muted no-margin">Cambiando unità, tutti i pesi registrati verranno convertiti automaticamente.</p>
        </div>`,
      onSubmit: formData => {
        const name = String(formData.get('name') || '').trim();
        if (!name) return toast('Inserisci un nome.', 'error');
        const newUnit = formData.get('unit') === 'lb' ? 'lb' : 'kg';
        if (newUnit !== state.profile.unit) convertAllWeights(state.profile.unit, newUnit);
        state.profile.name = name;
        state.profile.weeklyGoal = clamp(Math.round(toNumber(formData.get('weeklyGoal'), 3)), 1, 14);
        state.profile.unit = newUnit;
        saveState();
        closeModal();
        updateAccountButton();
        render();
        toast('Account aggiornato.', 'success');
      },
    });
  }

  function convertAllWeights(fromUnit, toUnit) {
    const factor = fromUnit === 'kg' && toUnit === 'lb' ? KG_TO_LB : 1 / KG_TO_LB;
    const convertSession = session => {
      (session?.exercises || []).forEach(exercise => (exercise.sets || []).forEach(set => {
        if (toNumber(set.weight) > 0) set.weight = roundWeight(toNumber(set.weight) * factor);
        if (toNumber(set.previousWeight) > 0) set.previousWeight = roundWeight(toNumber(set.previousWeight) * factor);
      }));
    };
    state.sessions.forEach(convertSession);
    if (state.activeSession) convertSession(state.activeSession);
  }

  function openSessionDetail(sessionId) {
    const session = state.sessions.find(item => item.id === sessionId);
    if (!session) return;
    const volume = getSessionVolume(session);
    openModal({
      eyebrow: formatDate(session.date, { year: true }).toUpperCase(),
      title: session.dayName || 'Allenamento',
      body: `
        <div class="stats-grid" style="margin-bottom:16px">
          <div class="card-soft stat-card"><span class="stat-value">${getSessionSets(session)}</span><span class="stat-label">Serie</span></div>
          <div class="card-soft stat-card"><span class="stat-value">${formatCompact(volume)}</span><span class="stat-label">Volume</span></div>
          <div class="card-soft stat-card"><span class="stat-value">${Math.round(session.durationMin || 0)}</span><span class="stat-label">Minuti</span></div>
        </div>
        <div class="stack">
          ${(session.exercises || []).map(exercise => {
            const valid = (exercise.sets || []).filter(set => set.completed !== false && toNumber(set.weight) > 0 && toNumber(set.reps) > 0);
            if (!valid.length) return '';
            return `
              <div class="card-soft">
                <div class="row-between">
                  <strong>${escapeHtml(exercise.name)}</strong>
                  <span class="badge">${valid.length} serie</span>
                </div>
                <div class="exercise-meta" style="margin-top:10px">
                  ${valid.map((set, index) => `<span class="badge accent">${escapeHtml(set.targetLabel || String(index + 1))}: ${formatNumber(set.weight)} ${escapeHtml(state.profile.unit)} × ${formatNumber(set.reps, 0)}</span>`).join('')}
                </div>
              </div>`;
          }).join('')}
          ${session.notes ? `<div class="card-soft"><strong>Note</strong><p class="small muted no-margin" style="margin-top:6px;line-height:1.5">${escapeHtml(session.notes)}</p></div>` : ''}
          <button type="button" class="button danger block" data-action="delete-session" data-session-id="${escapeHtml(session.id)}">Elimina sessione</button>
        </div>`,
      actions: '<button type="button" class="button secondary block" data-action="close-modal">Chiudi</button>',
    });
  }

  function sanitizePlanForShare(plan) {
    return {
      name: plan.name,
      description: plan.description,
      days: plan.days.map(day => ({
        name: day.name,
        notes: day.notes,
        exercises: day.exercises.map(exercise => ({
          name: exercise.name,
          muscle: exercise.muscle,
          catalogId: exercise.catalogId || '',
          videoUrl: exercise.videoUrl || '',
          sets: exercise.sets,
          setScheme: exercise.setScheme,
          setTargets: exercise.setTargets,
          reps: exercise.reps,
          rest: exercise.rest,
          notes: exercise.notes,
        })),
      })),
    };
  }

  function planWithFreshIds(plan, suffix = '') {
    const normalized = normalizePlan(plan);
    return {
      ...normalized,
      id: uid('plan'),
      name: `${normalized.name}${suffix}`,
      createdAt: new Date().toISOString(),
      days: normalized.days.map(day => ({
        ...day,
        id: uid('day'),
        exercises: day.exercises.map(exercise => ({ ...exercise, id: uid('ex') })),
      })),
    };
  }

  function encodePayload(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }

  function decodePayload(token) {
    const padded = token.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - token.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function getShareBaseUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('plan');
    url.hash = '';
    return url;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn('Clipboard API non disponibile', error);
      }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand?.('copy') || false;
    area.remove();
    return copied;
  }

  async function shareApp() {
    const url = getShareBaseUrl().toString();
    const data = {
      title: 'VANTA',
      text: 'Tieni traccia di schede, pesi e progressi con VANTA.',
      url,
    };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        if (await copyText(url)) toast('Link dell’app copiato.', 'success');
        else toast('Copia manualmente il link dalla barra del browser.', 'error');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') toast('Condivisione non riuscita.', 'error');
    }
  }

  async function sharePlan(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    const payload = { type: 'progressivo-plan', version: 1, plan: sanitizePlanForShare(plan) };
    const url = getShareBaseUrl();
    url.searchParams.set('plan', encodePayload(payload));
    const shareData = {
      title: `Scheda: ${plan.name}`,
      text: `Importa la scheda “${plan.name}” in VANTA.`,
      url: url.toString(),
    };
    try {
      if (shareData.url.length < 7500) {
        if (navigator.share) await navigator.share(shareData);
        else {
          if (await copyText(shareData.url)) toast('Link della scheda copiato.', 'success');
          else toast('Impossibile copiare il link.', 'error');
        }
        return;
      }

      const file = new File([JSON.stringify(payload, null, 2)], `${slugify(plan.name)}.progressivo-plan.json`, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: shareData.title, text: shareData.text, files: [file] });
      } else {
        downloadBlob(file, file.name);
        toast('Scheda esportata come file da condividere.', 'success');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') toast('Condivisione non riuscita.', 'error');
    }
  }

  function slugify(value) {
    return String(value || 'progressivo')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'progressivo';
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportBackup() {
    const payload = {
      type: 'progressivo-backup',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `progressivo-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Backup esportato.', 'success');
  }

  function openSharedPlanImport(plan) {
    const preview = planWithFreshIds(plan);
    pendingSharedPlan = preview;
    openModal({
      eyebrow: 'SCHEDA CONDIVISA',
      title: preview.name,
      body: `
        <p class="muted" style="line-height:1.5;margin-top:0">Questa scheda contiene ${preview.days.length} ${preview.days.length === 1 ? 'giorno' : 'giorni'} e ${preview.days.reduce((sum, day) => sum + day.exercises.length, 0)} esercizi.</p>
        <div class="stack">
          ${preview.days.map(day => `<div class="card-soft"><strong>${escapeHtml(day.name)}</strong><p class="small muted no-margin" style="margin-top:4px">${day.exercises.map(exercise => escapeHtml(exercise.name)).join(' · ') || 'Nessun esercizio'}</p></div>`).join('')}
        </div>`,
      actions: `
        <button type="button" class="button secondary" data-action="close-modal">Ignora</button>
        <button type="submit" class="button" value="import">Importa scheda</button>`,
      onSubmit: () => {
        state.plans.push(pendingSharedPlan);
        const importedId = pendingSharedPlan.id;
        pendingSharedPlan = null;
        saveState();
        closeModal();
        navigate(`plan/${importedId}`);
        toast('Scheda importata.', 'success');
      },
    });
  }

  function handleSharedPlanFromUrl() {
    const url = new URL(location.href);
    const token = url.searchParams.get('plan');
    if (!token) return;
    url.searchParams.delete('plan');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash || '#/home'}`);
    try {
      const payload = decodePayload(token);
      if (payload?.type !== 'progressivo-plan' || !payload.plan) throw new Error('Formato non valido');
      window.setTimeout(() => openSharedPlanImport(payload.plan), 250);
    } catch (error) {
      console.error(error);
      toast('Il link della scheda non è valido.', 'error');
    }
  }

  function handleImportedJson(payload) {
    if (payload?.type === 'progressivo-plan' && payload.plan) {
      openSharedPlanImport(payload.plan);
      return;
    }
    const importedState = payload?.type === 'progressivo-backup' ? payload.state : payload;
    if (!importedState || typeof importedState !== 'object' || !Array.isArray(importedState.plans)) {
      toast('File non riconosciuto.', 'error');
      return;
    }
    pendingImportState = normalizeState(importedState);
    confirmModal({
      title: 'Ripristinare il backup?',
      message: `Il file contiene ${pendingImportState.plans.length} schede, ${pendingImportState.sessions.length} sessioni e ${pendingImportState.scheduledWorkouts.length} allenamenti programmati. I dati attuali verranno sostituiti.`,
      confirmLabel: 'Ripristina',
      danger: true,
      onConfirm: () => {
        state = pendingImportState;
        pendingImportState = null;
        saveState();
        navigate('home');
        render();
        toast('Backup ripristinato.', 'success');
      },
    });
  }

  function openWorkoutImportModal() {
    if (modal.open) closeModal();
    openModal({
      eyebrow: 'IMPORTAZIONE UNIVERSALE',
      title: 'Da dove arriva la scheda?',
      body: `
        <div class="import-source-grid">
          <button type="button" class="card-soft import-source-card" data-action="choose-workout-file">
            <span class="import-source-icon" aria-hidden="true">⇧</span>
            <span><strong>Scegli un file</strong><small>PDF, foto, Word, Excel, PowerPoint, iWork, testo e CSV</small></span>
          </button>
          <button type="button" class="card-soft import-source-card" data-action="capture-workout-photo">
            <span class="import-source-icon" aria-hidden="true">◎</span>
            <span><strong>Scatta una foto</strong><small>Fotografa direttamente una scheda cartacea</small></span>
          </button>
          <button type="button" class="card-soft import-source-card" data-action="paste-workout-text">
            <span class="import-source-icon" aria-hidden="true">≡</span>
            <span><strong>Incolla testo o Note</strong><small>Copia una scheda da Note, WhatsApp, email o qualsiasi app</small></span>
          </button>
        </div>
        <div class="card-soft import-privacy-note">
          <strong>Elaborazione sul dispositivo</strong>
          <p class="small muted no-margin">Documenti e dati non vengono inviati a un server. Per leggere fotografie e scansioni, la prima analisi OCR deve caricare i componenti inclusi nel sito; successivamente il browser può riutilizzarli dalla cache.</p>
        </div>
        <p class="tiny muted no-margin">Formati principali: PDF, JPG/PNG/WEBP/HEIC, DOCX, XLSX, PPTX, ODT/ODS, Pages/Numbers/Keynote, TXT, Markdown, CSV/TSV, RTF, HTML, XML ed email testuali.</p>`,
      actions: '<button type="button" class="button secondary block" data-action="close-modal">Chiudi</button>',
      autoFocus: false,
    });
  }

  function chooseWorkoutFiles() {
    if (modal.open) closeModal();
    universalFile.value = '';
    universalFile.click();
  }

  function chooseWorkoutCamera() {
    if (modal.open) closeModal();
    cameraFile.value = '';
    cameraFile.click();
  }

  function openPasteWorkoutText() {
    openModal({
      eyebrow: 'IMPORTA DA NOTE',
      title: 'Incolla la scheda',
      body: `
        <div class="input-group">
          <label for="workout-paste-text">Testo della scheda</label>
          <textarea class="textarea import-paste-area" id="workout-paste-text" name="workout-paste-text" required placeholder="Esempio:\nGIORNO 1 - DORSO\nLat Machine\n2x8-10 + 1 DROP\nRematore 4x8-10"></textarea>
        </div>
        <p class="small muted no-margin">Puoi incollare testo copiato da Note, WhatsApp, email, Word o da una pagina web. Prima del salvataggio vedrai sempre un’anteprima modificabile.</p>`,
      actions: `
        <button type="button" class="button secondary" data-action="close-modal">Annulla</button>
        <button type="submit" class="button" value="import-pasted-workout">Analizza testo</button>`,
      onSubmit: async formData => {
        const text = String(formData.get('workout-paste-text') || '').trim();
        if (!text) return;
        const importer = window.VantaUniversalImporter;
        if (!importer?.importText) {
          openUniversalImportError({ code: 'PARSER_LOAD', message: 'Il motore di importazione non è disponibile.' });
          return;
        }
        const token = ++pdfImportToken;
        openUniversalImportLoading([{ name: 'Testo incollato' }], token, 'Analisi del testo…');
        try {
          const result = await importer.importText(text, 'Note incollate.txt', {
            onProgress: progress => updateUniversalImportLoading(token, progress),
          });
          if (token !== pdfImportToken) return;
          pdfImportLoading = false;
          openPdfImportPreview(result, 'Note incollate');
        } catch (error) {
          console.warn('Importazione testo non riuscita', error);
          if (token !== pdfImportToken) return;
          pdfImportLoading = false;
          openUniversalImportError(error);
        }
      },
    });
  }

  function openUniversalImportLoading(files, token, initialLabel = 'Apertura del file…') {
    pdfImportLoading = true;
    const names = [...files].map(file => file.name || 'File').join(', ');
    openModal({
      eyebrow: 'IMPORTAZIONE UNIVERSALE',
      title: 'Analisi della scheda',
      body: `
        <div class="pdf-loading">
          <div class="spinner" aria-hidden="true"></div>
          <div class="grow">
            <strong>${escapeHtml(names)}</strong>
            <p class="small muted no-margin" id="pdf-import-progress" style="margin-top:5px">${escapeHtml(initialLabel)}</p>
          </div>
        </div>
        <div class="card-soft" style="margin-top:16px">
          <p class="small muted no-margin" style="line-height:1.55">Il contenuto viene trasformato in una scheda modificabile. Fotografie e documenti complessi possono richiedere qualche secondo in più.</p>
        </div>`,
      actions: '<button type="button" class="button secondary block" data-action="close-modal">Annulla</button>',
      autoFocus: false,
    });
    modal.dataset.pdfImportToken = String(token);
  }

  function updateUniversalImportLoading(token, progress = {}) {
    if (!pdfImportLoading || token !== pdfImportToken || modal.dataset.pdfImportToken !== String(token)) return;
    const progressEl = modalBody.querySelector('#pdf-import-progress');
    if (!progressEl) return;
    if (progress.label) {
      progressEl.textContent = progress.label;
      return;
    }
    if (progress.phase === 'parsing') {
      progressEl.textContent = 'Riconoscimento di giorni, esercizi, serie e ripetizioni…';
      return;
    }
    if (progress.pageNumber && progress.totalPages) {
      progressEl.textContent = `Lettura pagina ${progress.pageNumber} di ${progress.totalPages}…`;
    }
  }

  function openUniversalImportError(error) {
    const code = error?.code || 'FILE_READ';
    const messages = {
      NO_TEXT: { title: 'Testo non leggibile', text: error?.message || 'Non è stato trovato testo sufficiente per ricostruire la scheda.' },
      NO_EXERCISES: { title: 'Esercizi non riconosciuti', text: 'Il contenuto è stato letto, ma non è stato possibile distinguere con sicurezza esercizi, serie e ripetizioni. Prova a incollare il testo oppure correggi il file rendendo più chiari nomi e prescrizioni.' },
      FILE_TOO_LARGE: { title: 'File troppo grande', text: error.message },
      TOO_MANY_PAGES: { title: 'Troppe pagine', text: error.message },
      TOO_MANY_IMAGES: { title: 'Troppe fotografie', text: error.message },
      PASSWORD: { title: 'Documento protetto', text: error.message },
      INVALID_FILE: { title: 'File non valido', text: error.message },
      MULTI_FILE: { title: 'Selezione non valida', text: error.message },
      LEGACY_OFFICE: { title: 'Formato Office troppo vecchio', text: error.message },
      UNSUPPORTED_FILE: { title: 'Formato non supportato', text: error.message },
      OCR_UNAVAILABLE: { title: 'Lettore foto non disponibile', text: error.message || 'Controlla la connessione e riprova.' },
      OCR_FAILED: { title: 'Foto non leggibile', text: error.message || 'Usa una foto più nitida, dritta e ben illuminata.' },
      OFFICE_READ: { title: 'Documento non leggibile', text: error.message },
      LIBRARY_LOAD: { title: 'Lettore non disponibile', text: error.message || 'Ricarica l’app e riprova.' },
      PARSER_LOAD: { title: 'Motore non disponibile', text: error.message || 'Ricarica l’app e riprova.' },
      PDF_READ: { title: 'PDF non leggibile', text: error?.message || 'Il PDF potrebbe essere danneggiato.' },
      FILE_READ: { title: 'File non leggibile', text: error?.message || 'Il file potrebbe essere danneggiato o usare un formato non riconosciuto.' },
    };
    const content = messages[code] || messages.FILE_READ;
    openModal({
      eyebrow: 'IMPORTAZIONE UNIVERSALE',
      title: content.title,
      body: `
        <div class="empty-state pdf-error-state">
          <div class="empty-icon">!</div>
          <p>${escapeHtml(content.text)}</p>
          ${error?.message && error.message !== content.text ? `<p class="tiny muted no-margin" style="margin-top:8px">Dettaglio: ${escapeHtml(error.message)}</p>` : ''}
        </div>
        <div class="card-soft">
          <strong>Puoi provare in un altro modo</strong>
          <p class="small muted no-margin" style="margin-top:5px;line-height:1.5">Scatta una foto più nitida, esporta il documento come PDF/DOCX oppure copia il testo e usa “Incolla testo o Note”.</p>
        </div>`,
      actions: `
        <button type="button" class="button secondary" data-action="paste-workout-text">Incolla testo</button>
        <button type="button" class="button" data-action="import-workout">Scegli altro</button>`,
      autoFocus: false,
    });
  }

  function renderPdfExerciseEditor(exercise, dayIndex, exerciseIndex) {
    const prefix = `pdf-day-${dayIndex}-exercise-${exerciseIndex}`;
    return `
      <details class="pdf-exercise-editor">
        <summary>
          <div class="grow">
            <strong>${escapeHtml(exercise.name)}</strong>
            ${exercise.muscle ? `<span class="tiny muted pdf-summary-muscle">${escapeHtml(exercise.muscle)}</span>` : ''}
          </div>
          <div class="exercise-meta pdf-exercise-meta">
            <span class="badge accent">${escapeHtml(exercisePrescriptionLabel(exercise))}</span>
            <span class="badge">${exercise.rest}s</span>
          </div>
        </summary>
        <div class="pdf-exercise-fields">
          <label class="pdf-include-control" for="${prefix}-include">
            <input id="${prefix}-include" name="${prefix}-include" type="checkbox" checked>
            <span>Importa questo esercizio</span>
          </label>
          <div class="input-group">
            <label for="${prefix}-name">Nome esercizio</label>
            <input class="input" id="${prefix}-name" name="${prefix}-name" maxlength="80" value="${escapeHtml(exercise.name)}">
          </div>
          <div class="input-group">
            <label for="${prefix}-muscle">Gruppo muscolare</label>
            <input class="input" id="${prefix}-muscle" name="${prefix}-muscle" maxlength="40" placeholder="Es. Petto" value="${escapeHtml(exercise.muscle || '')}">
          </div>
          <div class="form-grid pdf-exercise-grid">
            <div class="input-group">
              <label for="${prefix}-sets">Serie</label>
              <input class="input" id="${prefix}-sets" name="${prefix}-sets" type="number" inputmode="numeric" min="1" max="20" value="${exercise.sets}">
            </div>
            <div class="input-group">
              <label for="${prefix}-reps">Ripetizioni</label>
              <input class="input" id="${prefix}-reps" name="${prefix}-reps" maxlength="40" placeholder="Es. 8-10 oppure 6-8 + 10-12" value="${escapeHtml(exercise.reps)}">
            </div>
            <div class="input-group span-2">
              <label for="${prefix}-set-labels">Etichette delle serie</label>
              <input class="input" id="${prefix}-set-labels" name="${prefix}-set-labels" maxlength="160" placeholder="Es. 1 | 2 | BO oppure 1-2-BO" value="${escapeHtml(setLabelInputValue(exercise))}">
              <p class="tiny muted no-margin">Puoi usare numeri o lettere; 1 | 2 | BO corrisponde a tre serie.</p>
            </div>
            <div class="input-group span-2">
              <label for="${prefix}-set-targets">Target per singola serie</label>
              <input class="input" id="${prefix}-set-targets" name="${prefix}-set-targets" maxlength="160" placeholder="Es. 6-8 | 6-8 | 10-12" value="${escapeHtml(targetInputValue(exercise))}">
            </div>
            <div class="input-group span-2">
              <label for="${prefix}-rest">Recupero in secondi</label>
              <input class="input" id="${prefix}-rest" name="${prefix}-rest" type="number" inputmode="numeric" min="0" max="600" value="${exercise.rest}">
            </div>
          </div>
          <div class="input-group">
            <label for="${prefix}-notes">Note</label>
            <textarea class="textarea" id="${prefix}-notes" name="${prefix}-notes" maxlength="240" placeholder="RPE, tecnica, indicazioni…">${escapeHtml(exercise.notes || '')}</textarea>
          </div>
        </div>
      </details>`;
  }

  function buildPdfPlanFromForm(formData) {
    if (!pendingPdfPlan) return null;
    const days = pendingPdfPlan.days.map((day, dayIndex) => {
      const exercises = day.exercises.map((exercise, exerciseIndex) => {
        const prefix = `pdf-day-${dayIndex}-exercise-${exerciseIndex}`;
        if (!formData.has(`${prefix}-include`)) return null;
        const name = String(formData.get(`${prefix}-name`) || '').trim();
        if (!name) return null;
        const requestedSets = clamp(Math.round(toNumber(formData.get(`${prefix}-sets`), exercise.sets || 3)), 1, 20);
        const labels = labelsFromInput(formData.get(`${prefix}-set-labels`), requestedSets);
        const totalSets = labels.length || requestedSets;
        const finalLabels = labels.length ? labels : Array.from({ length: totalSets }, (_, index) => String(index + 1));
        const reps = String(formData.get(`${prefix}-reps`) || '').trim() || exercise.reps || '8-10';
        return {
          ...exercise,
          name,
          muscle: String(formData.get(`${prefix}-muscle`) || '').trim(),
          sets: totalSets,
          reps,
          setScheme: inferSetScheme(finalLabels),
          setTargets: buildSetTargets(finalLabels, targetsFromInput(formData.get(`${prefix}-set-targets`)), reps),
          rest: clamp(Math.round(toNumber(formData.get(`${prefix}-rest`), exercise.rest || 90)), 0, 600),
          notes: String(formData.get(`${prefix}-notes`) || '').trim(),
        };
      }).filter(Boolean);
      if (!exercises.length) return null;
      return {
        ...day,
        name: String(formData.get(`pdf-day-${dayIndex}-name`) || '').trim() || day.name || `Giorno ${dayIndex + 1}`,
        notes: String(formData.get(`pdf-day-${dayIndex}-notes`) || '').trim(),
        exercises,
      };
    }).filter(Boolean);

    if (!days.length) return null;
    return normalizePlan({
      ...pendingPdfPlan,
      name: String(formData.get('pdf-plan-name') || '').trim() || pendingPdfPlan.name,
      description: String(formData.get('pdf-plan-description') || '').trim(),
      days,
    });
  }

  function openPdfImportPreview(result, fileName) {
    pendingPdfPlan = planWithFreshIds(result.plan);
    const totalExercises = pendingPdfPlan.days.reduce((sum, day) => sum + day.exercises.length, 0);
    const warningHtml = result.warnings?.length ? `
      <div class="stack pdf-warning-list">
        ${result.warnings.map(message => `<div class="card-soft pdf-warning"><span aria-hidden="true">!</span><p class="small no-margin">${escapeHtml(message)}</p></div>`).join('')}
      </div>` : `
      <div class="card-soft pdf-success-note"><span aria-hidden="true">✓</span><p class="small no-margin">La struttura del contenuto è stata riconosciuta. Apri un esercizio per correggere i dati prima dell’importazione.</p></div>`;

    openModal({
      eyebrow: 'ANTEPRIMA IMPORTAZIONE',
      title: 'Controlla la scheda',
      body: `
        <div class="stats-grid pdf-stats">
          <div class="card stat-card"><span class="stat-value">${result.stats.pages}</span><span class="stat-label">Pagine</span></div>
          <div class="card stat-card"><span class="stat-value">${pendingPdfPlan.days.length}</span><span class="stat-label">Giorni</span></div>
          <div class="card stat-card"><span class="stat-value">${totalExercises}</span><span class="stat-label">Esercizi</span></div>
        </div>

        <div class="stack" style="margin-top:16px">
          <div class="input-group">
            <label for="pdf-plan-name">Nome della scheda</label>
            <input class="input" id="pdf-plan-name" name="pdf-plan-name" maxlength="60" required value="${escapeHtml(pendingPdfPlan.name)}">
          </div>
          <div class="input-group">
            <label for="pdf-plan-description">Descrizione</label>
            <textarea class="textarea" id="pdf-plan-description" name="pdf-plan-description" maxlength="240">${escapeHtml(pendingPdfPlan.description || '')}</textarea>
          </div>

          ${warningHtml}

          <div class="card-soft pdf-edit-hint">
            <strong>Prima di importare</strong>
            <p class="small muted no-margin">Puoi rinominare i giorni, aprire ogni esercizio, correggere serie, ripetizioni e recupero oppure togliere la spunta agli esercizi da escludere.</p>
          </div>

          <div class="pdf-preview-list" aria-label="Esercizi riconosciuti">
            ${pendingPdfPlan.days.map((day, dayIndex) => `
              <section class="card-soft pdf-day-preview">
                <div class="pdf-day-heading-fields">
                  <div class="input-group grow">
                    <label for="pdf-day-${dayIndex}-name">Nome del giorno</label>
                    <input class="input" id="pdf-day-${dayIndex}-name" name="pdf-day-${dayIndex}-name" maxlength="50" value="${escapeHtml(day.name)}">
                  </div>
                  <span class="badge">${day.exercises.length} ${day.exercises.length === 1 ? 'esercizio' : 'esercizi'}</span>
                </div>
                <div class="input-group pdf-day-notes">
                  <label for="pdf-day-${dayIndex}-notes">Note del giorno</label>
                  <input class="input" id="pdf-day-${dayIndex}-notes" name="pdf-day-${dayIndex}-notes" maxlength="160" value="${escapeHtml(day.notes || '')}" placeholder="Facoltative">
                </div>
                <div class="pdf-day-exercises">
                  ${day.exercises.map((exercise, exerciseIndex) => renderPdfExerciseEditor(exercise, dayIndex, exerciseIndex)).join('')}
                </div>
              </section>`).join('')}
          </div>

          <p class="tiny muted no-margin">Origine: ${escapeHtml(fileName)}. I dati restano sul dispositivo e il documento non viene inviato a VANTA.</p>
        </div>`,
      actions: `
        <button type="button" class="button secondary" data-action="close-modal">Annulla</button>
        <button type="submit" class="button" value="import-pdf">Importa scheda</button>`,
      onSubmit: formData => {
        const importedPlan = buildPdfPlanFromForm(formData);
        if (!importedPlan) {
          toast('Mantieni almeno un esercizio con un nome valido.', 'error');
          return;
        }
        state.plans.push(importedPlan);
        const importedId = importedPlan.id;
        const firstDayId = importedPlan.days[0]?.id;
        if (firstDayId) ui.expandedDays.add(firstDayId);
        pendingPdfPlan = null;
        saveState();
        closeModal();
        navigate(`plan/${importedId}`);
        toast('Scheda importata. Ora puoi usarla o modificarla.', 'success');
      },
    });
  }

  async function handleUniversalFiles(files) {
    const selected = [...(files || [])].filter(Boolean);
    if (!selected.length) return;
    const importer = window.VantaUniversalImporter;
    if (!importer?.importFiles) {
      openUniversalImportError({ code: 'LIBRARY_LOAD', message: 'Il motore di importazione universale non è disponibile.' });
      return;
    }

    const token = ++pdfImportToken;
    openUniversalImportLoading(selected, token);
    try {
      const result = await importer.importFiles(selected, {
        onProgress: progress => updateUniversalImportLoading(token, progress),
      });
      if (token !== pdfImportToken) return;
      pdfImportLoading = false;
      openPdfImportPreview(result, selected.map(file => file.name).join(', '));
    } catch (error) {
      console.warn('Importazione universale non riuscita', error);
      if (token !== pdfImportToken) return;
      pdfImportLoading = false;
      openUniversalImportError(error);
    }
  }

  async function installApp() {
    if (isStandalone()) {
      toast('VANTA è già installata.', 'success');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice.outcome === 'accepted') toast('Installazione avviata.', 'success');
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal({
      eyebrow: 'INSTALLAZIONE',
      title: isIOS ? 'Aggiungi a Home' : 'Installa dal browser',
      body: isIOS ? `
        <div class="stack">
          <div class="card-soft"><strong>1. Apri il link in Safari</strong><p class="small muted no-margin" style="margin-top:4px">Usa l’indirizzo HTTPS ottenuto dopo la pubblicazione.</p></div>
          <div class="card-soft"><strong>2. Tocca Condividi</strong><p class="small muted no-margin" style="margin-top:4px">È l’icona con il quadrato e la freccia verso l’alto.</p></div>
          <div class="card-soft"><strong>3. Scegli “Aggiungi alla schermata Home”</strong><p class="small muted no-margin" style="margin-top:4px">Se non compare, scorri in fondo, scegli “Modifica azioni” e aggiungila.</p></div>
          <div class="card-soft"><strong>4. Attiva “Apri come app web” e tocca Aggiungi</strong><p class="small muted no-margin" style="margin-top:4px">VANTA comparirà sulla schermata Home.</p></div>
        </div>` : `
        <div class="stack">
          <div class="card-soft"><strong>1. Apri il link in Chrome</strong><p class="small muted no-margin" style="margin-top:4px">Usa l’indirizzo HTTPS ottenuto dopo la pubblicazione.</p></div>
          <div class="card-soft"><strong>2. Apri Altro ⋮</strong><p class="small muted no-margin" style="margin-top:4px">Scegli “Aggiungi alla schermata Home”, quindi “Installa”.</p></div>
          <div class="card-soft"><strong>3. Conferma</strong><p class="small muted no-margin" style="margin-top:4px">VANTA apparirà tra le app e sulla schermata Home.</p></div>
        </div>`,
      actions: '<button type="button" class="button block" data-action="close-modal">Ho capito</button>',
    });
  }

  function deletePlan(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    confirmModal({
      title: 'Eliminare la scheda?',
      message: `“${plan.name}” verrà eliminata. Le sessioni già completate resteranno nello storico.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: () => {
        state.plans = state.plans.filter(item => item.id !== planId);
        state.scheduledWorkouts = state.scheduledWorkouts.filter(item => item.planId !== planId);
        saveState();
        navigate('plans');
        toast('Scheda eliminata.', 'success');
      },
    });
  }

  function duplicatePlan(planId) {
    const plan = getPlan(planId);
    if (!plan) return;
    const copy = planWithFreshIds(plan, ' • copia');
    state.plans.push(copy);
    saveState();
    closeModal();
    navigate(`plan/${copy.id}`);
    toast('Scheda duplicata.', 'success');
  }

  function deleteDay(planId, dayId) {
    const plan = getPlan(planId);
    const day = getDay(planId, dayId);
    if (!plan || !day) return;
    confirmModal({
      title: 'Eliminare il giorno?',
      message: `“${day.name}” e i suoi ${day.exercises.length} esercizi verranno rimossi dalla scheda.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: () => {
        plan.days = plan.days.filter(item => item.id !== dayId);
        state.scheduledWorkouts = state.scheduledWorkouts.filter(item => item.dayId !== dayId);
        ui.expandedDays.delete(dayId);
        saveState();
        renderPlan(planId);
        toast('Giorno eliminato.', 'success');
      },
    });
  }

  function deleteExercise(planId, dayId, exerciseId) {
    const day = getDay(planId, dayId);
    const exercise = day?.exercises.find(item => item.id === exerciseId);
    if (!day || !exercise) return;
    confirmModal({
      title: 'Eliminare l’esercizio?',
      message: `“${exercise.name}” verrà rimosso da questo giorno.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: () => {
        day.exercises = day.exercises.filter(item => item.id !== exerciseId);
        saveState();
        renderPlan(planId);
        toast('Esercizio eliminato.', 'success');
      },
    });
  }

  function moveExercise(planId, dayId, exerciseId, direction) {
    const day = getDay(planId, dayId);
    if (!day) return;
    const index = day.exercises.findIndex(item => item.id === exerciseId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= day.exercises.length) return;
    [day.exercises[index], day.exercises[target]] = [day.exercises[target], day.exercises[index]];
    saveState();
    renderPlan(planId);
  }

  function resetAllData() {
    confirmModal({
      title: 'Eliminare tutti i dati?',
      message: 'L’operazione cancellerà definitivamente schede, calendario, sessioni, progressi e impostazioni da questo dispositivo.',
      confirmLabel: 'Elimina tutto',
      danger: true,
      onConfirm: () => {
        state = createDefaultState();
        ui.expandedDays.clear();
        saveState();
        navigate('home');
        render();
        toast('Dati eliminati.', 'success');
      },
    });
  }

  function deleteSession(sessionId) {
    const session = state.sessions.find(item => item.id === sessionId);
    if (!session) return;
    confirmModal({
      title: 'Eliminare la sessione?',
      message: `La sessione “${session.dayName}” del ${formatDate(session.date, { year: true })} verrà rimossa dai progressi.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: () => {
        state.sessions = state.sessions.filter(item => item.id !== sessionId);
        const scheduled = state.scheduledWorkouts.find(item => item.sessionId === sessionId);
        if (scheduled) {
          scheduled.status = 'planned';
          scheduled.sessionId = '';
          scheduled.completedAt = '';
        }
        saveState();
        renderProgress();
        toast('Sessione eliminata.', 'success');
      },
    });
  }

  document.addEventListener('click', event => {
    const navItem = event.target.closest('.nav-item[data-route]');
    if (navItem) {
      event.preventDefault();
      navigate(navItem.dataset.route);
      return;
    }

    const target = event.target.closest('[data-action]');
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.action;

    switch (action) {
      case 'navigate':
        navigate(target.dataset.route || 'home');
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'new-plan':
        if (modal.open) closeModal();
        openNewPlanModal();
        break;
      case 'open-plan':
        navigate(`plan/${target.dataset.planId}`);
        break;
      case 'plan-options':
        openPlanOptions(target.dataset.planId);
        break;
      case 'edit-plan':
        openEditPlanModal(target.dataset.planId);
        break;
      case 'share-plan':
        if (modal.open) closeModal();
        sharePlan(target.dataset.planId);
        break;
      case 'duplicate-plan':
        duplicatePlan(target.dataset.planId);
        break;
      case 'delete-plan':
        deletePlan(target.dataset.planId);
        break;
      case 'add-day':
        openAddDayModal(target.dataset.planId);
        break;
      case 'toggle-day': {
        const dayId = target.dataset.dayId;
        if (ui.expandedDays.has(dayId)) ui.expandedDays.delete(dayId);
        else ui.expandedDays.add(dayId);
        const { id } = getRoute();
        renderPlan(id);
        break;
      }
      case 'edit-day':
        openEditDayModal(target.dataset.planId, target.dataset.dayId);
        break;
      case 'delete-day':
        deleteDay(target.dataset.planId, target.dataset.dayId);
        break;
      case 'add-exercise':
        openExerciseModal(target.dataset.planId, target.dataset.dayId);
        break;
      case 'edit-exercise':
        openExerciseModal(target.dataset.planId, target.dataset.dayId, target.dataset.exerciseId);
        break;
      case 'exercise-info':
        openExerciseInfo({
          name: target.dataset.exerciseName || 'Esercizio',
          catalogId: target.dataset.catalogId || '',
          catalogMode: target.dataset.catalogMode || 'auto',
          videoUrl: target.dataset.videoUrl || '',
          muscle: target.dataset.muscle || '',
          returnToCatalog: target.dataset.returnCatalog === 'true',
        });
        break;
      case 'open-catalog':
        openExerciseCatalogModal();
        break;
      case 'return-catalog':
        openExerciseCatalogModal({ preserve: true });
        break;
      case 'catalog-page-prev':
        catalogBrowser.page = Math.max(1, catalogBrowser.page - 1);
        renderCatalogBrowser({ resetScroll: true });
        break;
      case 'catalog-page-next': {
        const totalPages = Math.max(1, Math.ceil(filteredCatalogResults(catalogBrowser.query).length / catalogBrowser.pageSize));
        catalogBrowser.page = Math.min(totalPages, catalogBrowser.page + 1);
        renderCatalogBrowser({ resetScroll: true });
        break;
      }
      case 'delete-exercise':
        deleteExercise(target.dataset.planId, target.dataset.dayId, target.dataset.exerciseId);
        break;
      case 'move-exercise':
        moveExercise(target.dataset.planId, target.dataset.dayId, target.dataset.exerciseId, target.dataset.direction);
        break;
      case 'schedule-workout':
        openScheduleWorkoutModal(target.dataset.date || ui.calendarSelectedDate);
        break;
      case 'edit-schedule':
        openScheduleWorkoutModal('', target.dataset.scheduleId);
        break;
      case 'delete-schedule':
        deleteScheduledWorkout(target.dataset.scheduleId);
        break;
      case 'start-scheduled-workout': {
        const scheduled = getScheduledWorkout(target.dataset.scheduleId);
        if (!scheduled) {
          toast('Programmazione non trovata.', 'error');
          break;
        }
        const launch = () => startWorkout(scheduled.planId, scheduled.dayId, { scheduleId: scheduled.id });
        if (scheduled.date > localDateKey(new Date())) {
          confirmModal({
            title: 'Avviare in anticipo?',
            message: `L’allenamento è programmato per ${formatDate(dateFromKey(scheduled.date), { year: true })}. La sessione verrà registrata con quella data.`,
            confirmLabel: 'Avvia comunque',
            onConfirm: launch,
          });
        } else {
          launch();
        }
        break;
      }
      case 'skip-schedule': {
        const scheduled = getScheduledWorkout(target.dataset.scheduleId);
        if (scheduled) {
          scheduled.status = 'skipped';
          saveState();
          renderCalendar();
          toast('Allenamento segnato come saltato.', 'success');
        }
        break;
      }
      case 'restore-schedule': {
        const scheduled = getScheduledWorkout(target.dataset.scheduleId);
        if (scheduled) {
          scheduled.status = 'planned';
          saveState();
          renderCalendar();
          toast('Allenamento ripristinato.', 'success');
        }
        break;
      }
      case 'select-calendar-date': {
        const selected = normalizeDateKey(target.dataset.date);
        ui.calendarSelectedDate = selected;
        const selectedDate = dateFromKey(selected);
        if (selectedDate.getMonth() !== ui.calendarMonth.getMonth() || selectedDate.getFullYear() !== ui.calendarMonth.getFullYear()) {
          ui.calendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        }
        renderCalendar();
        break;
      }
      case 'calendar-prev-month':
        ui.calendarMonth = new Date(ui.calendarMonth.getFullYear(), ui.calendarMonth.getMonth() - 1, 1);
        renderCalendar();
        break;
      case 'calendar-next-month':
        ui.calendarMonth = new Date(ui.calendarMonth.getFullYear(), ui.calendarMonth.getMonth() + 1, 1);
        renderCalendar();
        break;
      case 'calendar-today': {
        const today = new Date();
        ui.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        ui.calendarSelectedDate = localDateKey(today);
        renderCalendar();
        break;
      }
      case 'calendar-open-date': {
        const selected = normalizeDateKey(target.dataset.date);
        const date = dateFromKey(selected);
        ui.calendarSelectedDate = selected;
        ui.calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        navigate('calendar');
        break;
      }
      case 'start-workout':
        startWorkout(target.dataset.planId, target.dataset.dayId);
        break;
      case 'finish-workout':
        openFinishWorkoutModal();
        break;
      case 'abandon-workout':
        confirmModal({
          title: 'Abbandonare la sessione?',
          message: 'I dati inseriti in questo allenamento non verranno salvati nello storico.',
          confirmLabel: 'Abbandona',
          danger: true,
          onConfirm: () => {
            state.activeSession = null;
            restTimer = null;
            saveState();
            renderWorkout();
            toast('Sessione abbandonata.', 'success');
          },
        });
        break;
      case 'add-set': {
        const exerciseIndex = Number(target.dataset.exerciseIndex);
        const exercise = state.activeSession?.exercises?.[exerciseIndex];
        if (!exercise) break;
        const snapshot = previousExerciseSnapshot(exercise.name, exercise.catalogId, exercise.catalogMode, exercise.muscle);
        const previous = snapshot?.exercise || null;
        const setIndex = exercise.sets.length;
        const newTarget = { label: String(setIndex + 1), targetLabel: String(setIndex + 1) };
        const previousSet = previousSetForTarget(previous, newTarget, setIndex);
        exercise.sets.push({
          id: uid('set'),
          weight: '',
          reps: '',
          completed: false,
          targetLabel: String(setIndex + 1),
          targetReps: exercise.targetReps || '',
          setType: 'standard',
          previousWeight: previousSet?.weight ?? '',
          previousReps: previousSet?.reps ?? '',
          previousLabel: previousSet?.targetLabel || String(setIndex + 1),
        });
        saveState();
        renderActiveWorkout();
        break;
      }
      case 'remove-set': {
        const exerciseIndex = Number(target.dataset.exerciseIndex);
        const exercise = state.activeSession?.exercises?.[exerciseIndex];
        if (!exercise || exercise.sets.length <= 1) break;
        exercise.sets.pop();
        saveState();
        renderActiveWorkout();
        break;
      }
      case 'copy-previous': {
        const exerciseIndex = Number(target.dataset.exerciseIndex);
        const exercise = state.activeSession?.exercises?.[exerciseIndex];
        if (!exercise) break;
        exercise.sets.forEach(set => {
          if (toNumber(set.previousWeight) > 0) set.weight = set.previousWeight;
          if (toNumber(set.previousReps) > 0) set.reps = set.previousReps;
          set.completed = false;
        });
        saveState();
        renderActiveWorkout();
        toast('Valori precedenti copiati.', 'success');
        break;
      }
      case 'start-rest':
        restTimer = { endsAt: Date.now() + Number(target.dataset.seconds || 0) * 1000, label: target.dataset.label || '' };
        updateTimers();
        toast(`Recupero da ${target.dataset.seconds}s avviato.`, 'success');
        break;
      case 'cancel-rest':
        restTimer = null;
        updateTimers();
        break;
      case 'set-progress-metric':
        ui.progressMetric = target.dataset.metric || 'weight';
        renderProgress();
        break;
      case 'set-progress-range':
        ui.progressRange = target.dataset.range || '90';
        renderProgress();
        break;
      case 'session-detail':
        openSessionDetail(target.dataset.sessionId);
        break;
      case 'delete-session':
        deleteSession(target.dataset.sessionId);
        break;
      case 'edit-profile':
        openEditProfileModal();
        break;
      case 'choose-profile-image':
        chooseProfileImage();
        break;
      case 'remove-profile-image':
        removeProfileImage();
        break;
      case 'share-app':
        shareApp();
        break;
      case 'export-data':
        exportBackup();
        break;
      case 'import-pdf':
      case 'import-workout':
        openWorkoutImportModal();
        break;
      case 'choose-workout-file':
        chooseWorkoutFiles();
        break;
      case 'capture-workout-photo':
        chooseWorkoutCamera();
        break;
      case 'paste-workout-text':
        openPasteWorkoutText();
        break;
      case 'import-data':
        importFile.value = '';
        importFile.click();
        break;
      case 'reset-data':
        resetAllData();
        break;
      case 'install-app':
        installApp();
        break;
      case 'dismiss-install':
        state.preferences.installDismissed = true;
        saveState();
        renderHome();
        break;
      default:
        break;
    }
  });

  document.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-catalog-search]')) {
      catalogBrowser.query = target.value;
      catalogBrowser.page = 1;
      renderCatalogBrowser();
      return;
    }
    if (target.matches('#exercise-name')) {
      updateCatalogAssociationPreview({ autoFillMuscle: true });
      return;
    }
    if (target.matches('#exercise-muscle')) {
      target.dataset.autoFilled = 'false';
      target.dataset.userEdited = 'true';
      updateCatalogAssociationPreview();
      return;
    }
    if (target.matches('#exercise-set-labels')) {
      const countInput = document.querySelector('#exercise-sets');
      const labels = labelsFromInput(target.value, countInput?.value || 3);
      if (countInput && labels.length) countInput.value = String(labels.length);
      return;
    }
    if (target.matches('input[name$="-set-labels"]')) {
      const prefix = String(target.name || '').replace(/-set-labels$/, '');
      const countInput = document.getElementById(`${prefix}-sets`);
      const labels = labelsFromInput(target.value, countInput?.value || 3);
      if (countInput && labels.length) countInput.value = String(labels.length);
      return;
    }
    if (target.matches('[data-set-field="weight"], [data-set-field="reps"], [data-set-field="label"]')) {
      const exerciseIndex = Number(target.dataset.exerciseIndex);
      const setIndex = Number(target.dataset.setIndex);
      const field = target.dataset.setField;
      const set = state.activeSession?.exercises?.[exerciseIndex]?.sets?.[setIndex];
      if (!set) return;
      if (field === 'label') {
        set.targetLabel = normalizeSetLabel(target.value, setIndex);
        set.setType = setTypeFromLabel(set.targetLabel);
        const row = target.closest('tr');
        if (row) {
          row.classList.remove('backoff-row', 'drop-row', 'rest-pause-row');
          const rowClass = setRowClass(set.setType);
          if (rowClass) row.classList.add(rowClass);
        }
        const exercise = state.activeSession?.exercises?.[exerciseIndex];
        const previous = previousExercisePerformance(exercise?.name || '', exercise?.catalogId || '', exercise?.catalogMode || 'auto', exercise?.muscle || '');
        const previousSet = previousSetForTarget(previous, set, setIndex);
        set.previousWeight = previousSet?.weight ?? set.previousWeight ?? '';
        set.previousReps = previousSet?.reps ?? set.previousReps ?? '';
        set.previousLabel = previousSet?.targetLabel || set.targetLabel;
        if (row) {
          const previousValue = row.querySelector('.ghost-previous-value');
          const previousMeta = row.querySelector('.ghost-set-meta > span:first-child');
          const hasPrevious = toNumber(set.previousWeight) > 0 || toNumber(set.previousReps) > 0;
          if (previousValue) previousValue.innerHTML = hasPrevious ? `${formatNumber(set.previousWeight)} <span>${escapeHtml(state.profile.unit)}</span> × ${formatNumber(set.previousReps, 0)}` : '—';
          if (previousMeta) previousMeta.textContent = hasPrevious ? set.previousLabel : 'Nessun dato';
        }
        saveState();
        updateGhostComparison(exerciseIndex);
        return;
      }
      set[field] = target.value;
      if (toNumber(set.weight) > 0 && toNumber(set.reps) > 0) {
        set.completed = true;
        const checkbox = target.closest('tr')?.querySelector('[data-set-field="completed"]');
        if (checkbox) checkbox.checked = true;
      } else {
        set.completed = false;
        const checkbox = target.closest('tr')?.querySelector('[data-set-field="completed"]');
        if (checkbox) checkbox.checked = false;
      }
      saveState();
      updateActiveWorkoutSummary();
      return;
    }
    if (target.matches('[data-field="session-notes"]')) {
      if (state.activeSession) {
        state.activeSession.notes = target.value;
        saveState();
      }
    }
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('#exercise-catalog')) {
      updateCatalogAssociationPreview({ autoFillMuscle: true });
      return;
    }
    if (target.matches('[data-set-field="completed"]')) {
      const exerciseIndex = Number(target.dataset.exerciseIndex);
      const setIndex = Number(target.dataset.setIndex);
      const set = state.activeSession?.exercises?.[exerciseIndex]?.sets?.[setIndex];
      if (!set) return;
      if (target.checked && !(toNumber(set.weight) > 0 && toNumber(set.reps) > 0)) {
        target.checked = false;
        toast('Inserisci peso e ripetizioni prima di completare la serie.', 'error');
        return;
      }
      set.completed = target.checked;
      saveState();
      updateActiveWorkoutSummary();
      return;
    }
    if (target.matches('[data-progress-control="exercise"]')) {
      ui.progressExercise = target.value;
      renderProgress();
    }
  });

  modalForm.addEventListener('submit', event => {
    event.preventDefault();
    const value = event.submitter?.value;
    if (value === 'cancel') {
      closeModal();
      return;
    }
    if (!modalForm.reportValidity()) return;
    modalHandler?.(new FormData(modalForm), value);
  });

  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      handleImportedJson(JSON.parse(text));
    } catch (error) {
      console.error(error);
      toast('Impossibile leggere il file.', 'error');
    }
  });

  universalFile?.addEventListener('change', () => {
    const files = universalFile.files;
    if (files?.length) handleUniversalFiles(files);
  });

  cameraFile?.addEventListener('change', () => {
    const files = cameraFile.files;
    if (files?.length) handleUniversalFiles(files);
  });

  profileImageFile?.addEventListener('change', () => {
    const file = profileImageFile.files?.[0];
    if (file) handleProfileImageFile(file);
  });

  window.addEventListener('hashchange', () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    state.preferences.installDismissed = true;
    saveState();
    toast('VANTA installata.', 'success');
  });

  if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(error => console.warn('Service worker non registrato', error)));
  }

  if (!location.hash) history.replaceState({}, '', `${location.pathname}${location.search}#/home`);
  render();
  handleSharedPlanFromUrl();
  window.setInterval(updateTimers, 1000);
})();
