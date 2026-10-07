/*
 * app.js — श्रीललितासहस्रनाम स्तोत्र रत्नावली
 * महिला-संस्कृत TTS अनिवार्य; male fallback नहीं।
 * index.html का पुराना inline <script> हटाकर केवल यह file रखें।
 */
'use strict';

const $ = id => document.getElementById(id);
const app = $('app'), video = $('videoPlayer'), placeholder = $('videoPlaceholder');
const videoStatus = $('videoStatus'), upload = $('videoUpload'), uploadStatus = $('videoUploadStatus');
const textBox = $('textContent'), current = $('currentSegment'), textBar = $('textProgress');
const ttsBar = $('ttsProgress'), textPct = $('textProgressValue'), ttsPct = $('ttsProgressValue');
const voiceStatus = $('ttsVoiceStatus'), ttsStatus = $('ttsStatus'), rate = $('ttsRate');
const rateValue = $('ttsRateValue'), textDoneEl = $('textCompletion'), ttsDoneEl = $('ttsCompletion');
const gateEl = $('completionGate'), system = $('systemStatus'), playBtn = $('playButton');
const pauseBtn = $('pauseButton'), stopBtn = $('stopButton'), previewBtn = $('previewButton');
const removeBtn = $('removeVideoButton'), saveBtn = $('saveSettingsButton'), resetBtn = $('resetButton');

const state = {
  segments: [], index: 0, playing: false, textDone: false, ttsDone: false,
  voice: null, objectUrl: '', videoReady: false, dataReady: false, speechToken: 0
};
const source = app?.dataset.source || 'data/lalita-sahasranama-ratnavali.json';

const msg = text => { if (system) system.textContent = text; };
const vmsg = text => { if (videoStatus) videoStatus.textContent = text; };
const umsg = text => { if (uploadStatus) uploadStatus.textContent = text; };
const clamp = value => Math.max(.6, Math.min(1.2, Number(value) || .9));

function updateRate() {
  if (!rate || !rateValue) return;
  rate.value = clamp(rate.value);
  rateValue.textContent = Number(rate.value).toFixed(2);
}

function progress(value) {
  const p = Math.max(0, Math.min(100, Math.round(value)));
  if (textBar) textBar.value = p;
  if (ttsBar) ttsBar.value = p;
  if (textPct) textPct.value = `${p}%`;
  if (ttsPct) ttsPct.value = `${p}%`;
}

function completion(text, tts) {
  state.textDone = text; state.ttsDone = tts;
  if (textDoneEl) {
    textDoneEl.textContent = text ? 'पाठ: पूर्ण' : 'पाठ: अपूर्ण';
    textDoneEl.dataset.complete = String(text);
  }
  if (ttsDoneEl) {
    ttsDoneEl.textContent = tts ? 'TTS: पूर्ण' : 'TTS: अपूर्ण';
    ttsDoneEl.dataset.complete = String(tts);
  }
  if (text && tts) finish();
}

function finish() {
  if (!state.textDone || !state.ttsDone) return false;
  state.playing = false; video?.pause();
  if (gateEl) {
    gateEl.textContent = 'वाचन पूर्ण'; gateEl.dataset.complete = 'true';
  }
  vmsg('संपूर्ण पाठ और TTS पूर्ण — वीडियो रुक गया।');
  msg('वाचन पूर्ण हुआ।');
  return true;
}

function resetGate() {
  if (!gateEl) return;
  gateEl.textContent = 'वाचन जारी है'; gateEl.dataset.complete = 'false';
}

function clearActive() {
  document.querySelectorAll('.segment.active').forEach(n => n.classList.remove('active'));
}

function renderText() {
  if (!textBox) return;
  textBox.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.segments.forEach((segment, index) => {
    const node = document.createElement('span');
    node.className = 'segment'; node.id = `seg-${index}`;
    node.dataset.index = index; node.textContent = `${segment.text} `;
    fragment.append(node);
  });
  textBox.append(fragment);
}

function normalize(item, index) {
  if (typeof item === 'string') return { id: index + 1, text: item.trim() };
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text ?? item.name ?? '').trim();
  return text ? { id: item.id ?? index + 1, text } : null;
}

function extract(data) {
  const list = Array.isArray(data) ? data : data?.segments ?? data?.names ?? data?.text ?? [];
  if (!Array.isArray(list)) throw Error('segments array नहीं मिला।');
  return list.map(normalize).filter(Boolean);
}

async function loadText() {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) throw Error(`JSON HTTP ${response.status}`);
  state.segments = extract(await response.json());
  if (!state.segments.length) throw Error('पाठ-खंड उपलब्ध नहीं हैं।');
  renderText(); state.dataReady = true; progress(0);
  if (ttsStatus) ttsStatus.textContent = 'वाचन के लिए तैयार।';
  msg(`${state.segments.length} पाठ-खंड लोड हुए।`);
}

function femaleSanskrit(voice) {
  const lang = String(voice.lang || '').toLowerCase(), name = String(voice.name || '');
  const sanskrit = lang.startsWith('sa') || /sanskrit|संस्कृत|vedic|वेद/i.test(name);
  const female = /female|woman|girl|lady|स्त्री|महिला|nari/i.test(name);
  return sanskrit && female;
}

function refreshVoice() {
  const voices = speechSynthesis.getVoices();
  state.voice = voices.find(femaleSanskrit) || null;
  if (voiceStatus) voiceStatus.textContent = state.voice
    ? `महिला संस्कृत voice: ${state.voice.name}`
    : 'महिला संस्कृत voice उपलब्ध नहीं है; male fallback नहीं होगा।';
}

function highlight(index) {
  clearActive();
  const node = $(`seg-${index}`);
  if (!node) return;
  node.classList.add('active');
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (current) current.textContent = state.segments[index].text;
}

function setSegmentProgress(done) {
  progress(state.segments.length ? done * 100 / state.segments.length : 0);
}

function makeUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'sa-IN'; u.rate = clamp(rate?.value); u.pitch = 1; u.volume = 1; u.voice = state.voice;
  return u;
}

function speakNext() {
  if (!state.playing) return;
  if (!state.voice) {
    state.playing = false; video?.pause();
    return msg('महिला संस्कृत voice उपलब्ध नहीं है; TTS प्रारंभ नहीं किया गया।');
  }
  if (state.index >= state.segments.length) return completion(true, true);
  const token = ++state.speechToken, item = state.segments[state.index];
  highlight(state.index); setSegmentProgress(state.index);
  if (ttsStatus) ttsStatus.textContent =
    `पाठ-खंड ${state.index + 1} / ${state.segments.length} पढ़ा जा रहा है।`;
  const utterance = makeUtterance(item.text);
  utterance.onend = () => {
    if (token !== state.speechToken || !state.playing) return;
    state.index++; setSegmentProgress(state.index);
    if (state.index >= state.segments.length) {
      completion(true, true);
      if (ttsStatus) ttsStatus.textContent = 'अंतिम TTS segment पूर्ण हुआ।';
    } else speakNext();
  };
  utterance.onerror = event => {
    if (token !== state.speechToken) return;
    state.playing = false; video?.pause();
    if (ttsStatus) ttsStatus.textContent = `TTS त्रुटि: ${event.error || 'अज्ञात त्रुटि'}`;
    msg('TTS segment पूरा नहीं हो सका।');
  };
  speechSynthesis.cancel(); speechSynthesis.speak(utterance);
}

async function play() {
  if (!state.dataReady) return msg('Canonical पाठ अभी उपलब्ध नहीं है।');
  if (!state.videoReady) return msg('पहले 9:16 वीडियो चुनें।');
  refreshVoice();
  if (!state.voice) return msg('महिला संस्कृत voice उपलब्ध नहीं है।');
  if (state.textDone && state.ttsDone) stop();
  resetGate(); state.playing = true;
  if (speechSynthesis.paused) speechSynthesis.resume();
  try { await video.play(); }
  catch (error) {
    state.playing = false; return msg('वीडियो playback प्रारंभ नहीं हो सका।');
  }
  if (!speechSynthesis.speaking) speakNext(); else msg('वाचन पुनः जारी है।');
  vmsg('वीडियो और संस्कृत वाचन चल रहा है।');
}

function pause() {
  if (!state.playing && video?.paused && !speechSynthesis.speaking)
    return msg('वाचन पहले से रुका हुआ है।');
  state.playing = false; video?.pause(); speechSynthesis.pause();
  if (ttsStatus) ttsStatus.textContent = 'TTS रोका गया।';
  vmsg('वीडियो और TTS रोके गए हैं।'); msg('वाचन रोका गया।');
}

function stop() {
  state.playing = false; state.speechToken++; speechSynthesis.cancel(); video?.pause();
  if (video) video.currentTime = 0;
  state.index = 0; completion(false, false); resetGate(); clearActive();
  if (current) current.textContent = ''; progress(0);
  if (ttsStatus) ttsStatus.textContent = 'वाचन प्रारंभ नहीं हुआ है।';
  vmsg(state.videoReady ? 'वीडियो तैयार है।' : 'वीडियो अपलोड करें।');
}

function replay() {
  if (!state.playing || state.textDone && state.ttsDone || !state.videoReady) return;
  video.currentTime = 0;
  video.play().catch(() => msg('वीडियो loop प्रारंभ नहीं हो सका।'));
}

function clearVideo() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = ''; state.videoReady = false;
  if (video) { video.removeAttribute('src'); video.load(); video.loop = false; }
}

function validRatio() {
  if (!video.videoWidth || !video.videoHeight) return false;
  return Math.abs(video.videoWidth / video.videoHeight - 9 / 16) <= .03;
}

function metadataLoaded(file) {
  if (!validRatio()) {
    clearVideo(); if (upload) upload.value = ''; if (placeholder) placeholder.hidden = false;
    umsg('अस्वीकृत: वीडियो का aspect ratio 9:16 होना चाहिए।');
    vmsg('कृपया 9:16 वीडियो चुनें।'); return msg('वीडियो validation विफल हुई।');
  }
  state.videoReady = true; if (placeholder) placeholder.hidden = true;
  umsg(`चयनित: ${file.name}`); vmsg('9:16 वीडियो तैयार है.'); msg('वीडियो सफलतापूर्वक लोड हुआ।');
}

function selectVideo(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!fileAllowed(file)) return umsg('कृपया मान्य video file चुनें।');
  stop(); clearVideo(); state.objectUrl = URL.createObjectURL(file);
  video.src = state.objectUrl; video.loop = false; video.preload = 'metadata';
  video.onloadedmetadata = () => metadataLoaded(file); video.load();
}

function preview() {
  if (!state.videoReady) return msg('पहले वीडियो चुनें।');
  if (video.paused) {
    video.play().then(() => vmsg('वीडियो Preview चल रहा है।'))
      .catch(() => msg('Preview प्रारंभ नहीं हो सका।'));
  } else { video.pause(); vmsg('वीडियो Preview रोका गया।'); }
}

function removeVideo() {
  stop(); clearVideo(); if (upload) upload.value = '';
  if (placeholder) placeholder.hidden = false; umsg('कोई वीडियो चयनित नहीं है।');
  vmsg('वीडियो हटाया गया।'); msg('वीडियो सफलतापूर्वक हटाया गया।');
}

function saveSettings() {
  localStorage.setItem('lalitaTtsRate', String(clamp(rate?.value)));
  updateRate(); msg('TTS वाचन गति सुरक्षित कर दी गई।');
}

function loadSettings() {
  const saved = localStorage.getItem('lalitaTtsRate');
  if (rate) rate.value = clamp(saved || rate.value || .9);
  updateRate();
}

function resetApp() {
  stop(); localStorage.removeItem('lalitaTtsRate');
  if (rate) rate.value = '.9'; updateRate(); msg('App settings reset कर दी गईं।');
}

function bindEvents() {
  playBtn?.addEventListener('click', play); pauseBtn?.addEventListener('click', pause);
  stopBtn?.addEventListener('click', stop); previewBtn?.addEventListener('click', preview);
  removeBtn?.addEventListener('click', removeVideo); saveBtn?.addEventListener('click', saveSettings);
  resetBtn?.addEventListener('click', resetApp); upload?.addEventListener('change', selectVideo);
  rate?.addEventListener('input', updateRate); video?.addEventListener('ended', replay);
  speechSynthesis?.addEventListener('voiceschanged', refreshVoice);
}

function browserCheck() {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; if (supported) return true;
  if (voiceStatus) voiceStatus.textContent = 'इस Browser में Speech Synthesis उपलब्ध नहीं है।';
  if (ttsStatus) ttsStatus.textContent = 'TTS उपलब्ध नहीं है; वाचन प्रारंभ नहीं होगा।';
  msg('आवश्यक Sanskrit TTS सुविधा इस Browser में उपलब्ध नहीं है।'); return false;
}
function fileAllowed(file) {
  return !!file && file.type.startsWith('video/');
}
function cleanup() {
  speechSynthesis.cancel();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
}
window.addEventListener('beforeunload', cleanup);

async function init() {
  if (!browserCheck()) return;
  loadSettings(); bindEvents(); refreshVoice(); completion(false, false); progress(0);
  try {
    await loadText();
    msg(state.voice ? 'App पूर्णतः तैयार है।' : 'पाठ तैयार है; महिला संस्कृत voice उपलब्ध नहीं है।');
  } catch (error) {
    state.dataReady = false; msg(`Canonical पाठ लोड नहीं हुआ: ${error.message}`);
    if (ttsStatus) ttsStatus.textContent = 'पाठ उपलब्ध न होने से TTS प्रारंभ नहीं होगा।';
  }
}

init();
