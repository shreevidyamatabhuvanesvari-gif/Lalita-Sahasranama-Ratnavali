/*
 * app.js — श्रीललितासहस्रनाम स्तोत्र रत्नावली
 * महिला-संस्कृत TTS अनिवार्य; male fallback नहीं।
 * index.html का पुराना inline <script> हटाकर केवल यह file रखें।
 */
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

  initialized: false
};

const msg = text => {
  if (system) system.textContent = text;
};

const vmsg = text => {
  if (videoStatus) videoStatus.textContent = text;
};

const umsg = text => {
  if (uploadStatus) uploadStatus.textContent = text;
};

const speech = () => window.speechSynthesis;

const clampRate = value =>
  Math.max(
    0.6,
    Math.min(
      1.2,
      Number(value) || 0.9
    )
  );


/* =========================================================
 * Playback State
 * ========================================================= */

function setPlaybackState(nextState) {
  state.playbackState = nextState;
  updateControlState();
}

function updateControlState() {
  if (playBtn) {
    playBtn.disabled =
      !state.dataReady ||
      !state.videoReady ||
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
      state.playbackState === PLAYBACK_STATES.IDLE;
  }

  if (previewBtn) {
    previewBtn.disabled =
      !state.videoReady ||
      state.playbackState !== PLAYBACK_STATES.IDLE;
  }
}


/* =========================================================
 * TTS Rate
 * ========================================================= */

function updateRate() {
  if (!rate || !rateValue) return;

  rate.value = String(
    clampRate(rate.value)
  );

  rateValue.textContent =
    Number(rate.value).toFixed(2);
}


/* =========================================================
 * Independent Progress
 * ========================================================= */

function setTextProgress(percent) {
  const p = Math.max(
    0,
    Math.min(
      100,
      Math.round(percent)
    )
  );

  if (textBar) {
    textBar.value = p;
  }

  if (textPct) {
    textPct.value = `${p}%`;
  }
}

function setTtsProgress(percent) {
  const p = Math.max(
    0,
    Math.min(
      100,
      Math.round(percent)
    )
  );

  if (ttsBar) {
    ttsBar.value = p;
  }

  if (ttsPct) {
    ttsPct.value = `${p}%`;
  }
}

function resetProgress() {
  setTextProgress(0);
  setTtsProgress(0);
}


/* =========================================================
 * Independent Completion State
 * ========================================================= */

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


/* =========================================================
 * Final Completion Synchronization
 * ========================================================= */

function finish() {
  if (
    !state.textDone ||
    !state.ttsDone
  ) {
    return false;
  }

  state.speechActive = false;

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
 * Text Rendering
 * ========================================================= */

function clearActive() {
  textBox
    ?.querySelectorAll('.segment.active')
    .forEach(node =>
      node.classList.remove('active')
    );
}

function renderText() {
  if (!textBox) return;

  textBox.replaceChildren();

  const fragment =
    document.createDocumentFragment();

  state.segments.forEach(
    (segment, index) => {
      const node =
        document.createElement('span');

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

  textBox.append(fragment);
}


/* =========================================================
 * Canonical JSON Handling
 * ========================================================= */

function normalize(item, index) {
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

  return text
    ? {
        id:
          item.id ??
          index + 1,
        text
      }
    : null;
}

function extract(data) {
  const list =
    Array.isArray(data)
      ? data
      : data?.segments ??
        data?.names ??
        data?.text ??
        [];

  if (!Array.isArray(list)) {
    throw Error(
      'segments array नहीं मिला।'
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
    throw Error(
      `JSON HTTP ${response.status}`
    );
  }

  state.segments =
    extract(
      await response.json()
    );

  if (!state.segments.length) {
    throw Error(
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
 * Female Sanskrit Voice
 * ========================================================= */

function femaleSanskrit(voice) {
  if (!voice) return false;

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

  const voiceDescriptor =
    `${name} ${voiceUri}`;

  const isSanskrit =
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    /sanskrit|संस्कृत|vedic|वेद/i.test(
      voiceDescriptor
    );

  const isFemale =
    /female|woman|girl|lady|स्त्री|महिला|nari/i.test(
      voiceDescriptor
    );

  return (
    isSanskrit &&
    isFemale
  );
}

function refreshVoice() {
  const synth =
    speech();

  if (!synth) {
    return;
  }

  state.voice =
    synth
      .getVoices()
      .find(femaleSanskrit) ||
    null;

  if (voiceStatus) {
    voiceStatus.textContent =
      state.voice
        ? `महिला संस्कृत voice: ${state.voice.name}`
        : 'महिला संस्कृत voice उपलब्ध नहीं है; male fallback नहीं होगा।';
  }
}


/* =========================================================
 * Reduced Motion
 * ========================================================= */

function reducedMotion() {
  return Boolean(
    window
      .matchMedia?.(
        '(prefers-reduced-motion: reduce)'
      )
      .matches
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
 * Independent Text Traversal
 * ========================================================= */

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
 * Independent TTS Progress
 * ========================================================= */

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
 * SpeechSynthesis
 * ========================================================= */

function makeUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.lang =
    'sa-IN';

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

    state.ttsCompleted =
      Math.min(
        state.index + 1,
        state.segments.length
      );

    updateTtsProgress(
      state.ttsCompleted
    );

    if (
      state.index >=
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

    state.index += 1;

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

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    video?.pause();

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
    state.segments[
      state.index
    ];

  const utterance =
    makeUtterance(
      item.text,
      token
    );

  state.speechActive =
    true;

  synth.speak(
    utterance
  );

  return true;
}


/* =========================================================
 * Fresh Playback
 * ========================================================= */

async function startFreshPlayback() {
  const synth =
    speech();

  refreshVoice();

  if (
    !synth ||
    !state.voice
  ) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'महिला संस्कृत voice उपलब्ध न होने से TTS प्रारंभ नहीं होगा।';
    }

    msg(
      'महिला संस्कृत voice उपलब्ध नहीं है।'
    );

    return false;
  }

  synth.cancel();

  state.speechToken++;
  state.speechActive =
    false;

  state.index = 0;

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

  speakCurrentSegment();

  vmsg(
    'वीडियो और संस्कृत वाचन चल रहा है।'
  );

  msg(
    'वाचन प्रारंभ हो गया।'
  );

  return true;
}


/* =========================================================
 * Explicit Resume
 * ========================================================= */

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
 * Play
 * ========================================================= */

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

  if (
    state.playbackState ===
      PLAYBACK_STATES.COMPLETED ||
    state.textDone ||
    state.ttsDone
  ) {
    stop({
      silent: true
    });
  }

  await startFreshPlayback();
}


/* =========================================================
 * Explicit Pause
 * ========================================================= */

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
 * Stop / Reset Playback
 * ========================================================= */

function stop(options = {}) {
  const silent =
    Boolean(
      options.silent
    );

  const synth =
    speech();

  state.speechToken++;
  state.speechActive =
    false;

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
 * Video Loop Synchronization
 * ========================================================= */

async function replayVideo() {
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
    state.speechToken++;
    state.speechActive =
      false;

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
 * Video Upload / Validation
 * ========================================================= */

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );
  }

  state.objectUrl = '';
  state.videoReady =
    false;

  if (video) {
    video.onloadedmetadata =
      null;

    video.removeAttribute(
      'src'
    );

    video.load();
    video.loop =
      false;
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
      video.videoWidth /
        video.videoHeight -
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

  state.videoReady =
    true;

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

function selectVideo(event) {
  const file =
    event.target.files?.[0];

  if (!file) return;

  if (!fileAllowed(file)) {
    umsg(
      'कृपया मान्य video file चुनें।'
    );

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

  video.loop =
    false;

  video.preload =
    'metadata';

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
 * Preview
 * ========================================================= */

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

  if (!video.paused) {
    video.pause();

    vmsg(
      'वीडियो Preview रोका गया।'
    );

    return;
  }

  try {
    await video.play();

    vmsg(
      'वीडियो Preview चल रहा है।'
    );
  } catch (error) {
    msg(
      'Preview प्रारंभ नहीं हो सका।'
    );
  }
}


/* =========================================================
 * Video Removal
 * ========================================================= */

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
 * Settings
 * ========================================================= */

function saveSettings() {
  localStorage.setItem(
    'lalitaTtsRate',
    String(
      clampRate(
        rate?.value
      )
    )
  );

  updateRate();

  msg(
    'TTS वाचन गति सुरक्षित कर दी गई।'
  );
}

function loadSettings() {
  const saved =
    localStorage.getItem(
      'lalitaTtsRate'
    );

  if (rate) {
    rate.value =
      String(
        clampRate(
          saved ||
          rate.value ||
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

  localStorage.removeItem(
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
 * Events
 * ========================================================= */

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
    replayVideo
  );

  speech()?.addEventListener(
    'voiceschanged',
    refreshVoice
  );
}


/* =========================================================
 * Browser / File Support
 * ========================================================= */

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

function fileAllowed(file) {
  return Boolean(
    file &&
    file.type.startsWith('video/')
  );
}


/* =========================================================
 * Cleanup
 * ========================================================= */

function cleanup() {
  state.speechToken++;
  state.speechActive =
    false;

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
 * Initialization
 * ========================================================= */

async function init() {
  if (state.initialized) {
    return;
  }

  state.initialized =
    true;

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
    video.loop =
      false;
  }

  try {
    await loadText();

    msg(
      state.voice
        ? 'App पूर्णतः तैयार है।'
        : 'पाठ तैयार है; महिला संस्कृत voice उपलब्ध नहीं है।'
    );
  } catch (error) {
    state.dataReady =
      false;

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
