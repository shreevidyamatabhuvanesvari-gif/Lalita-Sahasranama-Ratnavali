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
  voiceIsExplicitMale: false,
  objectUrl: '',
  videoReady: false,
  dataReady: false,
  ttsSupported: false,
  speechToken: 0,
  speechActive: false,
  previewing: false
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

  if (!Number.isFinite(numeric)) {
    return 0.9;
  }

  return Math.max(0.6, Math.min(1.2, numeric));
};

function setPlaybackState(nextState) {
  state.playbackState = nextState;
  updateControlState();
}

function updateControlState() {
  const playing =
    state.playbackState === PLAYBACK_STATES.PLAYING;

  const paused =
    state.playbackState === PLAYBACK_STATES.PAUSED;

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
      !paused &&
      !playing;
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

  if (contentMode) {
    contentMode.disabled =
      playing ||
      paused ||
      state.previewing;
  }

  if (removeBtn) {
    removeBtn.disabled =
      !state.videoReady &&
      !state.previewing;
  }
}

function updateRate() {
  if (!rate || !rateValue) {
    return;
  }

  const safe = clampRate(rate.value);

  rate.value = String(safe);
  rateValue.textContent = safe.toFixed(2);
}

function setProgress(
  bar,
  output,
  percent
) {
  const numeric = Number(percent);

  const safe =
    Number.isFinite(numeric)
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(numeric)
          )
        )
      : 0;

  if (bar) {
    bar.value = safe;
  }

  if (output) {
    output.textContent =
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

function setCompletionState(
  type,
  value
) {
  const bool = Boolean(value);

  if (type === 'text') {
    state.textDone = bool;
  }

  if (type === 'tts') {
    state.ttsDone = bool;
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
    finishPlayback();
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

function finishPlayback() {
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
    setMultilineText(
      current,
      state.segments[
        state.segments.length - 1
      ].text
    );
  }

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

  return true;
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

function appendTextWithLineBreaks(
  container,
  text
) {
  const parts =
    String(text).split('\n');

  parts.forEach(
    (part, index) => {
      if (index > 0) {
        container.append(
          document.createElement('br')
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

function setMultilineText(
  container,
  text
) {
  if (!container) {
    return;
  }

  container.replaceChildren();

  appendTextWithLineBreaks(
    container,
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

      appendTextWithLineBreaks(
        node,
        segment.text
      );

      fragment.append(
        node,
        document.createTextNode(' ')
      );
    }
  );

  textBox.append(
    fragment
  );
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
            `segment-${fallbackIndex + 1}`,
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

  const number =
    Number(item.number);

  return {
    id:
      item.id ??
      `segment-${fallbackIndex + 1}`,

    number:
      Number.isInteger(number)
        ? number
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
    const number =
      Number(
        items[i]?.number
      );

    if (number !== i + 1) {
      throw new Error(
        `${label} numbering त्रुटि: स्थान ${
          i + 1
        } पर ${
          number || 'अज्ञात'
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

function buildModeSegments(
  mode
) {
  const data =
    state.sourceData;

  if (!data) {
    throw new Error(
      'Canonical data अभी उपलब्ध नहीं है।'
    );
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

function describeCurrentMode() {
  return state.mode ===
    CONTENT_MODES.NAMAVALI
    ? 'श्रीललितासहस्रनामावली — 1000 नाम'
    : 'श्रीललितासहस्रनामस्तोत्रम् — 182 श्लोक + समापन';
}

function applyMode(
  mode,
  options = {}
) {
  const silent =
    Boolean(options.silent);

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
    return false;
  }

  if (
    state.playbackState ===
      PLAYBACK_STATES.PLAYING ||
    state.playbackState ===
      PLAYBACK_STATES.PAUSED ||
    state.previewing
  ) {
    stop({
      silent: true
    });
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

  renderText();
  clearActive();
  resetCompletionState();
  resetProgress();

  setPlaybackState(
    PLAYBACK_STATES.IDLE
  );

  if (current) {
    current.replaceChildren();
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'वाचन के लिए तैयार।';
  }

  if (contentModeStatus) {
    contentModeStatus.textContent =
      describeCurrentMode();
  }

  if (!silent) {
    msg(
      `${describeCurrentMode()} तैयार है।`
    );
  }

  return true;
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

  let data;

  try {
    data =
      await response.json();
  } catch (error) {
    throw new Error(
      'Canonical JSON पढ़ा नहीं जा सका।'
    );
  }

  state.sourceData =
    validateCanonicalData(
      data
    );

  state.dataReady = true;

  applyMode(
    CONTENT_MODES.STOTRA,
    {
      silent: true
    }
  );

  msg(
    'Canonical data सत्यापित: 182 श्लोक और 1000 नाम उपलब्ध हैं।'
  );
}


/* ============================== TTS VOICE ============================== */

function descriptorOf(voice) {
  if (!voice) {
    return '';
  }

  return [
    voice.name,
    voice.voiceURI,
    voice.lang
  ]
    .map(
      value =>
        String(
          value || ''
        )
    )
    .join(' ')
    .trim();
}

function explicitlyFemale(
  voice
) {
  return /female|woman|girl|lady|feminine|स्त्री|महिला|नारी|मादा/i.test(
    descriptorOf(voice)
  );
}

function explicitlyMale(
  voice
) {
  return /male|man|boy|gentleman|masculine|पुरुष|नर/i.test(
    descriptorOf(voice)
  );
}

function knownGoogleHindiMale(
  voice
) {
  return /hi-IN-(?:Neural2-[BC]|Standard-[BCF]|Wavenet-[BCF]|Chirp3-HD-(?:Achird|Algenib|Algieba|Alnilam|Charon|Enceladus|Fenrir|Iapetus|Orus|Puck|Rasalgethi|Sadachbia))/i.test(
    descriptorOf(voice)
  );
}

function isSanskritVoice(
  voice
) {
  if (!voice) {
    return false;
  }

  const lang =
    String(
      voice.lang || ''
    ).toLowerCase();

  const descriptor =
    descriptorOf(voice);

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
  if (!voice) {
    return false;
  }

  const lang =
    String(
      voice.lang || ''
    ).toLowerCase();

  return (
    lang === 'hi' ||
    lang.startsWith('hi-')
  );
}

function isIndianLanguageVoice(
  voice
) {
  if (!voice) {
    return false;
  }

  const lang =
    String(
      voice.lang || ''
    ).toLowerCase();

  return /^(hi|sa|mr|bn|gu|kn|ml|pa|ta|te|ur)(-|$)/i.test(
    lang
  );
}

function voiceScore(
  voice
) {
  /*
   * Explicit female voice को बिल्कुल न चुनें।
   */
  if (
    !voice ||
    explicitlyFemale(voice)
  ) {
    return -Infinity;
  }

  const maleSignal =
    explicitlyMale(voice) ||
    knownGoogleHindiMale(
      voice
    );

  let score = 0;

  /*
   * पुरुष signal सबसे अधिक priority।
   */
  if (maleSignal) {
    score += 1000;
  }

  /*
   * Sanskrit preference।
   */
  if (
    isSanskritVoice(
      voice
    )
  ) {
    score += 500;
  }

  /*
   * Hindi preference।
   * इससे Sanskrit Devanagari भी भारतीय voice में बोली जा सकती है।
   */
  if (
    isHindiVoice(
      voice
    )
  ) {
    score += 450;
  }

  /*
   * अन्य भारतीय languages को भी English voices से ऊपर रखें।
   */
  if (
    isIndianLanguageVoice(
      voice
    )
  ) {
    score += 300;
  }

  /*
   * Default browser voice को हल्की अतिरिक्त प्राथमिकता।
   */
  if (voice.default) {
    score += 20;
  }

  return score;
}

function selectVoice() {
  const synth =
    speech();

  if (!synth) {
    state.voice = null;
    state.voiceIsExplicitMale =
      false;

    return null;
  }

  const voices =
    synth.getVoices();

  if (!voices.length) {
    state.voice = null;
    state.voiceIsExplicitMale =
      false;

    return null;
  }

  const ranked =
    voices
      .map(
        (voice, index) => ({
          voice,
          index,
          score:
            voiceScore(
              voice
            )
        })
      )
      .filter(
        item =>
          Number.isFinite(
            item.score
          )
      )
      .sort(
        (a, b) => {
          if (
            b.score !==
            a.score
          ) {
            return (
              b.score -
              a.score
            );
          }

          if (
            Boolean(
              b.voice.default
            ) !==
            Boolean(
              a.voice.default
            )
          ) {
            return b.voice.default
              ? 1
              : -1;
          }

          return (
            a.index -
            b.index
          );
        }
      );

  state.voice =
    ranked[0]?.voice ||
    null;

  state.voiceIsExplicitMale =
    Boolean(
      state.voice &&
      (
        explicitlyMale(
          state.voice
        ) ||
        knownGoogleHindiMale(
          state.voice
        )
      )
    );

  return state.voice;
}

function refreshVoice() {
  const synth =
    speech();

  if (!synth) {
    state.voice = null;
    return false;
  }

  const selected =
    selectVoice();

  if (voiceStatus) {
    if (!selected) {
      voiceStatus.textContent =
        'उपयोग योग्य पुरुष voice उपलब्ध नहीं है; महिला voice नहीं चुनी जाएगी।';
    } else if (
      state.voiceIsExplicitMale
    ) {
      voiceStatus.textContent =
        `पुरुष voice चयनित: ${selected.name} (${selected.lang})`;
    } else {
      voiceStatus.textContent =
        `उपलब्ध non-female भारतीय voice: ${selected.name} (${selected.lang})`;
    }
  }

  updateControlState();

  return Boolean(
    selected
  );
}

function selectVoiceImmediately() {
  /*
   * जानबूझकर synchronous।
   *
   * Mobile browser में Play button का user gesture बहुत देर तक
   * सुरक्षित नहीं रहता। इसलिए यहाँ कोई await / timer नहीं है।
   */
  return refreshVoice();
}


/* ============================== TEXT ============================== */

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

  if (
    !node ||
    !segment
  ) {
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

    block:
      'center'
  });

  if (current) {
    setMultilineText(
      current,
      segment.text
    );
  }
}

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

  setProgress(
    textBar,
    textPct,
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
  if (
    !state.segments.length
  ) {
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

  setProgress(
    ttsBar,
    ttsPct,
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


/* ============================== TTS ============================== */

function setTtsFailure(
  errorCode
) {
  state.speechActive =
    false;

  video?.pause();

  setPlaybackState(
    PLAYBACK_STATES.PAUSED
  );

  const detail =
    errorCode
      ? `: ${errorCode}`
      : '';

  if (ttsStatus) {
    ttsStatus.textContent =
      `TTS त्रुटि${detail}`;
  }

  vmsg(
    'TTS त्रुटि के कारण वाचन paused है।'
  );

  msg(
    'TTS segment पूरा नहीं हो सका। Resume से पुनः प्रयास करें।'
  );
}

function makeUtterance(
  text,
  token
) {
  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  /*
   * चयनित voice की वास्तविक language।
   * Sanskrit voice न होने पर Hindi voice Devanagari को संभाल सकती है।
   */
  utterance.lang =
    state.voice?.lang ||
    'hi-IN';

  utterance.rate =
    clampRate(
      rate?.value
    );

  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.voice =
    state.voice ||
    null;

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
        `${describeCurrentMode()} — segment ${
          state.index + 1
        } / ${
          state.segments.length
        } पढ़ा जा रहा है।`;
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
      /*
       * यहाँ cancel() नहीं करना है।
       * यही अगले segment की natural chain है।
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

      setTtsFailure(
        event?.error ||
        'अज्ञात त्रुटि'
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
    selectVoiceImmediately();
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
        'किसी उपयोग योग्य voice के बिना TTS प्रारंभ नहीं किया गया।';
    }

    msg(
      'Browser ने कोई उपयोग योग्य voice उपलब्ध नहीं की।'
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

  try {
    /*
     * Android/Chrome में paused queue को release करने के लिए।
     */
    synth.resume();

    /*
     * speak() तुरंत उसी execution turn में।
     */
    synth.speak(
      utterance
    );

    return true;
  } catch (error) {
    if (
      token ===
      state.speechToken
    ) {
      setTtsFailure(
        error?.message ||
        'speak() विफल'
      );
    }

    return false;
  }
}

function startFreshPlayback() {
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
   * Play button के उसी user-gesture turn में voice चुनें।
   * यहाँ await बिल्कुल नहीं है।
   */
  selectVoiceImmediately();

  if (!state.voice) {
    if (ttsStatus) {
      ttsStatus.textContent =
        'उपयोग योग्य पुरुष/non-female voice उपलब्ध नहीं है।';
    }

    msg(
      'Browser में उपयोग योग्य पुरुष voice उपलब्ध नहीं है।'
    );

    return false;
  }

  /*
   * नई session में पुरानी speech queue हटाना उचित है।
   */
  synth.cancel();

  state.speechToken += 1;
  state.speechActive =
    false;

  state.previewing =
    false;

  state.index = 0;
  state.textIndex = -1;
  state.ttsCompleted = 0;

  resetCompletionState();
  resetProgress();
  clearActive();

  if (current) {
    current.replaceChildren();
  }

  if (video) {
    video.currentTime = 0;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  let videoStarted =
    true;

  /*
   * video.play() और speech.speak() दोनों इसी user gesture में invoke हों।
   * Promise को await नहीं किया गया है।
   */
  if (video) {
    try {
      const playPromise =
        video.play();

      if (
        playPromise &&
        typeof playPromise.catch ===
          'function'
      ) {
        playPromise.catch(
          () => {
            videoStarted =
              false;

            video.pause();
          }
        );
      }
    } catch (error) {
      videoStarted =
        false;
    }
  }

  const started =
    speakCurrentSegment();

  if (!started) {
    video?.pause();
    return false;
  }

  vmsg(
    videoStarted
      ? 'वीडियो और पुरुष वाचन चल रहा है।'
      : 'पुरुष वाचन चल रहा है; वीडियो playback Browser ने रोका है।'
  );

  msg(
    'वाचन प्रारंभ हो गया।'
  );

  return true;
}

function resumePlayback() {
  const synth =
    speech();

  if (
    !synth ||
    state.playbackState !==
      PLAYBACK_STATES.PAUSED
  ) {
    return false;
  }

  selectVoiceImmediately();

  if (!state.voice) {
    msg(
      'उपयोग योग्य voice उपलब्ध नहीं है।'
    );

    return false;
  }

  setPlaybackState(
    PLAYBACK_STATES.PLAYING
  );

  try {
    if (synth.paused) {
      synth.resume();
    } else if (
      !synth.speaking
    ) {
      speakCurrentSegment();
    }
  } catch (error) {
    video?.pause();

    setPlaybackState(
      PLAYBACK_STATES.PAUSED
    );

    setTtsFailure(
      error?.message ||
      'resume() विफल'
    );

    return false;
  }

  if (video) {
    try {
      const playPromise =
        video.play();

      playPromise?.catch(
        () => {
          synth.pause();
          video.pause();

          setPlaybackState(
            PLAYBACK_STATES.PAUSED
          );
        }
      );
    } catch (error) {
      synth.pause();
      video.pause();

      setPlaybackState(
        PLAYBACK_STATES.PAUSED
      );
    }
  }

  vmsg(
    'वीडियो और TTS पुनः चल रहे हैं।'
  );

  msg(
    'वाचन पुनः जारी है।'
  );

  return true;
}

function play() {
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
    resumePlayback();
    return;
  }

  startFreshPlayback();
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
    'वाचन रोककर paused स्थिति में रखा गया है।'
  );
}

function stop(
  options = {}
) {
  const silent =
    Boolean(options.silent);

  const synth =
    speech();

  state.speechToken += 1;
  state.speechActive =
    false;

  state.previewing =
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
    current.replaceChildren();
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

    vmsg(
      'वीडियो loop जारी है; TTS अपने क्रम से चल रहा है।'
    );
  } catch (error) {
    state.speechToken += 1;
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


/* ============================== VIDEO ============================== */

function clearVideo() {
  if (state.objectUrl) {
    URL.revokeObjectURL(
      state.objectUrl
    );
  }

  state.objectUrl = '';
  state.videoReady =
    false;

  state.previewing =
    false;

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

function validRatio() {
  if (
    !video?.videoWidth ||
    !video?.videoHeight
  ) {
    return false;
  }

  return (
    video.videoWidth * 16 ===
    video.videoHeight * 9
  );
}

function metadataLoaded(
  file
) {
  const width =
    video?.videoWidth ||
    0;

  const height =
    video?.videoHeight ||
    0;

  if (!validRatio()) {
    clearVideo();

    if (upload) {
      upload.value = '';
    }

    umsg(
      `अस्वीकृत: ${file.name} का intrinsic आकार ${width}:${height} है; ठीक 9:16 आवश्यक है।`
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

function fileAllowed(
  file
) {
  return Boolean(
    file &&
    file.type.startsWith(
      'video/'
    )
  );
}

function selectVideo(
  event
) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  if (!fileAllowed(file)) {
    umsg(
      'कृपया मान्य video file चुनें।'
    );

    event.target.value =
      '';

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
    () => metadataLoaded(
      file
    );

  video.onerror =
    () => {
      clearVideo();

      if (upload) {
        upload.value = '';
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
    'वीडियो की exact 9:16 ratio जाँची जा रही है…'
  );
}

function preview() {
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

  state.previewing =
    true;

  updateControlState();

  video.currentTime =
    0;

  try {
    const playPromise =
      video.play();

    playPromise?.catch(
      () => {
        state.previewing =
          false;

        updateControlState();

        msg(
          'Preview प्रारंभ नहीं हो सका।'
        );
      }
    );

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
  stop({
    silent: true
  });

  clearVideo();

  if (upload) {
    upload.value = '';
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


/* ============================== SETTINGS ============================== */

function storageGet(
  key
) {
  try {
    return localStorage.getItem(
      key
    );
  } catch (error) {
    return null;
  }
}

function storageSet(
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
      'सेटिंग सुरक्षित नहीं की जा सकी। App सामान्य रूप से चलता रहेगा।'
    );
  }
}

function storageRemove(
  key
) {
  try {
    localStorage.removeItem(
      key
    );
  } catch (error) {
    /* Storage unavailable; application continues normally. */
  }
}

function saveSettings() {
  storageSet(
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
    storageGet(
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

  storageRemove(
    'lalitaTtsRate'
  );

  if (rate) {
    rate.value =
      '0.9';
  }

  updateRate();

  if (state.sourceData) {
    applyMode(
      CONTENT_MODES.STOTRA,
      {
        silent: true
      }
    );
  }

  msg(
    'App settings reset कर दी गईं।'
  );
}


/* ============================== EVENTS ============================== */

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

function hideTextUI() {
  const textSection =
    $('textSection');

  if (!textSection) {
    return;
  }

  textSection.hidden =
    true;

  textSection.setAttribute(
    'aria-hidden',
    'true'
  );
}

function browserCheck() {
  state.ttsSupported =
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  if (state.ttsSupported) {
    return true;
  }

  if (voiceStatus) {
    voiceStatus.textContent =
      'इस Browser में Speech Synthesis उपलब्ध नहीं है।';
  }

  if (ttsStatus) {
    ttsStatus.textContent =
      'TTS उपलब्ध नहीं है; पाठ फिर भी देखा जा सकता है।';
  }

  msg(
    'Browser में Speech Synthesis उपलब्ध नहीं है; TTS नियंत्रण निष्क्रिय रहेगा।'
  );

  updateControlState();

  return false;
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


/* ============================== INIT ============================== */

async function init() {
  if (state.initialized) {
    return;
  }

  state.initialized =
    true;

  browserCheck();
  hideTextUI();
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
    await loadCanonicalData();

    msg(
      state.ttsSupported
        ? state.voice
          ? 'App तैयार है। पुरुष/उपयोग योग्य voice चयनित है।'
          : 'पाठ तैयार है; voice अभी उपलब्ध नहीं है।'
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
