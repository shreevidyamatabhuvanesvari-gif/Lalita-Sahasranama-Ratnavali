/*
 * app.js — श्रीललितासहस्रनाम स्तोत्र रत्नावली
 *
 * Design goals:
 *   - Current index.html selectors remain authoritative.
 *   - No new HTML controls are invented here.
 *   - Current Play / Pause / Stop controls remain the only playback controls.
 *   - Female Sanskrit TTS is mandatory; no male fallback.
 *   - SpeechSynthesis native state has priority during Resume.
 *   - speechSynthesis.cancel() is used only at lifecycle boundaries,
 *     never between ordinary TTS segments.
 *   - textDone and ttsDone remain independent.
 *   - Video "ended" is only a loop event during active playback;
 *     it is never a completion condition.
 *   - Preview remains independent from reading playback.
 *   - Content changes should normally require only the JSON file.
 */

'use strict';


/* =========================================================
   DOM REFERENCES
   ========================================================= */

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


/* =========================================================
   CANONICAL DATA SOURCE
   ========================================================= */

const source =
  app?.dataset.source ||
  'data/lalita-sahasranama-ratnavali.json';


/* =========================================================
   PLAYBACK STATES
   ========================================================= */

const PLAYBACK_STATES = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  COMPLETED: 'completed'
});


/* =========================================================
   APPLICATION STATE
   ========================================================= */

const state = {

  /* -------------------------
     Canonical text
     ------------------------- */

  segments: [],

  /*
   * Current segment used by TTS.
   * It always points to the segment that
   * should be spoken next.
   */
  index: 0,

  /*
   * Current text traversal position.
   */
  textIndex: -1,

  /*
   * Number of TTS segments that have
   * completed successfully.
   */
  ttsCompleted: 0,


  /* -------------------------
     Playback state
     ------------------------- */

  playbackState:
    PLAYBACK_STATES.IDLE,


  /* -------------------------
     Independent completion
     ------------------------- */

  textDone: false,
  ttsDone: false,


  /* -------------------------
     Voice
     ------------------------- */

  voice: null,


  /* -------------------------
     Video object URL
     ------------------------- */

  objectUrl: '',


  /* -------------------------
     Readiness
     ------------------------- */

  videoReady: false,
  dataReady: false,


  /* -------------------------
     Speech race protection
     ------------------------- */

  /*
   * Any utterance callback whose token
   * is not equal to the current token
   * is ignored.
   */
  speechToken: 0,

  speechActive: false,


  /* -------------------------
     Preview isolation
     ------------------------- */

  previewing: false,


  /* -------------------------
     Initialization guard
     ------------------------- */

  initialized: false
};


/* =========================================================
   MESSAGE HELPERS
   ========================================================= */

const msg = text => {
  if (system) {
    system.textContent = text;
  }
};


const vmsg = text => {
  if (videoStatus) {
    videoStatus.textContent = text;
  }
};


const umsg = text => {
  if (uploadStatus) {
    uploadStatus.textContent = text;
  }
};


const speech = () =>
  window.speechSynthesis;


/* =========================================================
   TTS RATE
   ========================================================= */

const clampRate = value =>
  Math.max(
    0.6,
    Math.min(
      1.2,
      Number(value) || 0.9
    )
  );


/* =========================================================
   PLAYBACK STATE
   ========================================================= */

function setPlaybackState(nextState) {

  state.playbackState =
    nextState;

  updateControlState();
}


function updateControlState() {

  /*
   * Play is unavailable while:
   *   - data is missing
   *   - video is missing
   *   - playback is already active
   *   - Preview is active
   */
  if (playBtn) {

    playBtn.disabled =
      !state.dataReady ||
      !state.videoReady ||
      state.previewing ||
      state.playbackState ===
        PLAYBACK_STATES.PLAYING;
  }


  /*
   * Pause is meaningful only
   * during active reading.
   */
  if (pauseBtn) {

    pauseBtn.disabled =
      state.playbackState !==
        PLAYBACK_STATES.PLAYING;
  }


  /*
   * Stop remains available when
   * there is something to reset.
   */
  if (stopBtn) {

    stopBtn.disabled =
      !state.dataReady &&
      !state.videoReady &&
      state.playbackState ===
        PLAYBACK_STATES.IDLE &&
      !state.previewing;
  }


  /*
   * Preview is available only in
   * an independent IDLE state.
   */
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
   TTS RATE UI
   ========================================================= */

function updateRate() {

  if (
    !rate ||
    !rateValue
  ) {
    return;
  }

  rate.value =
    String(
      clampRate(rate.value)
    );

  rateValue.textContent =
    Number(rate.value)
      .toFixed(2);
}


/* =========================================================
   PROGRESS
   ========================================================= */

function setTextProgress(percent) {

  const p =
    Math.max(
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
    textPct.value =
      `${p}%`;
  }
}


function setTtsProgress(percent) {

  const p =
    Math.max(
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
    ttsPct.value =
      `${p}%`;
  }
}


function resetProgress() {

  setTextProgress(0);

  setTtsProgress(0);
}


/* =========================================================
   COMPLETION STATE
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
      String(
        state.textDone
      );
  }


  if (ttsDoneEl) {

    ttsDoneEl.textContent =
      state.ttsDone
        ? 'TTS: पूर्ण'
        : 'TTS: अपूर्ण';

    ttsDoneEl.dataset.complete =
      String(
        state.ttsDone
      );
  }


  /*
   * Final completion is allowed
   * only when BOTH independent
   * completion conditions are true.
   */
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
   FINAL COMPLETION
   ========================================================= */

function finish() {

  /*
   * Safety gate.
   */
  if (
    !state.textDone ||
    !state.ttsDone
  ) {
    return false;
  }


  state.speechActive =
    false;

  state.index =
    state.segments.length;

  state.previewing =
    false;


  /*
   * Completion is the one place where
   * the active video is explicitly stopped.
   *
   * video ended itself never means
   * completion.
   */
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
   TEXT RENDERING
   ========================================================= */

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


  textBox.append(fragment);
}


/* =========================================================
   CANONICAL JSON NORMALIZATION
   ========================================================= */

function normalize(
  item,
  index
) {

  /*
   * Simple string entry.
   */
  if (
    typeof item ===
    'string'
  ) {

    const text =
      item.trim();


    return text
      ? {
          id: index + 1,
          text
        }
      : null;
  }


  /*
   * Invalid entry.
   */
  if (
    !item ||
    typeof item !==
      'object'
  ) {

    return null;
  }


  /*
   * Compatible with common
   * canonical entry forms.
   */
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

  /*
   * Supported top-level forms:
   *
   * [
   *   "..."
   * ]
   *
   * {
   *   "segments": [...]
   * }
   *
   * {
   *   "names": [...]
   * }
   *
   * {
   *   "entries": [...]
   * }
   *
   * {
   *   "ratnavali": [...]
   * }
   *
   * {
   *   "text": [...]
   * }
   */
  const list =
    Array.isArray(data)

      ? data

      : data?.segments ??
        data?.names ??
        data?.entries ??
        data?.ratnavali ??
        data?.text ??
        [];


  if (
    !Array.isArray(list)
  ) {

    throw Error(
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

    throw Error(
      `JSON HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  state.segments =
    extract(data);


  if (
    !state.segments.length
  ) {

    throw Error(
      'पाठ-खंड उपलब्ध नहीं हैं।'
    );
  }


  renderText();


  state.dataReady =
    true;


  state.index =
    0;


  state.textIndex =
    -1;


  state.ttsCompleted =
    0;


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
   FEMALE SANSKRIT VOICE DETECTION
   ========================================================= */

function femaleSanskrit(
  voice
) {

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


  /*
   * Sanskrit requirement is strict.
   */
  const isSanskrit =
    lang === 'sa' ||

    lang.startsWith(
      'sa-'
    ) ||

    /sanskrit|संस्कृत|vedic|वेद/i.test(
      descriptor
    );


  /*
   * Web Speech API does not standardize
   * gender metadata. Therefore only explicit
   * female indicators are accepted.
   *
   * No male fallback.
   */
  const isFemale =
    /female|woman|girl|lady|स्त्री|महिला|nari/i.test(
      descriptor
    );


  return (
    isSanskrit &&
    isFemale
  );
}


/* =========================================================
   REFRESH VOICE
   ========================================================= */

function refreshVoice() {

  const synth =
    speech();


  if (!synth) {
    return;
  }


  state.voice =
    synth
      .getVoices()
      .find(
        femaleSanskrit
      ) ||
    null;


  if (voiceStatus) {

    voiceStatus.textContent =
      state.voice

        ? `महिला संस्कृत voice: ${state.voice.name}`

        : 'महिला संस्कृत voice उपलब्ध नहीं है; male fallback नहीं होगा।';
  }
}


/* =========================================================
   REDUCED MOTION
   ========================================================= */

function reducedMotion() {

  return Boolean(
    window
      .matchMedia?.(
        '(prefers-reduced-motion: reduce)'
      )
      .matches
  );
}


/* =========================================================
   TEXT HIGHLIGHT
   ========================================================= */

function highlight(
  index
) {

  clearActive();


  const node =
    $(`seg-${index}`);


  const segment =
    state.segments[
      index
    ];


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

    current.textContent =
      segment.text;
  }
}


/* =========================================================
   TEXT TRAVERSAL
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


  /*
   * Text progress is tied to
   * canonical traversal.
   */
  setTextProgress(
    (
      (state.textIndex + 1) *
      100
    ) /
      state.segments.length
  );


  /*
   * textDone becomes true as soon as
   * the final text segment is reached.
   *
   * It does NOT wait for final TTS end.
   */
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
   TTS PROGRESS
   ========================================================= */

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


  /*
   * Only fully completed TTS segments
   * contribute to TTS progress.
   */
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


  /*
   * Sanskrit language request.
   */
  utterance.lang =
    'sa-IN';


  utterance.rate =
    clampRate(
      rate?.value
    );


  utterance.pitch =
    1;


  utterance.volume =
    1;


  utterance.voice =
    state.voice;


  /* -------------------------
     Utterance start
     ------------------------- */

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
          `पाठ-खंड ${state.index + 1} / ${state.segments.length} पढ़ा जा रहा है।`;
      }
    };


  /* -------------------------
     Utterance end
     ------------------------- */

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


      /*
       * Current segment has now
       * been completely spoken.
       */
      state.ttsCompleted =
        Math.min(
          state.index + 1,
          state.segments.length
        );


      updateTtsProgress(
        state.ttsCompleted
      );


      /*
       * Final TTS segment.
       *
       * ttsDone is set here,
       * not when the final text
       * segment merely becomes active.
       */
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


      /*
       * Advance to next segment.
       *
       * IMPORTANT:
       * speechSynthesis.cancel()
       * is NOT called here.
       */
      state.index += 1;


      if (
        state.playbackState ===
        PLAYBACK_STATES.PLAYING
      ) {

        speakCurrentSegment();
      }
    };


  /* -------------------------
     Utterance error
     ------------------------- */

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


      /*
       * TTS error means the synchronized
       * reading session must stop safely.
       */
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


  /*
   * Strict voice requirement.
   *
   * No male fallback.
   */
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


  /*
   * Safety if all segments are consumed.
   */
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


  /*
   * Every active utterance receives a
   * new token so stale callbacks can never
   * mutate the current playback session.
   */
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


  /*
   * Normal segment chaining uses speak()
   * directly without cancel().
   */
  synth.speak(
    utterance
  );


  return true;
}


/* =========================================================
   START FRESH PLAYBACK SESSION
   ========================================================= */

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


  /*
   * New playback session is a valid
   * lifecycle cancellation point.
   *
   * This is NOT normal segment chaining.
   */
  synth.cancel();


  state.speechToken += 1;

  state.speechActive =
    false;


  state.previewing =
    false;


  state.index =
    0;


  state.textIndex =
    -1;


  state.ttsCompleted =
    0;


  resetCompletionState();

  resetProgress();

  clearActive();


  if (current) {
    current.textContent = '';
  }


  /*
   * Fresh playback always begins
   * at the beginning of the video.
   */
  if (video) {
    video.currentTime =
      0;
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
   RESUME PLAYBACK
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
   * Native SpeechSynthesis state first.
   *
   * 1. paused -> resume()
   * 2. speaking -> do NOT create a new utterance
   * 3. both false -> start current segment
   */
  if (
    synth.paused
  ) {

    synth.resume();

  } else if (
    !synth.speaking
  ) {

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


  /*
   * Preview cannot be promoted into
   * a reading session.
   */
  if (state.previewing) {
    return;
  }


  if (
    state.playbackState ===
    PLAYBACK_STATES.PLAYING
  ) {

    return;
  }


  /*
   * PAUSED always means Resume.
   */
  if (
    state.playbackState ===
    PLAYBACK_STATES.PAUSED
  ) {

    await resumePlayback();

    return;
  }


  /*
   * IDLE and COMPLETED both start
   * a clean playback session.
   */
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


  /*
   * Pause both synchronized media layers.
   *
   * No cancel().
   */
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
   STOP / RESET PLAYBACK
   ========================================================= */

function stop(
  options = {}
) {

  const silent =
    Boolean(
      options.silent
    );


  const synth =
    speech();


  /*
   * Lifecycle cancellation.
   *
   * Token is incremented BEFORE cancel()
   * so stale callbacks become harmless.
   */
  state.speechToken += 1;


  state.speechActive =
    false;


  state.previewing =
    false;


  synth?.cancel();


  video?.pause();


  if (video) {
    video.currentTime =
      0;
  }


  state.index =
    0;


  state.textIndex =
    -1;


  state.ttsCompleted =
    0;


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
   VIDEO ENDED HANDLER
   ========================================================= */

async function handleVideoEnded() {

  /*
   * Preview has its own lifecycle.
   * It is not part of reading completion.
   */
  if (state.previewing) {

    state.previewing =
      false;


    updateControlState();


    vmsg(
      'वीडियो Preview पूर्ण हुआ।'
    );


    return;
  }


  /*
   * During active reading, video ending
   * means only replay.
   *
   * It never means completion.
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


  video.currentTime =
    0;


  try {

    await video.play();

  } catch (error) {

    /*
     * A video replay failure interrupts
     * synchronized reading safely.
     */
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


/* =========================================================
   VIDEO VALIDATION
   ========================================================= */

function validRatio() {

  if (
    !video?.videoWidth ||
    !video?.videoHeight
  ) {

    return false;
  }


  /*
   * Tolerance is deliberately small,
   * while allowing normal metadata rounding.
   */
  return (
    Math.abs(
      video.videoWidth /
        video.videoHeight -
        9 / 16
    ) <=
    0.03
  );
}


/* =========================================================
   FILE TYPE VALIDATION
   ========================================================= */

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


/* =========================================================
   CLEAR VIDEO
   ========================================================= */

function clearVideo() {

  if (state.objectUrl) {

    URL.revokeObjectURL(
      state.objectUrl
    );
  }


  state.objectUrl =
    '';

  state.videoReady =
    false;

  state.previewing =
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


/* =========================================================
   VIDEO METADATA VALIDATION
   ========================================================= */

function metadataLoaded(
  file
) {

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


/* =========================================================
   SELECT VIDEO
   ========================================================= */

function selectVideo(
  event
) {

  const file =
    event.target.files?.[0];


  if (!file) {
    return;
  }


  if (
    !fileAllowed(file)
  ) {

    umsg(
      'कृपया मान्य video file चुनें।'
    );


    event.target.value =
      '';


    return;
  }


  /*
   * A new video starts a new
   * playback lifecycle.
   */
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
    () =>
      metadataLoaded(file);


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


  /*
   * Preview is available only when
   * the main reading session is idle.
   */
  if (
    state.playbackState !==
      PLAYBACK_STATES.IDLE
  ) {

    msg(
      'Preview केवल स्वतंत्र IDLE स्थिति में उपलब्ध है।'
    );


    return;
  }


  /*
   * Toggle independent preview.
   */
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
   SAFE STORAGE HELPERS
   ========================================================= */

function safeStorageGet(
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


function safeStorageRemove(
  key
) {

  try {

    localStorage.removeItem(
      key
    );

  } catch (error) {

    /*
     * Storage unavailable.
     * Application can continue normally.
     */
  }
}


/* =========================================================
   SAVE SETTINGS
   ========================================================= */

function saveSettings() {

  safeStorageSet(
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


/* =========================================================
   LOAD SETTINGS
   ========================================================= */

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
          0.9
        )
      );
  }


  updateRate();
}


/* =========================================================
   RESET APPLICATION SETTINGS
   ========================================================= */

function resetApp() {

  stop({
    silent: true
  });


  safeStorageRemove(
    'lalitaTtsRate'
  );


  if (rate) {
    rate.value =
      '0.9';
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
    () =>
      stop()
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


  /*
   * Video ended:
   *   - Preview -> preview ends
   *   - Playback -> video loops
   *   - Completion -> already handled by gate
   */
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

  /*
   * Lifecycle termination.
   */
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


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function init() {

  /*
   * Prevent duplicate initialization.
   */
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


/* =========================================================
   START
   ========================================================= */

init();
