'use strict';

/*
 * Lalita Sahasranama Ratnavali
 * app.js
 *
 * TTS प्राथमिकता:
 * 1. पुरुष संस्कृत voice
 * 2. पुरुष Hindi voice
 * 3. Sanskrit/Hindi प्राकृतिक/Neural/Premium voice
 *
 * महत्वपूर्ण:
 * Browser/Web Speech API स्वयं voice का gender हमेशा reliably expose नहीं करता।
 * इसलिए male-selection descriptor/name आधारित scoring से किया गया है।
 */

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

const source =
  app?.dataset.source ||
  'data/lalita-sahasranama-ratnavali.json';

const PLAYBACK_STATES = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  COMPLETED: 'completed'
});

const state = {
  segments: [],

  index: 0,
  textIndex: -1,
  ttsCompleted: 0,

  playbackState: PLAYBACK_STATES.IDLE,

  textDone: false,
  ttsDone: false,

  voice: null,
  voiceKind: '',
  voiceLanguage: '',

  objectUrl: '',
  videoReady: false,
  dataReady: false,

  speechToken: 0,
  speechActive: false,

  previewing: false,
  initialized: false
};


/* =========================================================
   संदेश
   ========================================================= */

function msg(text) {
  if (system) {
    system.textContent = String(text || '');
  }
}

function vmsg(text) {
  if (videoStatus) {
    videoStatus.textContent = String(text || '');
  }
}

function umsg(text) {
  if (uploadStatus) {
    uploadStatus.textContent = String(text || '');
  }
}

function speech() {
  return window.speechSynthesis;
}


/* =========================================================
   TTS गति
   ========================================================= */

function clampRate(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0.86;
  }

  return Math.max(
    0.60,
    Math.min(1.10, numeric)
  );
}

function updateRate() {
  if (!rate || !rateValue) {
    return;
  }

  const value = clampRate(rate.value);

  rate.value = String(value);
  rateValue.textContent = value.toFixed(2);
}


/* =========================================================
   Playback State
   ========================================================= */

function setPlaybackState(nextState) {
  state.playbackState = nextState;
  updateControlState();
}

function updateControlState() {
  if (playBtn) {
    playBtn.disabled =
      !state.dataReady ||
      !state.videoReady ||
      state.previewing ||
      state.playbackState === PLAYBACK_STATES.PLAYING;
  }

  if (pauseBtn) {
    pauseBtn.disabled =
      state.playbackState !== PLAYBACK_STATES.PLAYING;
  }

  if (stopBtn) {
    stopBtn.disabled =
      !state.dataReady &&
      !state.videoReady &&
      state.playbackState === PLAYBACK_STATES.IDLE &&
      !state.previewing;
  }

  if (previewBtn) {
    previewBtn.disabled =
      !state.videoReady ||
      state.playbackState !== PLAYBACK_STATES.IDLE;

    previewBtn.textContent = state.previewing
      ? 'Preview रोकें'
      : 'वीडियो Preview';
  }
}


/* =========================================================
   Progress
   ========================================================= */

function setTextProgress(percent) {
  const numeric = Number(percent);

  const safe =
    Number.isFinite(numeric)
      ? Math.max(0, Math.min(100, numeric))
      : 0;

  const value = Math.round(safe);

  if (textBar) {
    textBar.value = value;
  }

  if (textPct) {
    textPct.value = `${value}%`;
  }
}

function setTtsProgress(percent) {
  const numeric = Number(percent);

  const safe =
    Number.isFinite(numeric)
      ? Math.max(0, Math.min(100, numeric))
      : 0;

  const value = Math.round(safe);

  if (ttsBar) {
    ttsBar.value = value;
  }

  if (ttsPct) {
    ttsPct.value = `${value}%`;
  }
}

function resetProgress() {
  setTextProgress(0);
  setTtsProgress(0);
}


/* =========================================================
   Completion State
   ========================================================= */

function setCompletionState(type, value) {
  if (type === 'text') {
    state.textDone = Boolean(value);
  }

  if (type === 'tts') {
    state.ttsDone = Boolean(value);
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

  const finished =
    state.textDone &&
    state.ttsDone;

  if (gateEl) {
    gateEl.textContent =
      finished
        ? 'वाचन पूर्ण'
        : 'वाचन जारी है';

    gateEl.dataset.complete =
      String(finished);
  }

  if (finished) {
    finish();
  }
}

function resetCompletionState() {
  state.textDone = false;
  state.ttsDone = false;

  if (textDoneEl) {
    textDoneEl.textContent = 'पाठ: अपूर्ण';
    textDoneEl.dataset.complete = 'false';
  }

  if (ttsDoneEl) {
    ttsDoneEl.textContent = 'TTS: अपूर्ण';
    ttsDoneEl.dataset.complete = 'false';
  }

  if (gateEl) {
    gateEl.textContent = 'वाचन जारी है';
    gateEl.dataset.complete = 'false';
  }
}

function finish() {
  if (!state.textDone || !state.ttsDone) {
    return false;
  }

  state.speechActive = false;
  state.index = state.segments.length;
  state.previewing = false;

  video?.pause();

  setPlaybackState(
    PLAYBACK_STATES.COMPLETED
  );

  if (
    current &&
    state.segments.length > 0
  ) {
    current.textContent =
      state.segments[
        state.segments.length - 1
      ].text;
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'अंतिम TTS segment पूर्ण हुआ।';
  }

  vmsg(
    'संपूर्ण पाठ और TTS पूर्ण — वीडियो रुक गया।'
  );

  msg('वाचन पूर्ण हुआ।');

  return true;
}


/* =========================================================
   Text Rendering
   ========================================================= */

function clearActive() {
  textBox?.querySelectorAll(
    '.segment.active'
  ).forEach(node => {
    node.classList.remove('active');
  });
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
        document.createElement('span');

      node.className = 'segment';

      node.id = `seg-${index}`;

      node.dataset.index =
        String(index);

      node.textContent =
        `${segment.text} `;

      fragment.append(node);
    }
  );

  textBox.append(fragment);
}


/* =========================================================
   JSON Normalization
   ========================================================= */

function normalize(item, index) {
  if (typeof item === 'string') {
    const text = item.trim();

    if (!text) {
      return null;
    }

    return {
      id: index + 1,
      text
    };
  }

  if (
    !item ||
    typeof item !== 'object'
  ) {
    return null;
  }

  const text = String(
    item.text ??
    item.name ??
    ''
  ).trim();

  if (!text) {
    return null;
  }

  return {
    id:
      item.id ??
      item.number ??
      index + 1,

    text
  };
}

function extract(data) {
  /*
   * Canonical JSON compatibility:
   *
   * segments  = stotra segments
   * namavali  = 1000-name namavali
   * names
   * entries
   * ratnavali
   * text
   *
   * इस application में segments को प्राथमिकता दी गई है,
   * क्योंकि वर्तमान Lalita UI का text/TTS stream segments पर आधारित है।
   */

  let list;

  if (Array.isArray(data)) {
    list = data;
  } else {
    list =
      data?.segments ??
      data?.namavali ??
      data?.names ??
      data?.entries ??
      data?.ratnavali ??
      data?.text ??
      [];
  }

  if (!Array.isArray(list)) {
    throw new Error(
      'JSON में मान्य पाठ-array नहीं मिला।'
    );
  }

  return list
    .map(normalize)
    .filter(Boolean);
}


/* =========================================================
   Load JSON
   ========================================================= */

async function loadText() {
  const response =
    await fetch(source, {
      cache: 'no-store'
    });

  if (!response.ok) {
    throw new Error(
      `JSON HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  state.segments =
    extract(data);

  if (!state.segments.length) {
    throw new Error(
      'पाठ-खंड उपलब्ध नहीं हैं।'
    );
  }

  renderText();

  state.dataReady = true;
  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  resetCompletionState();
  resetProgress();

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (ttsStatus) {
    ttsStatus.textContent =
      'वाचन के लिए तैयार।';
  }

  msg(
    `${state.segments.length} पाठ-खंड लोड हुए।`
  );
}


/* =========================================================
   Voice Detection
   ========================================================= */

/*
 * Browser speech API में voice gender standardized property
 * उपलब्ध नहीं होती। इसलिए name / URI / descriptor के आधार
 * पर एक व्यावहारिक scoring system बनाया गया है।
 */

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
  'gentleman',
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
  'expressive',
  'hq',
  'high quality',
  'google',
  'microsoft',
  'amazon',
  'apple'
];

function descriptorOf(voice) {
  return (
    `${voice?.name || ''} ` +
    `${voice?.voiceURI || ''} ` +
    `${voice?.lang || ''}`
  ).toLowerCase();
}

function hasAnyMarker(text, markers) {
  return markers.some(
    marker =>
      text.includes(
        String(marker).toLowerCase()
      )
  );
}

function languageScore(voice) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  if (
    lang === 'sa' ||
    lang.startsWith('sa-')
  ) {
    return 100;
  }

  if (
    lang === 'hi' ||
    lang.startsWith('hi-')
  ) {
    return 85;
  }

  return 0;
}

function isIndianLanguageVoice(voice) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  return (
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    lang === 'hi' ||
    lang.startsWith('hi-')
  );
}

function looksFemale(voice) {
  return hasAnyMarker(
    descriptorOf(voice),
    FEMALE_MARKERS
  );
}

function looksMale(voice) {
  return hasAnyMarker(
    descriptorOf(voice),
    MALE_MARKERS
  );
}

function looksNatural(voice) {
  return hasAnyMarker(
    descriptorOf(voice),
    NATURAL_MARKERS
  );
}

function scoreVoice(voice) {
  if (!voice) {
    return -Infinity;
  }

  const descriptor =
    descriptorOf(voice);

  const language =
    languageScore(voice);

  /*
   * भारतीय भाषाओं को प्राथमिकता।
   */
  let score = language;

  if (language === 0) {
    return -Infinity;
  }

  /*
   * महिला-चिह्नित voices को male selection से बाहर रखें।
   */
  if (looksFemale(voice)) {
    return -Infinity;
  }

  /*
   * Explicit male marker को बहुत अधिक प्राथमिकता।
   */
  if (looksMale(voice)) {
    score += 100;
  }

  /*
   * Natural / Neural / Premium voices
   * मधुर एवं प्राकृतिक rendering के लिए प्राथमिक।
   */
  if (looksNatural(voice)) {
    score += 35;
  }

  /*
   * Default / local voices को हल्की प्राथमिकता।
   */
  if (voice.default) {
    score += 4;
  }

  /*
   * Sanskrit की अतिरिक्त preference।
   */
  if (
    descriptor.includes('sanskrit') ||
    descriptor.includes('संस्कृत')
  ) {
    score += 40;
  }

  return score;
}

function classifyVoice(voice) {
  if (!voice) {
    return '';
  }

  const language =
    String(
      voice.lang || ''
    ).toLowerCase();

  if (
    language === 'sa' ||
    language.startsWith('sa-')
  ) {
    return 'male-sanskrit';
  }

  if (
    language === 'hi' ||
    language.startsWith('hi-')
  ) {
    return 'male-hindi';
  }

  return 'fallback';
}

function selectMaleVoice() {
  const synth = speech();

  if (!synth) {
    return null;
  }

  const voices =
    synth
      .getVoices()
      .filter(Boolean);

  if (!voices.length) {
    return null;
  }

  const indianVoices =
    voices.filter(
      isIndianLanguageVoice
    );

  /*
   * पहले भारतीय language voices पर काम करें।
   */
  const candidates =
    indianVoices.length
      ? indianVoices
      : voices;

  const scored =
    candidates
      .map(voice => ({
        voice,
        score: scoreVoice(voice)
      }))
      .filter(
        item =>
          Number.isFinite(item.score)
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (scored.length) {
    return scored[0].voice;
  }

  /*
   * यदि browser gender descriptor बिल्कुल नहीं देता,
   * तब Sanskrit/Hindi natural voice को fallback के रूप
   * में चुनें, लेकिन महिला-marked voices को नहीं।
   */

  const fallback =
    candidates
      .filter(
        voice => !looksFemale(voice)
      )
      .sort(
        (a, b) => {
          const sa =
            languageScore(a) +
            (looksNatural(a) ? 25 : 0);

          const sb =
            languageScore(b) +
            (looksNatural(b) ? 25 : 0);

          return sb - sa;
        }
      )[0];

  return fallback || null;
}

function refreshVoice() {
  const synth = speech();

  if (!synth) {
    return;
  }

  const selected =
    selectMaleVoice();

  state.voice =
    selected || null;

  state.voiceKind =
    classifyVoice(
      state.voice
    );

  state.voiceLanguage =
    state.voice?.lang ||
    '';

  if (!voiceStatus) {
    return;
  }

  if (!state.voice) {
    voiceStatus.textContent =
      'उपयुक्त पुरुष Sanskrit/Hindi voice उपलब्ध नहीं है।';
    return;
  }

  const voiceName =
    state.voice.name ||
    'System voice';

  const lang =
    state.voice.lang ||
    'unknown';

  const maleConfirmed =
    looksMale(state.voice);

  if (maleConfirmed) {
    voiceStatus.textContent =
      `पुरुष मधुर TTS: ${voiceName} (${lang})`;
  } else {
    voiceStatus.textContent =
      `उपलब्ध natural भारतीय voice: ${voiceName} (${lang})`;
  }
}


/* =========================================================
   Motion
   ========================================================= */

function reducedMotion() {
  return Boolean(
    window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
  );
}


/* =========================================================
   Highlight
   ========================================================= */

function highlight(index) {
  clearActive();

  const node =
    $(`seg-${index}`);

  const segment =
    state.segments[index];

  if (!node || !segment) {
    return;
  }

  node.classList.add('active');

  try {
    node.scrollIntoView({
      behavior:
        reducedMotion()
          ? 'auto'
          : 'smooth',
      block: 'center'
    });
  } catch (error) {
    /* Browser without smooth scrolling support. */
  }

  if (current) {
    current.textContent =
      segment.text;
  }
}


/* =========================================================
   Text Traversal
   ========================================================= */

function updateTextTraversal(index) {
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

  setTextProgress(
    (
      (state.textIndex + 1) *
      100
    ) /
    state.segments.length
  );

  if (
    state.textIndex >=
    state.segments.length - 1
  ) {
    setCompletionState(
      'text',
      true
    );
  }
}


/* =========================================================
   TTS Progress
   ========================================================= */

function updateTtsProgress(
  completedSegments
) {
  if (!state.segments.length) {
    return;
  }

  state.ttsCompleted =
    Math.max(
      0,
      Math.min(
        completedSegments,
        state.segments.length
      )
    );

  setTtsProgress(
    (
      state.ttsCompleted *
      100
    ) /
    state.segments.length
  );

  if (
    state.ttsCompleted >=
    state.segments.length
  ) {
    setCompletionState(
      'tts',
      true
    );
  }
}


/* =========================================================
   TTS भाषा
   ========================================================= */

function voiceLanguage(voice) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  if (
    lang === 'sa' ||
    lang.startsWith('sa-')
  ) {
    return 'sa-IN';
  }

  if (
    lang === 'hi' ||
    lang.startsWith('hi-')
  ) {
    return 'hi-IN';
  }

  return 'hi-IN';
}


/* =========================================================
   Utterance
   ========================================================= */

function makeUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  /*
   * Voice-selected language को प्राथमिकता।
   */
  utterance.lang =
    voiceLanguage(
      state.voice
    );

  /*
   * मधुर और शांत वाचन के लिए
   * default speed थोड़ी कम रखी गई है।
   */
  utterance.rate =
    clampRate(
      rate?.value
    );

  /*
   * पुरुष voice की natural timbre को
   * pitch=1 पर रहने दिया गया है।
   * Pitch से gender force नहीं किया जाता।
   */
  utterance.pitch = 1.0;

  utterance.volume = 1.0;

  if (state.voice) {
    utterance.voice =
      state.voice;
  }

  utterance.onstart = () => {
    if (
      token !== state.speechToken
    ) {
      return;
    }

    state.speechActive = true;

    if (ttsStatus) {
      ttsStatus.textContent =
        `पाठ-खंड ${state.index + 1} / ${state.segments.length} पढ़ा जा रहा है।`;
    }
  };

  utterance.onend = () => {
    if (
      token !== state.speechToken
    ) {
      return;
    }

    state.speechActive = false;

    const completedIndex =
      state.index;

    state.ttsCompleted =
      Math.min(
        completedIndex + 1,
        state.segments.length
      );

    updateTtsProgress(
      state.ttsCompleted
    );

    if (
      completedIndex >=
      state.segments.length - 1
    ) {
      state.index =
        state.segments.length;

      setCompletionState(
        'tts',
        true
      );

      return;
    }

    state.index =
      completedIndex + 1;

    /*
     * महत्वपूर्ण:
     * अगले segment से पहले synth.cancel()
     * नहीं किया जाता, क्योंकि इससे कभी-कभी
     * browser "interrupted" error देता है।
     */
    if (
      state.playbackState ===
      PLAYBACK_STATES.PLAYING
    ) {
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

      state.speechActive = false;

      /*
       * pause के दौरान browser के benign
       * interruption को fatal error न मानें।
       */
      if (
        event?.error === 'interrupted'
      ) {
        return;
      }

      video?.pause();

      setPlaybackState(
        PLAYBACK_STATES.PAUSED
      );

      if (ttsStatus) {
        ttsStatus.textContent =
          `TTS त्रुटि: ${event?.error || 'अज्ञात त्रुटि'}`;
      }

      vmsg(
        'TTS त्रुटि के कारण वाचन रोक दिया गया।'
      );

      msg(
        'TTS segment पूरा नहीं हो सका। वाचन paused स्थिति में है।'
      );
    };

  return utterance;
}


/* =========================================================
   Speak Current Segment
   ========================================================= */

function speakCurrentSegment() {
  const synth = speech();

  if (
    !synth ||
    state.playbackState !==
      PLAYBACK_STATES.PLAYING
  ) {
    return false;
  }

  refreshVoice();

  if (!state.voice) {
    state.speechActive = false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'पुरुष Sanskrit/Hindi voice उपलब्ध नहीं है।';
    }

    msg(
      'उपलब्ध voice में उपयुक्त पुरुष Sanskrit/Hindi voice नहीं मिला।'
    );

    return false;
  }

  if (
    state.index >=
    state.segments.length
  ) {
    setCompletionState(
      'tts',
      true
    );

    return true;
  }

  const item =
    state.segments[
      state.index
    ];

  if (!item?.text) {
    state.index += 1;

    if (
      state.index <
      state.segments.length
    ) {
      speakCurrentSegment();
    }

    return true;
  }

  highlight(state.index);

  updateTextTraversal(
    state.index
  );

  const token =
    ++state.speechToken;

  const utterance =
    makeUtterance(
      item.text,
      token
    );

  state.speechActive = true;

  try {
    synth.speak(
      utterance
    );

    return true;
  } catch (error) {
    state.speechActive = false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'TTS प्रारंभ नहीं हो सका।';
    }

    msg(
      'Browser ने TTS प्रारंभ करने से मना कर दिया।'
    );

    return false;
  }
}


/* =========================================================
   Fresh Playback
   ========================================================= */

async function startFreshPlayback() {
  const synth =
    speech();

  if (!synth) {
    msg(
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।'
    );

    return false;
  }

  refreshVoice();

  if (!state.voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'पुरुष Sanskrit/Hindi voice उपलब्ध नहीं है।';
    }

    msg(
      'TTS के लिए उपयुक्त पुरुष voice उपलब्ध नहीं है।'
    );

    return false;
  }

  /*
   * नया playback शुरू करते समय ही cancel किया जाता है।
   */
  synth.cancel();

  state.speechToken += 1;

  state.speechActive = false;
  state.previewing = false;

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  resetCompletionState();
  resetProgress();
  clearActive();

  if (current) {
    current.textContent = '';
  }

  if (video) {
    video.currentTime = 0;
  }

  try {
    await video.play();
  } catch (error) {
    setPlaybackState(
      PLAYBACK_STATES.IDLE
    );

    msg(
      'वीडियो playback प्रारंभ नहीं हो सका।'
    );

    return false;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  const started =
    speakCurrentSegment();

  if (!started) {
    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    return false;
  }

  vmsg(
    'वीडियो और मधुर पुरुष TTS वाचन चल रहा है।'
  );

  msg(
    'वाचन प्रारंभ हो गया।'
  );

  return true;
}


/* =========================================================
   Resume
   ========================================================= */

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

  refreshVoice();

  if (!state.voice) {
    msg(
      'पुरुष Sanskrit/Hindi voice उपलब्ध नहीं है।'
    );

    return false;
  }

  try {
    await video.play();
  } catch (error) {
    msg(
      'वीडियो playback पुनः प्रारंभ नहीं हो सका।'
    );

    return false;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  /*
   * Browser paused speech को resume करें।
   * यदि speech object समाप्त हो चुका है,
   * तो वर्तमान segment से पुनः बोलें।
   */
  if (synth.paused) {
    synth.resume();
  } else if (!synth.speaking) {
    speakCurrentSegment();
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
   Play
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


/* =========================================================
   Pause
   ========================================================= */

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

  /*
   * Pause करें, cancel नहीं।
   * इससे Resume पर वही utterance जारी रह सकता है।
   */
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
    'वाचन रोककर paused स्थिति में रखा गया है।'
  );
}


/* =========================================================
   Stop
   ========================================================= */

function stop(options = {}) {
  const silent =
    Boolean(
      options.silent
    );

  const synth =
    speech();

  /*
   * cancel केवल explicit Stop,
   * नई playback और cleanup पर।
   */
  state.speechToken += 1;

  state.speechActive = false;
  state.previewing = false;

  synth?.cancel();

  video?.pause();

  if (video) {
    video.currentTime = 0;
  }

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  clearActive();

  resetCompletionState();
  resetProgress();

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (current) {
    current.textContent = '';
  }

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


/* =========================================================
   Video End
   ========================================================= */

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

  if (!video) {
    return;
  }

  video.currentTime = 0;

  try {
    await video.play();
  } catch (error) {
    state.speechToken += 1;

    state.speechActive = false;

    speech()?.pause();

    video.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    msg(
      'वीडियो loop प्रारंभ नहीं हो सका; वाचन paused है।'
    );

    vmsg(
      'वीडियो replay विफल होने से वाचन paused किया गया।'
    );
  }
}


/* =========================================================
   Video Management
   ========================================================= */

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );

    state.objectUrl = '';
  }

  state.videoReady = false;
  state.previewing = false;

  if (video) {
    video.onloadedmetadata =
      null;

    video.removeAttribute(
      'src'
    );

    video.load();

    video.loop = false;
  }

  updateControlState();
}

function validRatio() {
  if (
    !video?.videoWidth ||
    !video?.videoHeight
  ) {
    return false;
  }

  const ratio =
    video.videoWidth /
    video.videoHeight;

  return (
    Math.abs(
      ratio - 9 / 16
    ) <= 0.03
  );
}

function metadataLoaded(file) {
  if (!validRatio()) {
    clearVideo();

    if (upload) {
      upload.value = '';
    }

    if (placeholder) {
      placeholder.hidden =
        false;
    }

    umsg(
      'अस्वीकृत: वीडियो का aspect ratio 9:16 होना चाहिए।'
    );

    vmsg(
      'कृपया 9:16 वीडियो चुनें।'
    );

    msg(
      'वीडियो validation विफल हुई।'
    );

    return;
  }

  state.videoReady = true;

  if (placeholder) {
    placeholder.hidden =
      true;
  }

  umsg(
    `चयनित: ${file.name}`
  );

  vmsg(
    '9:16 वीडियो तैयार है।'
  );

  msg(
    'वीडियो सफलतापूर्वक लोड हुआ।'
  );

  updateControlState();
}

function fileAllowed(file) {
  return Boolean(
    file &&
    typeof file.type === 'string' &&
    file.type.startsWith('video/')
  );
}

function selectVideo(event) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  if (!fileAllowed(file)) {
    umsg(
      'कृपया मान्य video file चुनें।'
    );

    event.target.value = '';

    return;
  }

  stop({
    silent: true
  });

  clearVideo();

  state.objectUrl =
    URL.createObjectURL(file);

  if (!video) {
    return;
  }

  video.src =
    state.objectUrl;

  video.loop = false;

  video.preload =
    'metadata';

  video.onloadedmetadata =
    () => {
      metadataLoaded(file);
    };

  video.load();

  umsg(
    `जाँच जारी: ${file.name}`
  );

  msg(
    'वीडियो की 9:16 ratio जाँची जा रही है…'
  );
}


/* =========================================================
   Preview
   ========================================================= */

async function preview() {
  if (!state.videoReady) {
    msg(
      'पहले वीडियो चुनें।'
    );

    return;
  }

  if (
    state.playbackState !==
    PLAYBACK_STATES.IDLE
  ) {
    msg(
      'Preview केवल स्वतंत्र IDLE स्थिति में उपलब्ध है।'
    );

    return;
  }

  if (state.previewing) {
    video?.pause();

    state.previewing = false;

    updateControlState();

    vmsg(
      'वीडियो Preview रोका गया।'
    );

    return;
  }

  try {
    state.previewing = true;

    updateControlState();

    if (video) {
      video.currentTime = 0;
    }

    await video.play();

    vmsg(
      'वीडियो Preview चल रहा है।'
    );
  } catch (error) {
    state.previewing = false;

    updateControlState();

    msg(
      'Preview प्रारंभ नहीं हो सका।'
    );
  }
}


/* =========================================================
   Remove Video
   ========================================================= */

function removeVideo() {
  stop({
    silent: true
  });

  clearVideo();

  if (upload) {
    upload.value = '';
  }

  if (placeholder) {
    placeholder.hidden =
      false;
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

  updateControlState();
}


/* =========================================================
   Storage
   ========================================================= */

function safeStorageGet(key) {
  try {
    return localStorage.getItem(
      key
    );
  } catch (error) {
    return null;
  }
}

function safeStorageSet(
  key,
  value
) {
  try {
    localStorage.setItem(
      key,
      value
    );
  } catch (error) {
    msg(
      'सेटिंग सुरक्षित नहीं की जा सकी।'
    );
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(
      key
    );
  } catch (error) {
    /* Storage unavailable. */
  }
}


/* =========================================================
   Settings
   ========================================================= */

function saveSettings() {
  const value =
    clampRate(
      rate?.value
    );

  safeStorageSet(
    'lalitaTtsRate',
    String(value)
  );

  updateRate();

  msg(
    'TTS वाचन गति सुरक्षित कर दी गई।'
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
          saved ??
          rate.value ??
          0.86
        )
      );
  }

  updateRate();
}

function resetApp() {
  stop({
    silent: true
  });

  safeStorageRemove(
    'lalitaTtsRate'
  );

  if (rate) {
    rate.value = '0.86';
  }

  updateRate();

  msg(
    'App settings reset कर दी गईं।'
  );
}


/* =========================================================
   Events
   ========================================================= */

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

  video?.addEventListener(
    'ended',
    handleVideoEnded
  );

  speech()?.addEventListener(
    'voiceschanged',
    () => {
      refreshVoice();
      updateControlState();
    }
  );
}


/* =========================================================
   Browser Check
   ========================================================= */

function browserCheck() {
  const supported =
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  if (supported) {
    return true;
  }

  if (voiceStatus) {
    voiceStatus.textContent =
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।';
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'TTS उपलब्ध नहीं है; वाचन प्रारंभ नहीं होगा।';
  }

  msg(
    'आवश्यक TTS सुविधा इस Browser में उपलब्ध नहीं है।'
  );

  return false;
}


/* =========================================================
   Cleanup
   ========================================================= */

function cleanup() {
  state.speechToken += 1;

  state.speechActive = false;
  state.previewing = false;

  speech()?.cancel();

  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );

    state.objectUrl = '';
  }
}

window.addEventListener(
  'beforeunload',
  cleanup
);


/* =========================================================
   Init
   ========================================================= */

async function init() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  if (!browserCheck()) {
    updateControlState();
    return;
  }

  loadSettings();

  bindEvents();

  /*
   * Voice list कई browsers में asynchronously आती है।
   */
  refreshVoice();

  resetCompletionState();
  resetProgress();

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (video) {
    video.loop = false;
  }

  try {
    await loadText();

    refreshVoice();

    if (state.voice) {
      msg(
        'App तैयार है। मधुर पुरुष TTS voice चयनित है।'
      );
    } else {
      msg(
        'पाठ तैयार है; पुरुष Sanskrit/Hindi TTS voice अभी उपलब्ध नहीं है।'
      );
    }

    updateControlState();
  } catch (error) {
    state.dataReady = false;

    msg(
      `Canonical पाठ लोड नहीं हुआ: ${error.message}`
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'पाठ उपलब्ध न होने से TTS प्रारंभ नहीं होगा।';
    }

    updateControlState();
  }
}

init();
