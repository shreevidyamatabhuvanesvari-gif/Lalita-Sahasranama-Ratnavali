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
   STATUS HELPERS
   ========================================================= */

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
  return window.speechSynthesis;
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function clampRate(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0.9;
  }

  return Math.max(0.6, Math.min(1.2, numeric));
}

function reducedMotion() {
  return Boolean(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}


/* =========================================================
   PLAYBACK STATE
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
      (
        state.playbackState !== PLAYBACK_STATES.IDLE &&
        !state.previewing
      );

    previewBtn.textContent =
      state.previewing
        ? 'Preview रोकें'
        : 'वीडियो Preview';
  }
}


/* =========================================================
   RATE
   ========================================================= */

function updateRate() {
  if (!rate || !rateValue) return;

  const value = clampRate(rate.value);

  rate.value = String(value);
  rateValue.textContent = value.toFixed(2);
}


/* =========================================================
   PROGRESS
   ========================================================= */

function setTextProgress(percent) {
  const numeric = Number(percent);

  const safePercent = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;

  if (textBar) {
    textBar.value = safePercent;
  }

  if (textPct) {
    textPct.textContent = `${safePercent}%`;
  }
}

function setTtsProgress(percent) {
  const numeric = Number(percent);

  const safePercent = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;

  if (ttsBar) {
    ttsBar.value = safePercent;
  }

  if (ttsPct) {
    ttsPct.textContent = `${safePercent}%`;
  }
}

function resetProgress() {
  setTextProgress(0);
  setTtsProgress(0);
}


/* =========================================================
   COMPLETION GATE
   ========================================================= */

function setCompletionState(type, value) {
  const complete = Boolean(value);

  if (type === 'text') {
    state.textDone = complete;
  }

  if (type === 'tts') {
    state.ttsDone = complete;
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

  /*
   * Completion gate is authoritative.
   * Video is stopped only after BOTH text and TTS are complete.
   */
  video?.pause();

  setPlaybackState(PLAYBACK_STATES.COMPLETED);

  if (current && state.segments.length) {
    current.textContent =
      state.segments[state.segments.length - 1].text;
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
   TEXT RENDERING
   ========================================================= */

function clearActive() {
  textBox
    ?.querySelectorAll('.segment.active')
    .forEach(node => {
      node.classList.remove('active');
    });
}

function renderText() {
  if (!textBox) return;

  textBox.replaceChildren();

  const fragment =
    document.createDocumentFragment();

  state.segments.forEach((segment, index) => {
    const node =
      document.createElement('span');

    node.className = 'segment';
    node.id = `seg-${index}`;
    node.dataset.index = String(index);

    node.textContent =
      `${segment.text} `;

    fragment.append(node);
  });

  textBox.append(fragment);
}


/* =========================================================
   DATA NORMALIZATION
   ========================================================= */

function normalize(item, index) {
  if (typeof item === 'string') {
    const text = item.trim();

    return text
      ? {
          id: index + 1,
          text
        }
      : null;
  }

  if (!item || typeof item !== 'object') {
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
    id: item.id ?? index + 1,
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
      data?.names ??
      data?.entries ??
      data?.ratnavali ??
      data?.text ??
      [];
  }

  if (!Array.isArray(list)) {
    throw new Error(
      'segments array नहीं मिला।'
    );
  }

  return list
    .map(normalize)
    .filter(Boolean);
}


/* =========================================================
   LOAD CANONICAL TEXT
   ========================================================= */

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
   FEMALE SANSKRIT VOICE
   ========================================================= */

function femaleSanskrit(voice) {
  if (!voice) {
    return false;
  }

  const lang =
    String(
      voice.lang || ''
    ).toLowerCase();

  const name =
    String(
      voice.name || ''
    );

  const voiceUri =
    String(
      voice.voiceURI || ''
    );

  const descriptor =
    `${name} ${voiceUri}`;

  const isSanskrit =
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    /sanskrit|संस्कृत|vedic|वेद/i.test(
      descriptor
    );

  const isFemale =
    /female|woman|girl|lady|स्त्री|महिला|nari/i.test(
      descriptor
    );

  return (
    isSanskrit &&
    isFemale
  );
}

function refreshVoice() {
  const synth = speech();

  if (!synth) {
    state.voice = null;
    return;
  }

  const voices =
    synth.getVoices();

  state.voice =
    voices.find(
      femaleSanskrit
    ) || null;

  if (voiceStatus) {
    voiceStatus.textContent =
      state.voice
        ? `महिला संस्कृत voice: ${state.voice.name}`
        : 'महिला संस्कृत voice उपलब्ध नहीं है; male fallback नहीं होगा।';
  }
}


/* =========================================================
   TEXT HIGHLIGHT
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

  node.scrollIntoView({
    behavior:
      reducedMotion()
        ? 'auto'
        : 'smooth',
    block: 'center'
  });

  if (current) {
    current.textContent =
      segment.text;
  }
}


/* =========================================================
   TEXT / TTS PROGRESS
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
    ) / state.segments.length
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

  const safeCompleted =
    Number.isFinite(
      Number(completedSegments)
    )
      ? Number(completedSegments)
      : 0;

  state.ttsCompleted =
    Math.max(
      0,
      Math.min(
        Math.floor(safeCompleted),
        state.segments.length
      )
    );

  setTtsProgress(
    (
      state.ttsCompleted *
      100
    ) / state.segments.length
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
   SPEECH UTTERANCE
   ========================================================= */

function makeUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.lang = 'sa-IN';
  utterance.rate =
    clampRate(rate?.value);

  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.voice =
    state.voice;

  utterance.onstart = () => {
    if (
      token !==
      state.speechToken
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
      token !==
      state.speechToken
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

    /*
     * The final TTS segment is complete only here,
     * after its actual onend event.
     */
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
     * Normal segment chaining.
     * NEVER cancel speech here.
     */
    if (
      state.playbackState ===
      PLAYBACK_STATES.PLAYING
    ) {
      speakCurrentSegment();
    }
  };

  utterance.onerror = event => {
    if (
      token !==
      state.speechToken
    ) {
      return;
    }

    state.speechActive = false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        `TTS त्रुटि: ${event.error || 'अज्ञात त्रुटि'}`;
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
   SPEAK CURRENT SEGMENT
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

  if (!state.voice) {
    state.speechActive = false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    if (ttsStatus) {
      ttsStatus.textContent =
        'आवश्यक महिला संस्कृत voice उपलब्ध नहीं है।';
    }

    msg(
      'महिला संस्कृत voice उपलब्ध नहीं है; TTS प्रारंभ नहीं किया गया।'
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

  highlight(
    state.index
  );

  updateTextTraversal(
    state.index
  );

  const token =
    ++state.speechToken;

  const item =
    state.segments[state.index];

  if (!item?.text) {
    state.speechActive = false;

    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    msg(
      'वर्तमान पाठ-खंड उपलब्ध नहीं है।'
    );

    return false;
  }

  const utterance =
    makeUtterance(
      item.text,
      token
    );

  state.speechActive = true;

  synth.speak(
    utterance
  );

  return true;
}


/* =========================================================
   FRESH PLAYBACK
   ========================================================= */

async function startFreshPlayback() {
  const synth =
    speech();

  refreshVoice();

  if (!synth) {
    msg(
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।'
    );

    return false;
  }

  if (!state.voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'महिला संस्कृत voice उपलब्ध न होने से TTS प्रारंभ नहीं होगा।';
    }

    msg(
      'महिला संस्कृत voice उपलब्ध नहीं है।'
    );

    return false;
  }

  /*
   * cancel() is permitted here because this is
   * a NEW playback session.
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

    return false;
  }

  vmsg(
    'वीडियो और संस्कृत वाचन चल रहा है।'
  );

  msg(
    'वाचन प्रारंभ हो गया।'
  );

  return true;
}


/* =========================================================
   RESUME
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
      'महिला संस्कृत voice उपलब्ध नहीं है।'
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
   * Resume is STATE-FIRST:
   * 1. If speech is paused, resume it.
   * 2. If speech is already speaking, do NOT create another utterance.
   * 3. Only if neither is true, start the current segment.
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
   PLAY
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
      'पहले Preview रोकें, फिर Play दबाएँ।'
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
   PAUSE
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
   STOP / RESET PLAYBACK POSITION
   ========================================================= */

function stop(options = {}) {
  const silent =
    Boolean(options.silent);

  const synth =
    speech();

  /*
   * Lifecycle termination point:
   * cancellation is intentionally allowed here.
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
   VIDEO END
   ========================================================= */

async function handleVideoEnded() {
  /*
   * Preview ending is independent from playback completion.
   */
  if (state.previewing) {
    state.previewing = false;

    updateControlState();

    vmsg(
      'वीडियो Preview पूर्ण हुआ।'
    );

    return;
  }

  /*
   * Video ending NEVER means the reading is complete.
   * It may loop while playback is active and the
   * completion gate is not satisfied.
   */
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
    state.speechToken += 1;
    state.speechActive = false;

    speech()?.pause();
    video?.pause();

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
   VIDEO MANAGEMENT
   ========================================================= */

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );
  }

  state.objectUrl = '';
  state.videoReady = false;
  state.previewing = false;

  if (video) {
    video.onloadedmetadata = null;
    video.removeAttribute('src');
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

  return Math.abs(
    ratio - 9 / 16
  ) <= 0.03;
}

function metadataLoaded(file) {
  if (!validRatio()) {
    clearVideo();

    if (upload) {
      upload.value = '';
    }

    if (placeholder) {
      placeholder.hidden = false;
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
    placeholder.hidden = true;
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

  video.src =
    state.objectUrl;

  video.loop = false;
  video.preload = 'metadata';

  video.onloadedmetadata =
    () => metadataLoaded(file);

  video.load();

  umsg(
    `जाँच जारी: ${file.name}`
  );

  msg(
    'वीडियो की 9:16 ratio जाँची जा रही है…'
  );
}


/* =========================================================
   PREVIEW
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
      PLAYBACK_STATES.IDLE &&
    !state.previewing
  ) {
    msg(
      'Preview केवल स्वतंत्र IDLE स्थिति में उपलब्ध है।'
    );

    return;
  }

  /*
   * Preview toggle.
   */
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

    /*
     * Preview is video-only.
     * It never starts TTS.
     */
    video.currentTime = 0;

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
   REMOVE VIDEO
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
    placeholder.hidden = false;
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
   SAFE LOCAL STORAGE
   ========================================================= */

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
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

    return true;
  } catch (error) {
    msg(
      'सेटिंग सुरक्षित नहीं की जा सकी।'
    );

    return false;
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(
      key
    );
  } catch (error) {
    /*
     * Storage unavailable.
     * Application continues normally.
     */
  }
}


/* =========================================================
   SETTINGS
   ========================================================= */

function saveSettings() {
  const value =
    clampRate(rate?.value);

  if (
    safeStorageSet(
      'lalitaTtsRate',
      String(value)
    )
  ) {
    updateRate();

    msg(
      'TTS वाचन गति सुरक्षित कर दी गई।'
    );
  }
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
          0.9
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
    rate.value = '0.9';
  }

  updateRate();

  msg(
    'App settings reset कर दी गईं।'
  );
}


/* =========================================================
   EVENT BINDING
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
    refreshVoice
  );
}


/* =========================================================
   BROWSER SUPPORT
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
    'आवश्यक Sanskrit TTS सुविधा इस Browser में उपलब्ध नहीं है।'
  );

  return false;
}


/* =========================================================
   CLEANUP
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
   INITIALIZATION
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

    msg(
      state.voice
        ? 'App पूर्णतः तैयार है।'
        : 'पाठ तैयार है; महिला संस्कृत voice उपलब्ध नहीं है।'
    );
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


/* =========================================================
   START
   ========================================================= */

init();
