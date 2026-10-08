'use strict';

const $ = id => document.getElementById(id);

const app = $('app');
const video = $('videoPlayer');
const placeholder = $('videoPlaceholder');
const videoStatus = $('videoStatus');
const upload = $('videoUpload');
const uploadStatus = $('videoUploadStatus');
const textBox = $('textContent');
const current = $('currentSegment');
const textBar = $('textProgress');
const ttsBar = $('ttsProgress');
const textPct = $('textProgressValue');
const ttsPct = $('ttsProgressValue');
const voiceStatus = $('ttsVoiceStatus');
const ttsStatus = $('ttsStatus');
const rate = $('ttsRate');
const rateValue = $('ttsRateValue');
const textDoneEl = $('textCompletion');
const ttsDoneEl = $('ttsCompletion');
const gateEl = $('completionGate');
const system = $('systemStatus');
const playBtn = $('playButton');
const pauseBtn = $('pauseButton');
const stopBtn = $('stopButton');
const previewBtn = $('previewButton');
const removeBtn = $('removeVideoButton');
const saveBtn = $('saveSettingsButton');
const resetBtn = $('resetButton');
const contentMode = $('contentMode');
const contentModeStatus = $('contentModeStatus');

const source =
  app?.dataset.source ||
  './data/lalita-sahasranama-ratnavali.json';

const PLAYBACK_STATES = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  COMPLETED: 'completed'
});

const CONTENT_MODES = Object.freeze({
  STOTRA: 'stotra',
  NAMAVALI: 'namavali'
});

const TTS = Object.freeze({
  DEFAULT_RATE: 0.90,
  MIN_RATE: 0.76,
  MAX_RATE: 1.00,

  /*
   * पुरुष voice को ऊँचा, पतला और अपेक्षाकृत स्त्रैण-
   * कोमल बनाने के लिए नियंत्रित pitch।
   */
  PITCH: 1.32,

  /*
   * स्पष्टता बनाए रखते हुए थोड़ी कोमल loudness।
   */
  VOLUME: 0.96,

  /*
   * Android/Chrome में voice list देर से उपलब्ध हो सकती है।
   */
  VOICE_WAIT_MS: 3000,
  VOICE_STEP_MS: 120
});

const state = {
  initialized: false,

  sourceData: null,
  dataReady: false,

  mode: CONTENT_MODES.STOTRA,
  segments: [],

  index: 0,
  textIndex: -1,
  ttsCompleted: 0,

  playbackState: PLAYBACK_STATES.IDLE,

  textDone: false,
  ttsDone: false,

  speechActive: false,
  speechToken: 0,

  ttsSupported: false,
  voice: null,

  videoReady: false,
  previewing: false,

  objectUrl: '',
  lastVideoFileName: ''
};

function msg(text) {
  if (system) {
    system.textContent = String(text);
  }
}

function vmsg(text) {
  if (videoStatus) {
    videoStatus.textContent = String(text);
  }
}

function umsg(text) {
  if (uploadStatus) {
    uploadStatus.textContent = String(text);
  }
}

function speech() {
  return 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

function clampRate(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return TTS.DEFAULT_RATE;
  }

  return Math.max(
    0.6,
    Math.min(1.2, n)
  );
}

function reducedMotion() {
  return Boolean(
    window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
  );
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(
      key,
      String(value)
    );
  } catch (error) {
    /*
     * Storage optional है।
     * App बिना storage के भी सामान्य रूप से चलता रहेगा।
     */
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    /*
     * Storage optional है।
     */
  }
}

function setPlaybackState(next) {
  state.playbackState = next;
  updateControlState();
}

function updateControlState() {
  const playing =
    state.playbackState ===
    PLAYBACK_STATES.PLAYING;

  const paused =
    state.playbackState ===
    PLAYBACK_STATES.PAUSED;

  const canPlay =
    state.dataReady &&
    state.videoReady &&
    state.ttsSupported;

  if (playBtn) {
    playBtn.disabled =
      !canPlay ||
      state.previewing ||
      playing;
  }

  if (pauseBtn) {
    pauseBtn.disabled = !playing;
  }

  if (stopBtn) {
    stopBtn.disabled =
      !state.videoReady &&
      !state.previewing &&
      !playing &&
      !paused;
  }

  if (previewBtn) {
    previewBtn.disabled =
      !state.videoReady ||
      playing ||
      paused;

    previewBtn.textContent =
      state.previewing
        ? 'Preview रोकें'
        : 'वीडियो Preview';
  }

  if (removeBtn) {
    removeBtn.disabled =
      !state.videoReady &&
      !state.previewing;
  }

  if (contentMode) {
    contentMode.disabled =
      playing ||
      paused ||
      state.previewing;
  }
}

function updateRate() {
  if (!rate || !rateValue) {
    return;
  }

  const safe =
    clampRate(rate.value);

  rate.value =
    String(safe);

  rateValue.textContent =
    safe.toFixed(2);
}

function setProgress(
  bar,
  label,
  percent
) {
  const n =
    Number(percent);

  const safe =
    Number.isFinite(n)
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(n)
          )
        )
      : 0;

  if (bar) {
    bar.value = safe;
  }

  if (label) {
    label.textContent =
      `${safe}%`;
  }
}

function resetProgress() {
  setProgress(
    textBar,
    textPct,
    0
  );

  setProgress(
    ttsBar,
    ttsPct,
    0
  );
}

function resetCompletion() {
  state.textDone = false;
  state.ttsDone = false;

  if (textDoneEl) {
    textDoneEl.textContent =
      'पाठ: अपूर्ण';

    textDoneEl.dataset.complete =
      'false';
  }

  if (ttsDoneEl) {
    ttsDoneEl.textContent =
      'TTS: अपूर्ण';

    ttsDoneEl.dataset.complete =
      'false';
  }

  if (gateEl) {
    gateEl.textContent =
      'वाचन जारी है';

    gateEl.dataset.complete =
      'false';
  }
}

function setCompletion(type) {
  if (type === 'text') {
    state.textDone = true;
  }

  if (type === 'tts') {
    state.ttsDone = true;
  }

  if (textDoneEl) {
    textDoneEl.textContent =
      state.textDone
        ? 'पाठ: पूर्ण'
        : 'पाठ: अपूर्ण';

    textDoneEl.dataset.complete =
      String(state.textDone);
  }

  if (ttsDoneEl) {
    ttsDoneEl.textContent =
      state.ttsDone
        ? 'TTS: पूर्ण'
        : 'TTS: अपूर्ण';

    ttsDoneEl.dataset.complete =
      String(state.ttsDone);
  }

  const done =
    state.textDone &&
    state.ttsDone;

  if (gateEl) {
    gateEl.textContent =
      done
        ? 'वाचन पूर्ण'
        : 'वाचन जारी है';

    gateEl.dataset.complete =
      String(done);
  }

  if (done) {
    finishPlayback();
  }
}

function finishPlayback() {
  if (
    !state.textDone ||
    !state.ttsDone
  ) {
    return;
  }

  state.speechActive = false;
  state.index =
    state.segments.length;

  video?.pause();

  setPlaybackState(
    PLAYBACK_STATES.COMPLETED
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      'अंतिम TTS segment पूर्ण हुआ।';
  }

  vmsg(
    'पाठ और TTS दोनों पूर्ण — वीडियो रुक गया।'
  );

  msg(
    'वाचन पूर्ण हुआ।'
  );
}

function clearActive() {
  textBox
    ?.querySelectorAll(
      '.segment.active'
    )
    .forEach(node => {
      node.classList.remove(
        'active'
      );
    });
}

function appendText(
  container,
  text
) {
  const parts =
    String(text).split('\n');

  parts.forEach(
    (part, index) => {
      if (index > 0) {
        container.append(
          document.createElement(
            'br'
          )
        );
      }

      container.append(
        document.createTextNode(
          part
        )
      );
    }
  );
}

function setCurrentText(text) {
  if (!current) {
    return;
  }

  current.replaceChildren();

  appendText(
    current,
    text
  );
}

function renderText() {
  if (!textBox) {
    return;
  }

  textBox.replaceChildren();

  const fragment =
    document.createDocumentFragment();

  state.segments.forEach(
    (segment, index) => {
      const node =
        document.createElement(
          'span'
        );

      node.className =
        'segment';

      node.id =
        `seg-${index}`;

      node.dataset.index =
        String(index);

      appendText(
        node,
        segment.text
      );

      fragment.append(
        node,
        document.createTextNode(
          ' '
        )
      );
    }
  );

  textBox.append(fragment);
}

function normalizeSegment(
  item,
  fallbackIndex
) {
  if (typeof item === 'string') {
    const text =
      item.trim();

    return text
      ? {
          id:
            `segment-${
              fallbackIndex + 1
            }`,
          number:
            fallbackIndex + 1,
          text
        }
      : null;
  }

  if (
    !item ||
    typeof item !== 'object'
  ) {
    return null;
  }

  const text =
    String(
      item.text ??
      item.name ??
      ''
    ).trim();

  if (!text) {
    return null;
  }

  const n =
    Number(item.number);

  return {
    id:
      item.id ??
      `segment-${
        fallbackIndex + 1
      }`,

    number:
      Number.isInteger(n)
        ? n
        : fallbackIndex + 1,

    text
  };
}

function assertSequentialNumbers(
  items,
  label,
  expectedCount
) {
  if (
    !Array.isArray(items) ||
    items.length !== expectedCount
  ) {
    throw new Error(
      `${label} में ठीक ${expectedCount} entries अपेक्षित हैं।`
    );
  }

  for (
    let i = 0;
    i < items.length;
    i += 1
  ) {
    if (
      Number(
        items[i]?.number
      ) !== i + 1
    ) {
      throw new Error(
        `${label} numbering त्रुटि: स्थान ${
          i + 1
        } पर ${
          items[i]?.number ??
          'अज्ञात'
        } मिला।`
      );
    }
  }
}

function validateCanonicalData(
  data
) {
  if (
    !data ||
    typeof data !== 'object'
  ) {
    throw new Error(
      'Canonical JSON object नहीं मिला।'
    );
  }

  const stotra =
    Array.isArray(
      data.segments
    )
      ? data.segments
      : [];

  const namavali =
    Array.isArray(
      data.namavali
    )
      ? data.namavali
      : [];

  assertSequentialNumbers(
    stotra,
    'स्तोत्र',
    182
  );

  assertSequentialNumbers(
    namavali,
    'सहस्रनामावली',
    1000
  );

  if (
    !String(
      data.stotraCompletion ||
      ''
    ).trim()
  ) {
    throw new Error(
      'stotraCompletion उपलब्ध नहीं है।'
    );
  }

  if (
    !String(
      data.colophon ||
      ''
    ).trim()
  ) {
    throw new Error(
      'colophon उपलब्ध नहीं है।'
    );
  }

  return data;
}

function buildModeSegments(mode) {
  const data =
    state.sourceData;

  if (!data) {
    return [];
  }

  if (
    mode ===
    CONTENT_MODES.NAMAVALI
  ) {
    return data.namavali
      .map(normalizeSegment)
      .filter(Boolean)
      .map(item => ({
        id: item.id,
        number: item.number,
        text: item.text,
        type: 'namavali'
      }));
  }

  const segments =
    data.segments
      .map(normalizeSegment)
      .filter(Boolean)
      .map(item => ({
        id: item.id,
        number: item.number,
        text: item.text,
        type: 'stotra'
      }));

  segments.push({
    id:
      'stotra-completion',

    number:
      segments.length + 1,

    text:
      String(
        data.stotraCompletion
      ).trim(),

    type:
      'stotra-completion'
  });

  return segments;
}

function describeMode() {
  return state.mode ===
    CONTENT_MODES.NAMAVALI

    ? 'श्रीललितासहस्रनामावली — 1000 नाम'

    : 'श्रीललितासहस्रनामस्तोत्रम् — 182 श्लोक + समापन';
}

function applyMode(
  mode,
  silent = false
) {
  if (
    mode !==
      CONTENT_MODES.STOTRA &&
    mode !==
      CONTENT_MODES.NAMAVALI
  ) {
    mode =
      CONTENT_MODES.STOTRA;
  }

  if (!state.sourceData) {
    return;
  }

  if (
    state.playbackState ===
      PLAYBACK_STATES.PLAYING ||
    state.playbackState ===
      PLAYBACK_STATES.PAUSED ||
    state.previewing
  ) {
    stop(true);
  }

  state.mode = mode;

  state.segments =
    buildModeSegments(
      mode
    );

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  if (contentMode) {
    contentMode.value =
      mode;
  }

  if (contentModeStatus) {
    contentModeStatus.textContent =
      describeMode();
  }

  renderText();
  clearActive();
  resetCompletion();
  resetProgress();
  setCurrentText('');

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      'वाचन के लिए तैयार।';
  }

  if (!silent) {
    msg(
      `${describeMode()} तैयार है।`
    );
  }
}

async function loadCanonicalData() {
  const response =
    await fetch(
      source,
      {
        cache: 'no-store'
      }
    );

  if (!response.ok) {
    throw new Error(
      `JSON HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  state.sourceData =
    validateCanonicalData(
      data
    );

  state.dataReady =
    true;

  applyMode(
    CONTENT_MODES.STOTRA,
    true
  );

  msg(
    'Canonical data सत्यापित: 182 श्लोक और 1000 नाम उपलब्ध हैं।'
  );
}

/* =========================================================
   VOICE SELECTION
   ========================================================= */

function voiceDescriptor(
  voice
) {
  if (!voice) {
    return '';
  }

  return `${voice.name || ''} ${
    voice.voiceURI || ''
  }`.trim();
}

function voiceLang(voice) {
  return String(
    voice?.lang || ''
  )
    .trim()
    .toLowerCase();
}

function hasMarker(
  text,
  markers
) {
  const s =
    String(text || '')
      .toLowerCase();

  return markers.some(
    marker =>
      s.includes(
        String(
          marker
        ).toLowerCase()
      )
  );
}

const FEMALE_MARKERS = [
  'female',
  'woman',
  'girl',
  'lady',
  'स्त्री',
  'महिला',
  'nari',
  'नारी'
];

const MALE_MARKERS = [
  'male',
  'man',
  'boy',
  'gent',
  'gentleman',
  'masculine',
  'पुरुष',
  'नर',
  'male voice'
];

const NATURAL_MARKERS = [
  'natural',
  'neural',
  'premium',
  'enhanced',
  'wavenet',
  'studio',
  'online'
];

function isFemaleVoice(
  voice
) {
  return hasMarker(
    voiceDescriptor(voice),
    FEMALE_MARKERS
  );
}

function isMaleVoice(
  voice
) {
  const descriptor =
    voiceDescriptor(
      voice
    );

  const lower =
    descriptor.toLowerCase();

  return (
    hasMarker(
      descriptor,
      MALE_MARKERS
    ) ||
    [
      'ravi',
      'hemant',
      'amit',
      'prabhat',
      'abhay',
      'arjun',
      'rahul',
      'rohit',
      'sanjay',
      'dev',
      'krishna',
      'neeraj',
      'manoj',
      'vijay',
      'anil'
    ].some(
      name =>
        lower.includes(name)
    )
  );
}

function isSanskritVoice(
  voice
) {
  const lang =
    voiceLang(voice);

  const descriptor =
    voiceDescriptor(
      voice
    );

  return (
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    /sanskrit|संस्कृत|vedic|वेद/i.test(
      descriptor
    )
  );
}

function isHindiVoice(
  voice
) {
  const lang =
    voiceLang(voice);

  const descriptor =
    voiceDescriptor(
      voice
    );

  return (
    lang === 'hi' ||
    lang.startsWith('hi-') ||
    /hindi|हिन्दी|हिंदी/i.test(
      descriptor
    )
  );
}

function isIndianVoice(
  voice
) {
  const lang =
    voiceLang(voice);

  return (
    isSanskritVoice(
      voice
    ) ||
    isHindiVoice(
      voice
    ) ||
    /^en-in$/i.test(
      lang
    ) ||
    /-in$/i.test(
      lang
    )
  );
}

function isNaturalVoice(
  voice
) {
  return hasMarker(
    voiceDescriptor(voice),
    NATURAL_MARKERS
  );
}

function scoreVoice(
  voice
) {
  /*
   * Female-marked voice को नहीं चुनते।
   * लेकिन unknown-gender voice को reject नहीं करते,
   * क्योंकि browser अक्सर gender metadata देता ही नहीं।
   */
  if (
    !voice ||
    isFemaleVoice(voice)
  ) {
    return -Infinity;
  }

  const lang =
    voiceLang(voice);

  const descriptor =
    voiceDescriptor(
      voice
    );

  let score = 0;

  /*
   * Sanskrit सबसे पहली प्राथमिकता।
   */
  if (
    isSanskritVoice(
      voice
    )
  ) {
    score += 1800;
  }

  if (lang === 'sa-in') {
    score += 500;
  }

  if (lang === 'sa') {
    score += 450;
  }

  /*
   * Sanskrit उपलब्ध न हो तो Hindi।
   */
  if (
    isHindiVoice(
      voice
    )
  ) {
    score += 1500;
  }

  if (lang === 'hi-in') {
    score += 400;
  }

  if (lang === 'hi') {
    score += 350;
  }

  /*
   * अन्य भारतीय voice अंतिम regional fallback।
   */
  if (
    isIndianVoice(
      voice
    )
  ) {
    score += 250;
  }

  /*
   * यदि Browser voice में male metadata मिलता है,
   * उसे बहुत ऊँची प्राथमिकता।
   */
  if (
    isMaleVoice(
      voice
    )
  ) {
    score += 1200;
  }

  if (
    isNaturalVoice(
      voice
    )
  ) {
    score += 180;
  }

  if (
    voice.localService === false
  ) {
    score += 30;
  }

  if (
    /google|microsoft|apple/i.test(
      descriptor
    )
  ) {
    score += 25;
  }

  /*
   * Indian English एक उपयोगी pronunciation fallback है।
   */
  if (
    /^en-in$/i.test(
      lang
    )
  ) {
    score += 500;
  }

  /*
   * Unknown gender voice को भी रहने देते हैं।
   * यही पिछली "no voice" समस्या का महत्वपूर्ण समाधान है।
   */
  if (
    !isMaleVoice(
      voice
    )
  ) {
    score += 80;
  }

  return score;
}

function availableVoices() {
  const synth =
    speech();

  if (!synth) {
    return [];
  }

  try {
    return synth.getVoices() || [];
  } catch (error) {
    return [];
  }
}

function chooseVoice() {
  const voices =
    availableVoices();

  if (!voices.length) {
    return null;
  }

  /*
   * पहले से saved compatible voice हो तो
   * उसे बनाए रखें।
   */
  const savedUri =
    safeStorageGet(
      'lalitaTtsVoiceURI'
    );

  if (savedUri) {
    const saved =
      voices.find(
        voice =>
          String(
            voice.voiceURI || ''
          ) ===
            String(savedUri) &&
          !isFemaleVoice(
            voice
          )
      );

    if (saved) {
      return saved;
    }
  }

  const ranked =
    voices
      .map(
        (voice, index) => ({
          voice,
          score:
            scoreVoice(
              voice
            ),
          index
        })
      )
      .filter(
        item =>
          Number.isFinite(
            item.score
          )
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.index - b.index
      );

  return (
    ranked[0]?.voice ||
    null
  );
}

function refreshVoice() {
  const voices =
    availableVoices();

  if (!voices.length) {
    state.voice = null;

    if (voiceStatus) {
      voiceStatus.textContent =
        'Browser की voice list अभी उपलब्ध नहीं है।';
    }

    updateControlState();

    return null;
  }

  state.voice =
    chooseVoice();

  if (state.voice) {
    safeStorageSet(
      'lalitaTtsVoiceURI',
      state.voice.voiceURI || ''
    );

    const label =
      isMaleVoice(
        state.voice
      )
        ? 'पुरुष voice'
        : 'उपलब्ध उपयुक्त voice';

    if (voiceStatus) {
      voiceStatus.textContent =
        `${label}: ${
          state.voice.name ||
          'Unnamed'
        } (${
          state.voice.lang ||
          'unknown'
        })`;
    }
  } else if (voiceStatus) {
    voiceStatus.textContent =
      'इस Browser में उपयोग योग्य TTS voice उपलब्ध नहीं है।';
  }

  updateControlState();

  return state.voice;
}

function delay(ms) {
  return new Promise(
    resolve => {
      window.setTimeout(
        resolve,
        ms
      );
    }
  );
}

async function ensureVoice() {
  let voice =
    refreshVoice();

  if (voice) {
    return voice;
  }

  const deadline =
    Date.now() +
    TTS.VOICE_WAIT_MS;

  while (
    Date.now() <
    deadline
  ) {
    await delay(
      TTS.VOICE_STEP_MS
    );

    voice =
      refreshVoice();

    if (voice) {
      return voice;
    }
  }

  return refreshVoice();
}

/* =========================================================
   TEXT / TTS PROGRESS
   ========================================================= */

function highlight(index) {
  clearActive();

  const node =
    $(`seg-${index}`);

  const item =
    state.segments[index];

  if (!node || !item) {
    return;
  }

  node.classList.add(
    'active'
  );

  node.scrollIntoView({
    behavior:
      reducedMotion()
        ? 'auto'
        : 'smooth',

    block: 'center'
  });

  setCurrentText(
    item.text
  );
}

function updateTextProgress(
  index
) {
  if (
    !state.segments.length ||
    index < 0
  ) {
    return;
  }

  state.textIndex =
    Math.min(
      index,
      state.segments.length - 1
    );

  const percent =
    (
      (state.textIndex + 1) *
      100
    ) /
    state.segments.length;

  setProgress(
    textBar,
    textPct,
    percent
  );

  if (
    state.textIndex >=
    state.segments.length - 1
  ) {
    setCompletion(
      'text'
    );
  }
}

function updateTtsProgress(
  completed
) {
  state.ttsCompleted =
    Math.max(
      0,
      Math.min(
        completed,
        state.segments.length
      )
    );

  if (
    !state.segments.length
  ) {
    return;
  }

  const percent =
    (
      state.ttsCompleted *
      100
    ) /
    state.segments.length;

  setProgress(
    ttsBar,
    ttsPct,
    percent
  );

  if (
    state.ttsCompleted >=
    state.segments.length
  ) {
    setCompletion(
      'tts'
    );
  }
}

/* =========================================================
   SPEECH
   ========================================================= */

function handleTtsError(
  code
) {
  const errorCode =
    String(
      code || ''
    ).toLowerCase();

  /*
   * cancel()/stop() पर कुछ browsers "interrupted" भेजते हैं।
   * उसे वास्तविक error नहीं मानना।
   */
  if (
    errorCode ===
      'interrupted' ||
    errorCode ===
      'canceled' ||
    errorCode ===
      'cancelled'
  ) {
    return;
  }

  state.speechActive =
    false;

  video?.pause();

  setPlaybackState(
    PLAYBACK_STATES.PAUSED
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      `TTS त्रुटि: ${
        errorCode ||
        'अज्ञात त्रुटि'
      }`;
  }

  vmsg(
    'TTS त्रुटि के कारण वाचन paused है।'
  );

  msg(
    'TTS segment पूरा नहीं हो सका। Resume से पुनः प्रयास करें।'
  );
}

function createUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  /*
   * महत्वपूर्ण:
   * चुनी गई voice की वास्तविक language ही लें।
   * हर voice को sa-IN देने से कुछ browsers/Android
   * voices silent या error हो सकती हैं।
   */
  utterance.lang =
    state.voice?.lang ||
    'hi-IN';

  utterance.voice =
    state.voice || null;

  const selectedRate =
    clampRate(
      rate?.value
    );

  utterance.rate =
    Math.max(
      TTS.MIN_RATE,
      Math.min(
        TTS.MAX_RATE,
        selectedRate
      )
    );

  /*
   * मुख्य स्वर-shaping।
   */
  utterance.pitch =
    TTS.PITCH;

  utterance.volume =
    TTS.VOLUME;

  utterance.onstart =
    () => {
      if (
        token !==
        state.speechToken
      ) {
        return;
      }

      state.speechActive =
        true;

      if (ttsStatus) {
        ttsStatus.textContent =
          `${describeMode()} — segment ${
            state.index + 1
          } / ${
            state.segments.length
          } पढ़ा जा रहा है।`;
      }
    };

  utterance.onend =
    () => {
      if (
        token !==
        state.speechToken
      ) {
        return;
      }

      state.speechActive =
        false;

      const completed =
        Math.min(
          state.index + 1,
          state.segments.length
        );

      updateTtsProgress(
        completed
      );

      if (
        completed >=
        state.segments.length
      ) {
        state.index =
          state.segments.length;

        return;
      }

      state.index += 1;

      if (
        state.playbackState ===
        PLAYBACK_STATES.PLAYING
      ) {
        /*
         * अगले segment के लिए सीधे speak।
         * बीच में cancel नहीं करते।
         */
        speakCurrentSegment();
      }
    };

  utterance.onerror =
    event => {
      if (
        token !==
        state.speechToken
      ) {
        return;
      }

      handleTtsError(
        event?.error
      );
    };

  return utterance;
}

function speakCurrentSegment() {
  const synth =
    speech();

  if (
    !synth ||
    state.playbackState !==
      PLAYBACK_STATES.PLAYING
  ) {
    return false;
  }

  if (!state.voice) {
    state.speechActive =
      false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'TTS के लिए कोई उपयोग योग्य Sanskrit/Hindi voice उपलब्ध नहीं है।';
    }

    msg(
      'TTS voice उपलब्ध नहीं है; Play दोबारा दबाकर voice list को पुनः जाँचें।'
    );

    return false;
  }

  if (
    state.index >=
    state.segments.length
  ) {
    setCompletion(
      'tts'
    );

    return true;
  }

  highlight(
    state.index
  );

  updateTextProgress(
    state.index
  );

  const token =
    ++state.speechToken;

  const utterance =
    createUtterance(
      state.segments[
        state.index
      ].text,
      token
    );

  state.speechActive =
    true;

  try {
    synth.speak(
      utterance
    );

    return true;
  } catch (error) {
    if (
      token ===
      state.speechToken
    ) {
      handleTtsError(
        error?.message
      );
    }

    return false;
  }
}

async function startFreshPlayback() {
  const synth =
    speech();

  if (
    !state.ttsSupported ||
    !synth
  ) {
    msg(
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।'
    );

    return false;
  }

  /*
   * Browser voice list asynchronous हो सकती है।
   * इसलिए Play दबाने पर पुनः सुनिश्चित करते हैं।
   */
  const voice =
    await ensureVoice();

  if (!voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'Browser की TTS voice list उपलब्ध नहीं हो सकी।';
    }

    msg(
      'TTS voice list अभी उपलब्ध नहीं हुई। कुछ क्षण बाद Play दबाएँ।'
    );

    return false;
  }

  /*
   * नई playback session के लिए
   * पुरानी speech queue साफ करें।
   */
  synth.cancel();

  state.speechToken += 1;
  state.speechActive = false;

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;
  state.previewing = false;

  resetCompletion();
  resetProgress();
  clearActive();
  setCurrentText('');

  if (video) {
    video.currentTime = 0;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  try {
    await video.play();
  } catch (error) {
    setPlaybackState(
      PLAYBACK_STATES.IDLE
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'वीडियो playback प्रारंभ नहीं हो सका।';
    }

    msg(
      'वीडियो playback प्रारंभ नहीं हो सका।'
    );

    return false;
  }

  const started =
    speakCurrentSegment();

  if (!started) {
    video.pause();
    return false;
  }

  vmsg(
    `वीडियो और मधुर TTS वाचन चल रहा है — ${
      voice.name ||
      'selected voice'
    }`
  );

  msg(
    'वाचन प्रारंभ हो गया।'
  );

  return true;
}

async function resumePlayback() {
  const synth =
    speech();

  if (
    !synth ||
    state.playbackState !==
      PLAYBACK_STATES.PAUSED
  ) {
    return false;
  }

  const voice =
    await ensureVoice();

  if (!voice) {
    msg(
      'TTS voice उपलब्ध नहीं है।'
    );

    return false;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  try {
    if (synth.paused) {
      synth.resume();
    } else if (!synth.speaking) {
      /*
       * कुछ browsers paused state को
       * queue में सही तरह नहीं रखते।
       */
      speakCurrentSegment();
    }
  } catch (error) {
    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    handleTtsError(
      error?.message
    );

    return false;
  }

  try {
    await video.play();
  } catch (error) {
    synth.pause();
    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    msg(
      'वीडियो पुनः प्रारंभ नहीं हो सका; TTS paused है।'
    );

    return false;
  }

  vmsg(
    'वीडियो और TTS पुनः चल रहे हैं।'
  );

  msg(
    'वाचन पुनः जारी है।'
  );

  return true;
}

/* =========================================================
   PLAYBACK CONTROLS
   ========================================================= */

async function play() {
  if (!state.dataReady) {
    msg(
      'Canonical पाठ अभी उपलब्ध नहीं है।'
    );

    return;
  }

  if (!state.videoReady) {
    msg(
      'पहले 9:16 वीडियो चुनें।'
    );

    return;
  }

  if (!state.ttsSupported) {
    msg(
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।'
    );

    return;
  }

  if (state.previewing) {
    msg(
      'पहले Preview रोकें।'
    );

    return;
  }

  if (
    state.playbackState ===
    PLAYBACK_STATES.PLAYING
  ) {
    return;
  }

  if (
    state.playbackState ===
    PLAYBACK_STATES.PAUSED
  ) {
    await resumePlayback();
    return;
  }

  await startFreshPlayback();
}

function pausePlayback() {
  const synth =
    speech();

  if (
    state.playbackState !==
    PLAYBACK_STATES.PLAYING
  ) {
    msg(
      'वाचन अभी चल नहीं रहा है।'
    );

    return;
  }

  video?.pause();
  synth?.pause();

  setPlaybackState(
    PLAYBACK_STATES.PAUSED
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      'TTS paused है।';
  }

  vmsg(
    'वीडियो और TTS paused हैं।'
  );

  msg(
    'वाचन paused है।'
  );
}

function stop(
  silent = false
) {
  state.speechToken += 1;
  state.speechActive = false;
  state.previewing = false;

  /*
   * stop पर cancellation जानबूझकर।
   */
  speech()?.cancel();

  video?.pause();

  if (video) {
    video.currentTime = 0;
  }

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  clearActive();
  resetCompletion();
  resetProgress();
  setCurrentText('');

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      'वाचन प्रारंभ नहीं हुआ है।';
  }

  vmsg(
    state.videoReady
      ? 'वीडियो तैयार है।'
      : 'वीडियो अपलोड करें।'
  );

  if (!silent) {
    msg(
      'वाचन बंद करके प्रारंभ पर लौटाया गया।'
    );
  }
}

async function handleVideoEnded() {
  if (state.previewing) {
    state.previewing = false;

    updateControlState();

    vmsg(
      'वीडियो Preview पूर्ण हुआ।'
    );

    return;
  }

  if (
    state.playbackState !==
      PLAYBACK_STATES.PLAYING ||
    !state.videoReady ||
    (
      state.textDone &&
      state.ttsDone
    )
  ) {
    return;
  }

  video.currentTime = 0;

  try {
    await video.play();
  } catch (error) {
    speech()?.pause();
    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    msg(
      'वीडियो loop प्रारंभ नहीं हो सका; वाचन paused है।'
    );
  }
}

/* =========================================================
   VIDEO
   ========================================================= */

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );

    state.objectUrl = '';
  }

  state.videoReady =
    false;

  state.previewing =
    false;

  state.lastVideoFileName =
    '';

  if (video) {
    video.onloadedmetadata =
      null;

    video.onerror =
      null;

    video.removeAttribute(
      'src'
    );

    video.load();

    video.loop =
      false;
  }

  if (placeholder) {
    placeholder.hidden =
      false;
  }

  updateControlState();
}

function isExactRatio9x16() {
  return Boolean(
    video?.videoWidth &&
    video?.videoHeight &&
    video.videoWidth * 16 ===
      video.videoHeight * 9
  );
}

function metadataLoaded(file) {
  const width =
    video?.videoWidth || 0;

  const height =
    video?.videoHeight || 0;

  if (!isExactRatio9x16()) {
    clearVideo();

    if (upload) {
      upload.value = '';
    }

    umsg(
      `अस्वीकृत: ${file.name} का आकार ${width}:${height} है; ठीक 9:16 आवश्यक है।`
    );

    vmsg(
      'कृपया ठीक 9:16 वीडियो चुनें।'
    );

    msg(
      'वीडियो validation विफल हुई।'
    );

    return;
  }

  state.videoReady =
    true;

  state.lastVideoFileName =
    file.name;

  if (placeholder) {
    placeholder.hidden =
      true;
  }

  umsg(
    `चयनित: ${file.name}`
  );

  vmsg(
    'ठीक 9:16 वीडियो तैयार है।'
  );

  msg(
    'वीडियो सफलतापूर्वक सत्यापित और लोड हुआ।'
  );

  updateControlState();
}

function selectVideo(event) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  if (
    !file.type.startsWith(
      'video/'
    )
  ) {
    umsg(
      'कृपया मान्य video file चुनें।'
    );

    event.target.value =
      '';

    return;
  }

  stop(true);
  clearVideo();

  state.objectUrl =
    URL.createObjectURL(
      file
    );

  video.src =
    state.objectUrl;

  video.preload =
    'metadata';

  video.loop =
    false;

  video.onloadedmetadata =
    () => {
      metadataLoaded(
        file
      );
    };

  video.onerror =
    () => {
      clearVideo();

      if (upload) {
        upload.value =
          '';
      }

      umsg(
        'वीडियो लोड नहीं हो सका।'
      );

      vmsg(
        'वीडियो codec या file format Browser द्वारा समर्थित नहीं है।'
      );

      msg(
        'वीडियो load error।'
      );
    };

  video.load();

  umsg(
    `जाँच जारी: ${file.name}`
  );

  msg(
    'वीडियो की 9:16 ratio जाँची जा रही है…'
  );
}

async function preview() {
  if (!state.videoReady) {
    msg(
      'पहले वीडियो चुनें।'
    );

    return;
  }

  if (
    state.playbackState !==
      PLAYBACK_STATES.IDLE &&
    !state.previewing
  ) {
    msg(
      'Preview केवल IDLE स्थिति में उपलब्ध है।'
    );

    return;
  }

  if (state.previewing) {
    video?.pause();

    state.previewing =
      false;

    updateControlState();

    vmsg(
      'वीडियो Preview रोका गया।'
    );

    return;
  }

  try {
    state.previewing =
      true;

    updateControlState();

    video.currentTime =
      0;

    await video.play();

    vmsg(
      'वीडियो Preview चल रहा है।'
    );
  } catch (error) {
    state.previewing =
      false;

    updateControlState();

    msg(
      'Preview प्रारंभ नहीं हो सका।'
    );
  }
}

function removeVideo() {
  stop(true);
  clearVideo();

  if (upload) {
    upload.value =
      '';
  }

  umsg(
    'कोई वीडियो चयनित नहीं है।'
  );

  vmsg(
    'वीडियो हटाया गया।'
  );

  msg(
    'वीडियो सफलतापूर्वक हटाया गया।'
  );
}

/* =========================================================
   SETTINGS
   ========================================================= */

function saveSettings() {
  safeStorageSet(
    'lalitaTtsRate',
    clampRate(
      rate?.value
    )
  );

  if (state.voice) {
    safeStorageSet(
      'lalitaTtsVoiceURI',
      state.voice.voiceURI ||
        ''
    );
  }

  updateRate();

  msg(
    'TTS वाचन गति और चयनित voice सुरक्षित कर दी गई।'
  );
}

function loadSettings() {
  const saved =
    safeStorageGet(
      'lalitaTtsRate'
    );

  if (rate) {
    rate.value =
      String(
        clampRate(
          saved ||
          rate.value ||
          TTS.DEFAULT_RATE
        )
      );
  }

  updateRate();
}

function resetApp() {
  stop(true);

  safeStorageRemove(
    'lalitaTtsRate'
  );

  safeStorageRemove(
    'lalitaTtsVoiceURI'
  );

  if (rate) {
    rate.value =
      String(
        TTS.DEFAULT_RATE
      );
  }

  updateRate();

  if (state.sourceData) {
    applyMode(
      CONTENT_MODES.STOTRA,
      true
    );
  }

  refreshVoice();

  msg(
    'App settings reset कर दी गईं।'
  );
}

/* =========================================================
   INIT / EVENTS
   ========================================================= */

function browserCheck() {
  state.ttsSupported =
    'speechSynthesis' in
      window &&
    'SpeechSynthesisUtterance' in
      window;

  if (state.ttsSupported) {
    return;
  }

  if (voiceStatus) {
    voiceStatus.textContent =
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।';
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'TTS उपलब्ध नहीं है; पाठ फिर भी उपलब्ध रहेगा।';
  }

  msg(
    'Browser में Speech Synthesis उपलब्ध नहीं है।'
  );

  updateControlState();
}

function bindEvents() {
  playBtn?.addEventListener(
    'click',
    play
  );

  pauseBtn?.addEventListener(
    'click',
    pausePlayback
  );

  stopBtn?.addEventListener(
    'click',
    () => stop()
  );

  previewBtn?.addEventListener(
    'click',
    preview
  );

  removeBtn?.addEventListener(
    'click',
    removeVideo
  );

  saveBtn?.addEventListener(
    'click',
    saveSettings
  );

  resetBtn?.addEventListener(
    'click',
    resetApp
  );

  upload?.addEventListener(
    'change',
    selectVideo
  );

  rate?.addEventListener(
    'input',
    updateRate
  );

  contentMode?.addEventListener(
    'change',
    event => {
      applyMode(
        event.target.value
      );
    }
  );

  video?.addEventListener(
    'ended',
    handleVideoEnded
  );

  const synth =
    speech();

  synth?.addEventListener(
    'voiceschanged',
    refreshVoice
  );
}

function cleanup() {
  state.speechToken += 1;
  state.speechActive =
    false;

  state.previewing =
    false;

  speech()?.cancel();

  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );

    state.objectUrl =
      '';
  }
}

window.addEventListener(
  'beforeunload',
  cleanup
);

async function init() {
  if (state.initialized) {
    return;
  }

  state.initialized =
    true;

  browserCheck();
  loadSettings();
  bindEvents();
  refreshVoice();

  resetCompletion();
  resetProgress();
  updateRate();

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (video) {
    video.loop =
      false;
  }

  try {
    await loadCanonicalData();

    msg(
      state.ttsSupported
        ? state.voice
          ? 'App तैयार है। उपलब्ध सबसे उपयुक्त Sanskrit/Hindi voice चयनित है।'
          : 'App तैयार है। Browser voice list उपलब्ध होते ही TTS तैयार हो जाएगा।'
        : 'पाठ तैयार है; Browser TTS उपलब्ध नहीं है।'
    );
  } catch (error) {
    state.dataReady =
      false;

    msg(
      `Canonical पाठ लोड नहीं हुआ: ${error.message}`
    );

    if (contentModeStatus) {
      contentModeStatus.textContent =
        'Canonical data validation विफल।';
    }

    if (ttsStatus) {
      ttsStatus.textContent =
        'Canonical पाठ उपलब्ध न होने से playback प्रारंभ नहीं होगा।';
    }

    updateControlState();
  }
}

init();
