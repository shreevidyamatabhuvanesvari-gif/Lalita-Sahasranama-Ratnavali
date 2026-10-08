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

  objectUrl: '',
  videoReady: false,
  dataReady: false,

  speechToken: 0,
  speechActive: false,

  previewing: false,
  initialized: false
};


/* =========================================================
   Male Sanskrit Voice Selection
   ========================================================= */

const MALE_MARKERS = [
  'male',
  'man',
  'boy',
  'gent',
  'gentleman',
  'masculine',
  'पुरुष',
  'नर',
  'पु',
  'male voice'
];

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

function hasMarker(text, markers) {
  return markers.some(marker =>
    text.includes(
      String(marker).toLowerCase()
    )
  );
}

function isFemaleVoice(voice) {
  return hasMarker(
    descriptorOf(voice),
    FEMALE_MARKERS
  );
}

function isMaleVoice(voice) {
  return hasMarker(
    descriptorOf(voice),
    MALE_MARKERS
  );
}

function isSanskritVoice(voice) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  const descriptor =
    descriptorOf(voice);

  return (
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    descriptor.includes('sanskrit') ||
    descriptor.includes('संस्कृत')
  );
}

function isHindiVoice(voice) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  return (
    lang === 'hi' ||
    lang.startsWith('hi-')
  );
}

function isNaturalVoice(voice) {
  return hasMarker(
    descriptorOf(voice),
    NATURAL_MARKERS
  );
}

function maleVoiceScore(voice) {
  if (!voice) {
    return -Infinity;
  }

  /*
   * स्पष्ट महिला voice को कभी प्राथमिक candidate
   * न बनाया जाए।
   */
  if (isFemaleVoice(voice)) {
    return -Infinity;
  }

  let score = 0;

  /*
   * पुरुष संकेत को सबसे अधिक प्राथमिकता।
   */
  if (isMaleVoice(voice)) {
    score += 180;
  }

  /*
   * संस्कृत सर्वोच्च भाषा प्राथमिकता।
   */
  if (isSanskritVoice(voice)) {
    score += 140;
  }

  /*
   * Hindi को fallback भाषा के रूप में रखें।
   */
  if (isHindiVoice(voice)) {
    score += 90;
  }

  /*
   * Natural / Neural / Premium voice को अतिरिक्त
   * प्राथमिकता।
   */
  if (isNaturalVoice(voice)) {
    score += 35;
  }

  if (voice.default) {
    score += 4;
  }

  /*
   * Sanskrit या Hindi से संबंधित voice को ही वास्तविक
   * candidate मानें।
   */
  if (
    !isSanskritVoice(voice) &&
    !isHindiVoice(voice)
  ) {
    return -Infinity;
  }

  return score;
}

function selectMaleSanskritVoice() {
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

  /*
   * पहले स्पष्ट पुरुष voices।
   */
  const candidates =
    voices
      .map(voice => ({
        voice,
        score: maleVoiceScore(voice)
      }))
      .filter(
        item =>
          Number.isFinite(item.score)
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  return (
    candidates[0]?.voice ||
    null
  );
}


/* =========================================================
   Basic Messages
   ========================================================= */

function msg(text) {
  if (system) {
    system.textContent =
      String(text || '');
  }
}

function vmsg(text) {
  if (videoStatus) {
    videoStatus.textContent =
      String(text || '');
  }
}

function umsg(text) {
  if (uploadStatus) {
    uploadStatus.textContent =
      String(text || '');
  }
}

function speech() {
  return window.speechSynthesis;
}


/* =========================================================
   TTS Rate
   ========================================================= */

function clampRate(value) {
  const numeric =
    Number(value);

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

  const value =
    clampRate(rate.value);

  rate.value =
    String(value);

  rateValue.textContent =
    value.toFixed(2);
}


/* =========================================================
   Playback State
   ========================================================= */

function setPlaybackState(nextState) {
  state.playbackState =
    nextState;

  updateControlState();
}

function updateControlState() {
  if (playBtn) {
    playBtn.disabled =
      !state.dataReady ||
      !state.videoReady ||
      state.previewing ||
      state.playbackState ===
        PLAYBACK_STATES.PLAYING;
  }

  if (pauseBtn) {
    pauseBtn.disabled =
      state.playbackState !==
      PLAYBACK_STATES.PLAYING;
  }

  if (stopBtn) {
    stopBtn.disabled =
      !state.dataReady &&
      !state.videoReady &&
      state.playbackState ===
        PLAYBACK_STATES.IDLE &&
      !state.previewing;
  }

  if (previewBtn) {
    previewBtn.disabled =
      !state.videoReady ||
      state.playbackState !==
        PLAYBACK_STATES.IDLE;

    previewBtn.textContent =
      state.previewing
        ? 'Preview रोकें'
        : 'वीडियो Preview';
  }
}


/* =========================================================
   Progress
   ========================================================= */

function setTextProgress(percent) {
  const numeric =
    Number(percent);

  const safe =
    Number.isFinite(numeric)
      ? Math.max(
          0,
          Math.min(
            100,
            numeric
          )
        )
      : 0;

  const value =
    Math.round(safe);

  if (textBar) {
    textBar.value = value;
  }

  if (textPct) {
    textPct.value =
      `${value}%`;
  }
}

function setTtsProgress(percent) {
  const numeric =
    Number(percent);

  const safe =
    Number.isFinite(numeric)
      ? Math.max(
          0,
          Math.min(
            100,
            numeric
          )
        )
      : 0;

  const value =
    Math.round(safe);

  if (ttsBar) {
    ttsBar.value = value;
  }

  if (ttsPct) {
    ttsPct.value =
      `${value}%`;
  }
}

function resetProgress() {
  setTextProgress(0);
  setTtsProgress(0);
}


/* =========================================================
   Completion
   ========================================================= */

function setCompletionState(
  type,
  value
) {
  if (type === 'text') {
    state.textDone =
      Boolean(value);
  }

  if (type === 'tts') {
    state.ttsDone =
      Boolean(value);
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

function finish() {
  if (
    !state.textDone ||
    !state.ttsDone
  ) {
    return false;
  }

  state.speechActive = false;
  state.index =
    state.segments.length;

  state.previewing = false;

  video?.pause();

  setPlaybackState(
    PLAYBACK_STATES.COMPLETED
  );

  if (
    current &&
    state.segments.length
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

  msg(
    'वाचन पूर्ण हुआ।'
  );

  return true;
}


/* =========================================================
   Text Data
   ========================================================= */

function clearActive() {
  textBox?.querySelectorAll(
    '.segment.active'
  ).forEach(node => {
    node.classList.remove(
      'active'
    );
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
        document.createElement(
          'span'
        );

      node.className =
        'segment';

      node.id =
        `seg-${index}`;

      node.dataset.index =
        String(index);

      node.textContent =
        `${segment.text} `;

      fragment.append(node);
    }
  );

  textBox.append(
    fragment
  );
}

function normalize(
  item,
  index
) {
  if (typeof item === 'string') {
    const text =
      item.trim();

    return text
      ? {
          id: index + 1,
          text
        }
      : null;
  }

  if (
    !item ||
    typeof item !==
      'object'
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

  return {
    id:
      item.id ??
      item.number ??
      index + 1,

    text
  };
}

function extract(data) {
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

async function loadText() {
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

  state.segments =
    extract(
      await response.json()
    );

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
   Voice Refresh
   ========================================================= */

function refreshVoice(
  { announce = true } = {}
) {
  const synth =
    speech();

  if (!synth) {
    return null;
  }

  const voices =
    synth
      .getVoices()
      .filter(Boolean);

  /*
   * Browser पहली call पर voice-list खाली दे सकता है।
   * यह failure नहीं है; voiceschanged इसे बाद में ठीक करेगा।
   */
  if (!voices.length) {
    return null;
  }

  /*
   * पहले से चयनित male voice उपलब्ध है तो उसे बनाए रखें।
   */
  if (
    state.voice &&
    voices.some(
      voice =>
        voice.voiceURI ===
        state.voice.voiceURI
    )
  ) {
    return state.voice;
  }

  const selected =
    selectMaleSanskritVoice();

  state.voice =
    selected || null;

  if (!voiceStatus || !announce) {
    return state.voice;
  }

  if (state.voice) {
    voiceStatus.textContent =
      `पुरुष संस्कृत TTS: ${state.voice.name} (${state.voice.lang})`;
  } else {
    voiceStatus.textContent =
      'उपयुक्त पुरुष Sanskrit/Hindi voice अभी उपलब्ध नहीं मिली।';
  }

  return state.voice;
}


/* =========================================================
   Text Highlight
   ========================================================= */

function reducedMotion() {
  return Boolean(
    window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
  );
}

function highlight(index) {
  clearActive();

  const node =
    $(`seg-${index}`);

  const segment =
    state.segments[index];

  if (!node || !segment) {
    return;
  }

  node.classList.add(
    'active'
  );

  try {
    node.scrollIntoView({
      behavior:
        reducedMotion()
          ? 'auto'
          : 'smooth',

      block: 'center'
    });
  } catch (_) {
    /* No-op */
  }

  if (current) {
    current.textContent =
      segment.text;
  }
}


/* =========================================================
   Traversal
   ========================================================= */

function updateTextTraversal(
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
   TTS Utterance
   ========================================================= */

function utteranceLanguage(
  voice
) {
  const lang =
    String(
      voice?.lang || ''
    ).toLowerCase();

  if (
    lang === 'sa' ||
    lang.startsWith('sa-')
  ) {
    return voice.lang;
  }

  if (
    lang === 'hi' ||
    lang.startsWith('hi-')
  ) {
    return voice.lang;
  }

  return 'sa-IN';
}

function makeUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.lang =
    utteranceLanguage(
      state.voice
    );

  utterance.rate =
    clampRate(
      rate?.value
    );

  utterance.pitch = 1;
  utterance.volume = 1;

  if (state.voice) {
    utterance.voice =
      state.voice;
  }

  utterance.onstart = () => {
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
        `पाठ-खंड ${state.index + 1} / ${state.segments.length} पढ़ा जा रहा है।`;
    }
  };

  utterance.onend = () => {
    if (
      token !==
      state.speechToken
    ) {
      return;
    }

    state.speechActive =
      false;

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

      state.speechActive =
        false;

      if (
        event?.error ===
        'interrupted'
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
        'TTS segment पूरा नहीं हो सका। वाचन paused है।'
      );
    };

  return utterance;
}


/* =========================================================
   Speak
   ========================================================= */

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

  refreshVoice({
    announce: true
  });

  if (!state.voice) {
    state.speechActive =
      false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'उपयुक्त पुरुष Sanskrit/Hindi TTS voice चयनित नहीं हो सकी।';
    }

    msg(
      'पुरुष TTS voice चयनित नहीं हो सकी।'
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
    return false;
  }

  highlight(
    state.index
  );

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

  state.speechActive =
    true;

  try {
    synth.speak(
      utterance
    );

    return true;
  } catch (_) {
    state.speechActive =
      false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    msg(
      'Browser ने TTS प्रारंभ करने से मना कर दिया।'
    );

    return false;
  }
}


/* =========================================================
   Start / Resume / Play
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

  refreshVoice({
    announce: true
  });

  if (!state.voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'उपयुक्त पुरुष Sanskrit/Hindi TTS voice चयनित नहीं हो सकी।';
    }

    msg(
      'पुरुष TTS voice चयनित नहीं हो सकी।'
    );

    return false;
  }

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
  } catch (_) {
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
    'वीडियो और पुरुष संस्कृत TTS वाचन चल रहा है।'
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

  refreshVoice({
    announce: true
  });

  if (!state.voice) {
    msg(
      'पुरुष TTS voice चयनित नहीं हो सकी।'
    );

    return false;
  }

  try {
    await video.play();
  } catch (_) {
    msg(
      'वीडियो playback पुनः प्रारंभ नहीं हो सका।'
    );

    return false;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  if (synth.paused) {
    synth.resume();
  } else if (!synth.speaking) {
    speakCurrentSegment();
  }

  vmsg(
    'वीडियो और पुरुष TTS पुनः चल रहे हैं।'
  );

  msg(
    'वाचन पुनः जारी है।'
  );

  return true;
}

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
   Pause / Stop
   ========================================================= */

function pausePlayback() {
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
  speech()?.pause();

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

function stop(options = {}) {
  const silent =
    Boolean(options.silent);

  state.speechToken += 1;
  state.speechActive = false;
  state.previewing = false;

  speech()?.cancel();

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

  video.currentTime = 0;

  try {
    await video.play();
  } catch (_) {
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
   Video Upload
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

  return (
    Math.abs(
      (
        video.videoWidth /
        video.videoHeight
      ) -
      9 / 16
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
    file.type.startsWith(
      'video/'
    )
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
    URL.createObjectURL(
      file
    );

  video.src =
    state.objectUrl;

  video.loop = false;
  video.preload = 'metadata';

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

    video.currentTime = 0;

    await video.play();

    vmsg(
      'वीडियो Preview चल रहा है।'
    );
  } catch (_) {
    state.previewing = false;

    updateControlState();

    msg(
      'Preview प्रारंभ नहीं हो सका।'
    );
  }
}

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
  } catch (_) {
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
  } catch (_) {
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
  } catch (_) {
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
      refreshVoice({
        announce: true
      });
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
   * Browser में voice-list पहली call पर खाली हो सकती है।
   * voiceschanged event उपलब्ध होने पर पुरुष voice फिर चुनी जाएगी।
   */
  refreshVoice({
    announce: true
  });

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

    refreshVoice({
      announce: true
    });

    if (state.voice) {
      msg(
        'App तैयार है। पुरुष संस्कृत TTS voice चयनित है।'
      );
    } else {
      msg(
        'पाठ तैयार है; उपलब्ध voice list की प्रतीक्षा है।'
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
