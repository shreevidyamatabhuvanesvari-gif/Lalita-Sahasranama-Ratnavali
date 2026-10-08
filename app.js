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

const state = {
  initialized: false,
  sourceData: null,
  mode: CONTENT_MODES.STOTRA,
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
  ttsSupported: false,
  speechToken: 0,
  speechActive: false,
  previewing: false,
  lastVideoFileName: ''
};

const msg = text => {
  if (system) system.textContent = String(text);
};

const vmsg = text => {
  if (videoStatus) videoStatus.textContent = String(text);
};

const umsg = text => {
  if (uploadStatus) uploadStatus.textContent = String(text);
};

const speech = () =>
  'speechSynthesis' in window ? window.speechSynthesis : null;

const clampRate = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.9;
  return Math.max(0.6, Math.min(1.2, numeric));
};

function setPlaybackState(nextState) {
  state.playbackState = nextState;
  updateControlState();
}

function updateControlState() {
  const playbackActive = state.playbackState === PLAYBACK_STATES.PLAYING;
  const playbackPaused = state.playbackState === PLAYBACK_STATES.PAUSED;
  const canPlay = state.dataReady && state.videoReady && state.ttsSupported;

  if (playBtn) {
    playBtn.disabled =
      !canPlay ||
      state.previewing ||
      playbackActive;
  }

  if (pauseBtn) {
    pauseBtn.disabled = !playbackActive;
  }

  if (stopBtn) {
    stopBtn.disabled =
      !state.videoReady &&
      !state.previewing &&
      !playbackPaused &&
      !playbackActive;
  }

  if (previewBtn) {
    previewBtn.disabled = !state.videoReady || playbackActive || playbackPaused;
    previewBtn.textContent = state.previewing
      ? 'Preview रोकें'
      : 'वीडियो Preview';
  }

  if (contentMode) {
    contentMode.disabled = playbackActive || playbackPaused || state.previewing;
  }

  if (removeBtn) {
    removeBtn.disabled = !state.videoReady && !state.previewing;
  }
}

function updateRate() {
  if (!rate || !rateValue) return;
  const safe = clampRate(rate.value);
  rate.value = String(safe);
  rateValue.textContent = safe.toFixed(2);
}

function setTextProgress(percent) {
  const numeric = Number(percent);
  const safe = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;
  if (textBar) textBar.value = safe;
  if (textPct) textPct.value = `${safe}%`;
}

function setTtsProgress(percent) {
  const numeric = Number(percent);
  const safe = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;
  if (ttsBar) ttsBar.value = safe;
  if (ttsPct) ttsPct.value = `${safe}%`;
}

function resetProgress() {
  setTextProgress(0);
  setTtsProgress(0);
}

function setCompletionState(type, value) {
  const bool = Boolean(value);

  if (type === 'text') state.textDone = bool;
  if (type === 'tts') state.ttsDone = bool;

  if (textDoneEl) {
    textDoneEl.textContent = state.textDone ? 'पाठ: पूर्ण' : 'पाठ: अपूर्ण';
    textDoneEl.dataset.complete = String(state.textDone);
  }

  if (ttsDoneEl) {
    ttsDoneEl.textContent = state.ttsDone ? 'TTS: पूर्ण' : 'TTS: अपूर्ण';
    ttsDoneEl.dataset.complete = String(state.ttsDone);
  }

  const finished = state.textDone && state.ttsDone;

  if (gateEl) {
    gateEl.textContent = finished ? 'वाचन पूर्ण' : 'वाचन जारी है';
    gateEl.dataset.complete = String(finished);
  }

  if (finished) finishPlayback();
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

function finishPlayback() {
  if (!state.textDone || !state.ttsDone) return false;

  state.speechActive = false;
  state.index = state.segments.length;
  state.previewing = false;

  video?.pause();
  setPlaybackState(PLAYBACK_STATES.COMPLETED);

  if (current && state.segments.length) {
    setMultilineText(current, state.segments[state.segments.length - 1].text);
  }

  if (ttsStatus) ttsStatus.textContent = 'अंतिम TTS segment पूर्ण हुआ।';
  vmsg('पाठ और TTS दोनों पूर्ण — वीडियो रुक गया।');
  msg('वाचन पूर्ण हुआ।');
  return true;
}

function clearActive() {
  textBox?.querySelectorAll('.segment.active').forEach(node => {
    node.classList.remove('active');
  });
}

function appendTextWithLineBreaks(container, text) {
  const parts = String(text).split('\n');
  parts.forEach((part, index) => {
    if (index > 0) container.append(document.createElement('br'));
    container.append(document.createTextNode(part));
  });
}

function setMultilineText(container, text) {
  if (!container) return;
  container.replaceChildren();
  appendTextWithLineBreaks(container, text);
}

function renderText() {
  if (!textBox) return;

  textBox.replaceChildren();
  const fragment = document.createDocumentFragment();

  state.segments.forEach((segment, index) => {
    const node = document.createElement('span');
    node.className = 'segment';
    node.id = `seg-${index}`;
    node.dataset.index = String(index);
    appendTextWithLineBreaks(node, segment.text);
    fragment.append(node, document.createTextNode(' '));
  });

  textBox.append(fragment);
}

function normalizeSegment(item, fallbackIndex) {
  if (typeof item === 'string') {
    const text = item.trim();
    return text
      ? { id: `segment-${fallbackIndex + 1}`, number: fallbackIndex + 1, text }
      : null;
  }

  if (!item || typeof item !== 'object') return null;

  const text = String(item.text ?? item.name ?? '').trim();
  if (!text) return null;

  const number = Number(item.number);
  return {
    id: item.id ?? `segment-${fallbackIndex + 1}`,
    number: Number.isInteger(number) ? number : fallbackIndex + 1,
    text
  };
}

function assertSequentialNumbers(items, label, expectedCount) {
  if (!Array.isArray(items) || items.length !== expectedCount) {
    throw new Error(`${label} में ठीक ${expectedCount} entries अपेक्षित हैं।`);
  }

  for (let i = 0; i < items.length; i += 1) {
    const number = Number(items[i]?.number);
    if (number !== i + 1) {
      throw new Error(
        `${label} numbering त्रुटि: स्थान ${i + 1} पर ${number || 'अज्ञात'} मिला।`
      );
    }
  }
}

function validateCanonicalData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Canonical JSON object नहीं मिला।');
  }

  const stotra = Array.isArray(data.segments) ? data.segments : [];
  const namavali = Array.isArray(data.namavali) ? data.namavali : [];

  assertSequentialNumbers(stotra, 'स्तोत्र', 182);
  assertSequentialNumbers(namavali, 'सहस्रनामावली', 1000);

  if (!String(data.stotraCompletion || '').trim()) {
    throw new Error('stotraCompletion उपलब्ध नहीं है।');
  }

  if (!String(data.colophon || '').trim()) {
    throw new Error('colophon उपलब्ध नहीं है।');
  }

  return data;
}

function buildModeSegments(mode) {
  const data = state.sourceData;
  if (!data) throw new Error('Canonical data अभी उपलब्ध नहीं है।');

  if (mode === CONTENT_MODES.NAMAVALI) {
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

  const stotraSegments = data.segments
    .map(normalizeSegment)
    .filter(Boolean)
    .map(item => ({
      id: item.id,
      number: item.number,
      text: item.text,
      type: 'stotra'
    }));

  const completionText = String(data.stotraCompletion).trim();
  stotraSegments.push({
    id: 'stotra-completion',
    number: stotraSegments.length + 1,
    text: completionText,
    type: 'stotra-completion'
  });

  return stotraSegments;
}

function describeCurrentMode() {
  if (state.mode === CONTENT_MODES.NAMAVALI) {
    return 'श्रीललितासहस्रनामावली — 1000 नाम';
  }
  return 'श्रीललितासहस्रनामस्तोत्रम् — 182 श्लोक + समापन';
}

function applyMode(mode, options = {}) {
  const silent = Boolean(options.silent);
  if (mode !== CONTENT_MODES.STOTRA && mode !== CONTENT_MODES.NAMAVALI) {
    mode = CONTENT_MODES.STOTRA;
  }

  if (!state.sourceData) return false;

  if (
    state.playbackState === PLAYBACK_STATES.PLAYING ||
    state.playbackState === PLAYBACK_STATES.PAUSED ||
    state.previewing
  ) {
    stop({ silent: true });
  }

  state.mode = mode;
  if (contentMode) contentMode.value = mode;
  state.segments = buildModeSegments(mode);
  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  renderText();
  clearActive();
  resetCompletionState();
  resetProgress();
  setPlaybackState(PLAYBACK_STATES.IDLE);

  if (current) current.replaceChildren();
  if (ttsStatus) ttsStatus.textContent = 'वाचन के लिए तैयार।';
  if (contentModeStatus) contentModeStatus.textContent = describeCurrentMode();

  if (!silent) {
    msg(`${describeCurrentMode()} तैयार है।`);
  }

  return true;
}

async function loadCanonicalData() {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`JSON HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Canonical JSON पढ़ा नहीं जा सका।');
  }

  state.sourceData = validateCanonicalData(data);
  state.dataReady = true;

  if (contentMode) contentMode.value = CONTENT_MODES.STOTRA;
  applyMode(CONTENT_MODES.STOTRA, { silent: true });

  msg(`Canonical data सत्यापित: 182 श्लोक और 1000 नाम उपलब्ध हैं।`);
}

function femaleSanskrit(voice) {
  if (!voice) return false;

  const lang = String(voice.lang || '').toLowerCase();
  const name = String(voice.name || '');
  const voiceUri = String(voice.voiceURI || '');
  const descriptor = `${name} ${voiceUri}`;

  const isSanskrit =
    lang === 'sa' ||
    lang.startsWith('sa-') ||
    /sanskrit|संस्कृत|vedic|वेद/i.test(descriptor);

  const explicitlyFemale =
    /female|woman|girl|lady|स्त्री|महिला|nari|नारी/i.test(descriptor);

  return isSanskrit && explicitlyFemale;
}

function refreshVoice() {
  const synth = speech();
  if (!synth) return false;

  const voices = synth.getVoices();
  state.voice = voices.find(femaleSanskrit) || null;

  if (voiceStatus) {
    voiceStatus.textContent = state.voice
      ? `महिला संस्कृत voice: ${state.voice.name}`
      : 'महिला संस्कृत voice उपलब्ध नहीं है; male fallback नहीं होगा।';
  }

  updateControlState();
  return Boolean(state.voice);
}

async function ensureFemaleSanskritVoice(timeout = 4000) {
  const synth = speech();
  if (!synth) return null;

  if (refreshVoice()) return state.voice;

  const started = performance.now();
  while (performance.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (refreshVoice()) return state.voice;
  }

  return state.voice;
}

function reducedMotion() {
  return Boolean(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function highlight(index) {
  clearActive();

  const node = $(`seg-${index}`);
  const segment = state.segments[index];
  if (!node || !segment) return;

  node.classList.add('active');
  node.scrollIntoView({
    behavior: reducedMotion() ? 'auto' : 'smooth',
    block: 'center'
  });

  if (current) setMultilineText(current, segment.text);
}

function updateTextTraversal(index) {
  if (!state.segments.length || index < 0) return;

  state.textIndex = Math.min(index, state.segments.length - 1);
  const percent = ((state.textIndex + 1) * 100) / state.segments.length;
  setTextProgress(percent);

  if (state.textIndex >= state.segments.length - 1) {
    setCompletionState('text', true);
  }
}

function updateTtsProgress(completedSegments) {
  if (!state.segments.length) return;

  state.ttsCompleted = Math.max(
    0,
    Math.min(completedSegments, state.segments.length)
  );

  const percent = (state.ttsCompleted * 100) / state.segments.length;
  setTtsProgress(percent);

  if (state.ttsCompleted >= state.segments.length) {
    setCompletionState('tts', true);
  }
}

function setPausedFromTtsError(errorCode) {
  state.speechActive = false;
  video?.pause();
  setPlaybackState(PLAYBACK_STATES.PAUSED);

  const detail = errorCode ? `: ${errorCode}` : '';
  if (ttsStatus) ttsStatus.textContent = `TTS त्रुटि${detail}`;
  vmsg('TTS त्रुटि के कारण वाचन paused है।');
  msg('TTS segment पूरा नहीं हो सका। Resume से उसी स्थिति से प्रयास करें।');
}

function makeUtterance(text, token) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'sa-IN';
  utterance.rate = clampRate(rate?.value);
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.voice = state.voice;

  utterance.onstart = () => {
    if (token !== state.speechToken) return;
    state.speechActive = true;
    if (ttsStatus) {
      ttsStatus.textContent =
        `${describeCurrentMode()} — segment ${state.index + 1} / ${state.segments.length} पढ़ा जा रहा है।`;
    }
  };

  utterance.onend = () => {
    if (token !== state.speechToken) return;

    state.speechActive = false;
    const completed = Math.min(state.index + 1, state.segments.length);
    updateTtsProgress(completed);

    if (completed >= state.segments.length) {
      state.index = state.segments.length;
      setCompletionState('tts', true);
      return;
    }

    state.index += 1;

    if (state.playbackState === PLAYBACK_STATES.PLAYING) {
      // Normal chaining: deliberately do NOT call speechSynthesis.cancel().
      speakCurrentSegment();
    }
  };

  utterance.onerror = event => {
    if (token !== state.speechToken) return;
    setPausedFromTtsError(event?.error || 'अज्ञात त्रुटि');
  };

  return utterance;
}

function speakCurrentSegment() {
  const synth = speech();

  if (!synth || state.playbackState !== PLAYBACK_STATES.PLAYING) {
    return false;
  }

  if (!state.voice) {
    state.speechActive = false;
    video?.pause();
    setPlaybackState(PLAYBACK_STATES.PAUSED);

    if (ttsStatus) {
      ttsStatus.textContent =
        'आवश्यक महिला संस्कृत voice उपलब्ध नहीं है।';
    }

    msg('महिला संस्कृत voice उपलब्ध नहीं है; TTS प्रारंभ नहीं किया गया।');
    return false;
  }

  if (state.index >= state.segments.length) {
    setCompletionState('tts', true);
    return true;
  }

  highlight(state.index);
  updateTextTraversal(state.index);

  const token = ++state.speechToken;
  const item = state.segments[state.index];
  const utterance = makeUtterance(item.text, token);

  state.speechActive = true;
  try {
    synth.speak(utterance);
    return true;
  } catch (error) {
    if (token === state.speechToken) {
      setPausedFromTtsError(error?.message || 'speak() विफल');
    }
    return false;
  }
}

async function startFreshPlayback() {
  const synth = speech();
  await ensureFemaleSanskritVoice();

  if (!state.ttsSupported || !synth) {
    msg('इस Browser में Speech Synthesis उपलब्ध नहीं है।');
    return false;
  }

  if (!state.voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'महिला संस्कृत voice उपलब्ध न होने से TTS प्रारंभ नहीं होगा।';
    }
    msg('महिला संस्कृत voice उपलब्ध नहीं है। male fallback नहीं किया जाएगा।');
    return false;
  }

  // New playback session: cancel is intentionally allowed here.
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

  if (current) current.replaceChildren();
  if (video) video.currentTime = 0;

  setPlaybackState(PLAYBACK_STATES.PLAYING);

  try {
    await video.play();
  } catch (error) {
    setPlaybackState(PLAYBACK_STATES.IDLE);
    if (ttsStatus) ttsStatus.textContent = 'वीडियो playback प्रारंभ नहीं हो सका।';
    msg('वीडियो playback प्रारंभ नहीं हो सका।');
    return false;
  }

  const started = speakCurrentSegment();
  if (!started) {
    video.pause();
    if (state.playbackState === PLAYBACK_STATES.PLAYING) {
      setPlaybackState(PLAYBACK_STATES.PAUSED);
    }
    return false;
  }

  vmsg('वीडियो और संस्कृत वाचन चल रहा है।');
  msg('वाचन प्रारंभ हो गया।');
  return true;
}

async function resumePlayback() {
  const synth = speech();

  if (!synth || state.playbackState !== PLAYBACK_STATES.PAUSED) {
    return false;
  }

  await ensureFemaleSanskritVoice();
  if (!state.voice) {
    msg('महिला संस्कृत voice उपलब्ध नहीं है।');
    return false;
  }

  // Resume state-first: use the native speech state before creating any utterance.
  setPlaybackState(PLAYBACK_STATES.PLAYING);

  try {
    if (synth.paused) {
      synth.resume();
    } else if (!synth.speaking) {
      speakCurrentSegment();
    }
  } catch (error) {
    video?.pause();
    setPlaybackState(PLAYBACK_STATES.PAUSED);
    setPausedFromTtsError(error?.message || 'resume() विफल');
    return false;
  }

  try {
    await video.play();
  } catch (error) {
    synth.pause();
    video?.pause();
    setPlaybackState(PLAYBACK_STATES.PAUSED);
    msg('वीडियो playback पुनः प्रारंभ नहीं हो सका; TTS paused रखा गया।');
    return false;
  }

  vmsg('वीडियो और TTS पुनः चल रहे हैं।');
  msg('वाचन पुनः जारी है।');
  return true;
}

async function play() {
  if (!state.dataReady) {
    msg('Canonical पाठ अभी उपलब्ध नहीं है।');
    return;
  }

  if (!state.videoReady) {
    msg('पहले 9:16 वीडियो चुनें।');
    return;
  }

  if (!state.ttsSupported) {
    msg('इस Browser में Speech Synthesis उपलब्ध नहीं है।');
    return;
  }

  if (state.previewing) {
    msg('पहले Preview रोकें।');
    return;
  }

  if (state.playbackState === PLAYBACK_STATES.PLAYING) return;

  if (state.playbackState === PLAYBACK_STATES.PAUSED) {
    await resumePlayback();
    return;
  }

  await startFreshPlayback();
}

function pausePlayback() {
  const synth = speech();

  if (state.playbackState !== PLAYBACK_STATES.PLAYING) {
    msg('वाचन अभी चल नहीं रहा है।');
    return;
  }

  video?.pause();
  synth?.pause();
  setPlaybackState(PLAYBACK_STATES.PAUSED);

  if (ttsStatus) ttsStatus.textContent = 'TTS paused है।';
  vmsg('वीडियो और TTS paused हैं।');
  msg('वाचन रोककर paused स्थिति में रखा गया है।');
}

function stop(options = {}) {
  const silent = Boolean(options.silent);
  const synth = speech();

  state.speechToken += 1;
  state.speechActive = false;
  state.previewing = false;

  // Lifecycle cancellation: allowed and intentional.
  synth?.cancel();
  video?.pause();

  if (video) video.currentTime = 0;

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  clearActive();
  resetCompletionState();
  resetProgress();
  setPlaybackState(PLAYBACK_STATES.IDLE);

  if (current) current.replaceChildren();
  if (ttsStatus) ttsStatus.textContent = 'वाचन प्रारंभ नहीं हुआ है।';

  vmsg(state.videoReady ? 'वीडियो तैयार है।' : 'वीडियो अपलोड करें।');
  if (!silent) msg('वाचन बंद करके प्रारंभ पर लौटाया गया।');
}

async function handleVideoEnded() {
  if (state.previewing) {
    state.previewing = false;
    updateControlState();
    vmsg('वीडियो Preview पूर्ण हुआ।');
    return;
  }

  if (
    state.playbackState !== PLAYBACK_STATES.PLAYING ||
    !state.videoReady ||
    (state.textDone && state.ttsDone)
  ) {
    return;
  }

  video.currentTime = 0;

  try {
    await video.play();
    vmsg('वीडियो loop जारी है; TTS अपने क्रम से चल रहा है।');
  } catch (error) {
    // A failed loop ends the synchronized session safely.
    state.speechToken += 1;
    state.speechActive = false;
    speech()?.pause();
    video?.pause();
    setPlaybackState(PLAYBACK_STATES.PAUSED);
    msg('वीडियो loop प्रारंभ नहीं हो सका; वाचन paused है।');
    vmsg('वीडियो replay विफल होने से वाचन paused किया गया।');
  }
}

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }

  state.objectUrl = '';
  state.videoReady = false;
  state.previewing = false;
  state.lastVideoFileName = '';

  if (video) {
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    video.loop = false;
  }

  if (placeholder) placeholder.hidden = false;
  updateControlState();
}

function validRatio() {
  if (!video?.videoWidth || !video?.videoHeight) return false;
  return video.videoWidth * 16 === video.videoHeight * 9;
}

function metadataLoaded(file) {
  const width = video?.videoWidth || 0;
  const height = video?.videoHeight || 0;

  if (!validRatio()) {
    clearVideo();
    if (upload) upload.value = '';

    umsg(`अस्वीकृत: ${file.name} का intrinsic आकार ${width}:${height} है; ठीक 9:16 आवश्यक है।`);
    vmsg('कृपया ठीक 9:16 वीडियो चुनें।');
    msg('वीडियो validation विफल हुई।');
    return;
  }

  state.videoReady = true;
  state.lastVideoFileName = file.name;
  if (placeholder) placeholder.hidden = true;

  umsg(`चयनित: ${file.name}`);
  vmsg('ठीक 9:16 वीडियो तैयार है।');
  msg('वीडियो सफलतापूर्वक सत्यापित और लोड हुआ।');
  updateControlState();
}

function fileAllowed(file) {
  return Boolean(file && file.type.startsWith('video/'));
}

function selectVideo(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!fileAllowed(file)) {
    umsg('कृपया मान्य video file चुनें।');
    event.target.value = '';
    return;
  }

  stop({ silent: true });
  clearVideo();

  state.objectUrl = URL.createObjectURL(file);
  video.src = state.objectUrl;
  video.loop = false;
  video.preload = 'metadata';
  video.onloadedmetadata = () => metadataLoaded(file);
  video.onerror = () => {
    clearVideo();
    if (upload) upload.value = '';
    umsg('वीडियो लोड नहीं हो सका।');
    vmsg('वीडियो codec या file format Browser द्वारा समर्थित नहीं है।');
    msg('वीडियो load error।');
  };
  video.load();

  umsg(`जाँच जारी: ${file.name}`);
  msg('वीडियो की exact 9:16 ratio जाँची जा रही है…');
}

async function preview() {
  if (!state.videoReady) {
    msg('पहले वीडियो चुनें।');
    return;
  }

  if (
    state.playbackState !== PLAYBACK_STATES.IDLE &&
    !state.previewing
  ) {
    msg('Preview केवल स्वतंत्र IDLE स्थिति में उपलब्ध है।');
    return;
  }

  if (state.previewing) {
    video?.pause();
    state.previewing = false;
    updateControlState();
    vmsg('वीडियो Preview रोका गया।');
    return;
  }

  try {
    state.previewing = true;
    updateControlState();
    video.currentTime = 0;
    await video.play();
    vmsg('वीडियो Preview चल रहा है।');
  } catch (error) {
    state.previewing = false;
    updateControlState();
    msg('Preview प्रारंभ नहीं हो सका।');
  }
}

function removeVideo() {
  stop({ silent: true });
  clearVideo();
  if (upload) upload.value = '';
  umsg('कोई वीडियो चयनित नहीं है।');
  vmsg('वीडियो हटाया गया।');
  msg('वीडियो सफलतापूर्वक हटाया गया।');
  updateControlState();
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
    localStorage.setItem(key, value);
  } catch (error) {
    msg('सेटिंग सुरक्षित नहीं की जा सकी। App सामान्य रूप से चलता रहेगा।');
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // Storage unavailable; application continues normally.
  }
}

function saveSettings() {
  safeStorageSet('lalitaTtsRate', String(clampRate(rate?.value)));
  updateRate();
  msg('TTS वाचन गति सुरक्षित कर दी गई।');
}

function loadSettings() {
  const saved = safeStorageGet('lalitaTtsRate');
  if (rate) rate.value = String(clampRate(saved || rate.value || 0.9));
  updateRate();
}

function resetApp() {
  stop({ silent: true });
  safeStorageRemove('lalitaTtsRate');

  if (rate) rate.value = '0.9';
  updateRate();

  if (state.sourceData) {
    applyMode(CONTENT_MODES.STOTRA, { silent: true });
  }

  msg('App settings reset कर दी गईं।');
}

function bindEvents() {
  playBtn?.addEventListener('click', play);
  pauseBtn?.addEventListener('click', pausePlayback);
  stopBtn?.addEventListener('click', () => stop());
  previewBtn?.addEventListener('click', preview);
  removeBtn?.addEventListener('click', removeVideo);
  saveBtn?.addEventListener('click', saveSettings);
  resetBtn?.addEventListener('click', resetApp);
  upload?.addEventListener('change', selectVideo);
  rate?.addEventListener('input', updateRate);
  contentMode?.addEventListener('change', event => {
    applyMode(event.target.value);
  });
  video?.addEventListener('ended', handleVideoEnded);

  const synth = speech();
  synth?.addEventListener('voiceschanged', refreshVoice);
}

function hideTextUI() {
  const textSection = $('textSection');
  if (!textSection) return;
  textSection.hidden = true;
  textSection.setAttribute('aria-hidden', 'true');
}

function browserCheck() {
  state.ttsSupported =
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  if (state.ttsSupported) return true;

  if (voiceStatus) {
    voiceStatus.textContent =
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।';
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'TTS उपलब्ध नहीं है; पाठ फिर भी देखा जा सकता है।';
  }

  msg('Browser में Speech Synthesis उपलब्ध नहीं है; TTS नियंत्रण निष्क्रिय रहेगा।');
  updateControlState();
  return false;
}

function cleanup() {
  state.speechToken += 1;
  state.speechActive = false;
  state.previewing = false;
  speech()?.cancel();

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
}

window.addEventListener('beforeunload', cleanup);

async function init() {
  if (state.initialized) return;
  state.initialized = true;

  browserCheck();
  hideTextUI();
  loadSettings();
  bindEvents();
  refreshVoice();
  resetCompletionState();
  resetProgress();
  setPlaybackState(PLAYBACK_STATES.IDLE);

  if (video) video.loop = false;

  try {
    await loadCanonicalData();
    msg(
      state.ttsSupported
        ? state.voice
          ? 'App पूर्णतः तैयार है। महिला संस्कृत voice चयनित है।'
          : 'पाठ तैयार है; महिला संस्कृत voice उपलब्ध नहीं है।'
        : 'पाठ तैयार है; Browser TTS उपलब्ध नहीं है।'
    );
  } catch (error) {
    state.dataReady = false;
    msg(`Canonical पाठ लोड नहीं हुआ: ${error.message}`);

    if (contentModeStatus) {
      contentModeStatus.textContent = 'Canonical data validation विफल।';
    }

    if (ttsStatus) {
      ttsStatus.textContent =
        'Canonical पाठ उपलब्ध न होने से playback प्रारंभ नहीं होगा।';
    }

    updateControlState();
  }
}

init();
