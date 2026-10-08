"use strict";

/* =====================================================================
   Gabor Patch 視覺訓練 - 主程式
   設計原則：
   - 一般螢幕（LCD/OLED）設計：刺激以短暫閃現＋淡入淡出（raised-cosine 時間
     包絡）呈現，答題在刺激消失後進行，較接近正式視覺心理物理實驗設計。
   - 色弱友善：所有正確/錯誤回饋皆用文字 + 符號，不依賴顏色。
   ===================================================================== */

/* ---------------------- 工具：畫面切換 ---------------------- */
const screens = {
  setup: document.getElementById("screen-setup"),
  cover: document.getElementById("screen-cover"),
  training: document.getElementById("screen-training"),
  summary: document.getElementById("screen-summary"),
  history: document.getElementById("screen-history"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

/* ---------------------- 設定狀態 ---------------------- */
const state = {
  eye: "alt", // right | left | alt | both
  axisRight: 0,
  axisLeft: 0,
  mode: "mixed", // astig | myopia | mixed
  difficulty: "auto", // easy | medium | hard | auto
  durationMin: 3,
  soundFeedback: false,
};

/* ---------------------- 散光軸度記憶（跨 session 記住上次輸入值）---------------------- */
const AXIS_SETTINGS_KEY = "gaborAxisSettings";

function loadAxisSettings() {
  try {
    return JSON.parse(localStorage.getItem(AXIS_SETTINGS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveAxisSettings() {
  localStorage.setItem(AXIS_SETTINGS_KEY, JSON.stringify({ axisRight: state.axisRight, axisLeft: state.axisLeft }));
}

// 頁面載入時套用上次輸入的軸度；若從未填過資料，預設為 0（無散光時軸度沒有意義）
(function restoreAxisSettings() {
  const saved = loadAxisSettings();
  state.axisRight = typeof saved.axisRight === "number" ? saved.axisRight : 0;
  state.axisLeft = typeof saved.axisLeft === "number" ? saved.axisLeft : 0;
  document.getElementById("axis-right").value = state.axisRight;
  document.getElementById("axis-left").value = state.axisLeft;
})();

/* ---------------------- 設定畫面互動 ---------------------- */
function setupOptionGroup(groupId, dataAttr, stateKey, parse) {
  const group = document.getElementById(groupId);
  group.querySelectorAll(".opt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll(".opt-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      const raw = btn.dataset[dataAttr];
      state[stateKey] = parse ? parse(raw) : raw;
      if (stateKey === "durationMin") {
        document.getElementById("duration-custom").value = state.durationMin;
        document.getElementById("duration-custom-val").textContent = state.durationMin;
      }
    });
  });
}

setupOptionGroup("eye-group", "eye", "eye");
setupOptionGroup("mode-group", "mode", "mode");
setupOptionGroup("difficulty-group", "diff", "difficulty");
setupOptionGroup("duration-group", "min", "durationMin", Number);

document.getElementById("axis-right").addEventListener("input", (e) => {
  state.axisRight = Number(e.target.value) || 0;
  saveAxisSettings();
});
document.getElementById("axis-left").addEventListener("input", (e) => {
  state.axisLeft = Number(e.target.value) || 0;
  saveAxisSettings();
});

const durationCustomSlider = document.getElementById("duration-custom");
durationCustomSlider.addEventListener("input", (e) => {
  state.durationMin = Number(e.target.value);
  document.getElementById("duration-custom-val").textContent = state.durationMin;
  document.getElementById("duration-group").querySelectorAll(".opt-btn").forEach((b) => b.classList.remove("selected"));
});

document.getElementById("sound-feedback").addEventListener("change", (e) => {
  state.soundFeedback = e.target.checked;
});

/* ---------------------- Gabor Patch 繪製 ---------------------- */
function clearCanvasGray(canvas, bgGray = 0.5) {
  const ctx = canvas.getContext("2d");
  const gray = Math.round(bgGray * 255);
  ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/* ---------------------- 動態淡入淡出呈現 -----------------------
   一般 LCD/OLED 螢幕更新速度快，可用「短暫閃現＋淡入淡出」的時序刺激呈現方
   式，較接近正式視覺心理物理實驗設計（固定曝光時間、避免受試者無限盯著刺激
   看），有助於提升訓練的精準度與一致性。
   做法：先計算一次正規化的 Gabor 圖樣（灰階 -1~1），之後每個動畫影格只需用
   簡單乘加運算套上時間包絡（raised-cosine），避免每影格都重算三角函數，效能更好。
=============================================================== */
function computeGaborPatternFull(w, h, { orientationDeg, spatialFreq, sigmaRatio, cx, cy }) {
  const theta = (orientationDeg * Math.PI) / 180;
  const centerX = cx ?? w / 2;
  const centerY = cy ?? h / 2;
  const sigma = (Math.min(w, h) / 2) * sigmaRatio;
  const freqPerPixel = spatialFreq / w;
  const pattern = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const xp = dx * Math.cos(theta) + dy * Math.sin(theta);
      const yp = -dx * Math.sin(theta) + dy * Math.cos(theta);
      const gaussian = Math.exp(-(xp * xp + yp * yp) / (2 * sigma * sigma));
      const grating = Math.cos(2 * Math.PI * freqPerPixel * xp);
      pattern[y * w + x] = grating * gaussian;
    }
  }
  return pattern;
}

function renderPatternFrame(canvas, pattern, bgGray, contrastNow) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;
  for (let i = 0; i < pattern.length; i++) {
    const value = bgGray + contrastNow * 0.5 * pattern[i];
    const gray = Math.max(0, Math.min(255, Math.round(value * 255)));
    const idx = i * 4;
    data[idx] = gray;
    data[idx + 1] = gray;
    data[idx + 2] = gray;
    data[idx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * 以 raised-cosine 時間包絡，將刺激對比度從 0 平滑升到峰值再降回 0，
 * 模擬正式實驗中常見的「短暫閃現」呈現方式。完成後會清成灰色背景並呼叫 onDone。
 */
function animateFlashPresentation(canvas, pattern, { bgGray = 0.5, peakContrast = 0.9, durationMs = 300 } = {}, onDone) {
  const startTime = performance.now();
  let rafHandle;

  function frame(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    // raised-cosine envelope: 0 -> 1 -> 0
    const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * t)) * (t < 1 ? 1 : 0);
    const contrastNow = peakContrast * Math.max(0, envelope);
    renderPatternFrame(canvas, pattern, bgGray, contrastNow);
    if (t < 1) {
      rafHandle = requestAnimationFrame(frame);
    } else {
      clearCanvasGray(canvas, bgGray);
      if (onDone) onDone();
    }
  }
  rafHandle = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafHandle); // 回傳可取消函式
}

/* ---------------------- Staircase 演算法 ---------------------- */
/** 2-down-1-up：收斂於約 70.7% 正確率，用於方向辨別角度差 (Δ度) */
class OrientationStaircase {
  constructor(axisDeg, { start = 15, min = 1, max = 45, stepDown = 1, stepUp = 1, savedState = null } = {}) {
    this.axisDeg = axisDeg;
    this.min = min;
    this.max = max;
    this.stepDown = stepDown;
    this.stepUp = stepUp;
    // 若有跨 session 儲存的狀態，直接接續（含反轉紀錄與連續答對計數），而不是每次從頭算起
    if (savedState && typeof savedState.delta === "number") {
      this.delta = savedState.delta;
      this.correctStreak = savedState.correctStreak ?? 0;
      this.reversals = Array.isArray(savedState.reversals) ? savedState.reversals.slice() : [];
      this.lastDirection = savedState.lastDirection ?? null;
    } else {
      this.delta = start;
      this.correctStreak = 0;
      this.reversals = [];
      this.lastDirection = null;
    }
  }

  nextTrial() {
    // 隨機決定條紋相對軸度順時針(+)或逆時針(-)偏移
    const sign = Math.random() < 0.5 ? 1 : -1;
    const stimulusOrientation = this.axisDeg + sign * this.delta;
    return { stimulusOrientation, sign, delta: this.delta, axisDeg: this.axisDeg };
  }

  update(isCorrect) {
    let direction;
    if (isCorrect) {
      this.correctStreak++;
      if (this.correctStreak >= 2) {
        direction = "down";
        this.delta = Math.max(this.min, this.delta - this.stepDown);
        this.correctStreak = 0;
      }
    } else {
      this.correctStreak = 0;
      direction = "up";
      this.delta = Math.min(this.max, this.delta + this.stepUp);
    }
    if (direction && this.lastDirection && direction !== this.lastDirection) {
      this.reversals.push(this.delta);
    }
    if (direction) this.lastDirection = direction;
  }

  threshold() {
    if (this.reversals.length === 0) return this.delta;
    const last = this.reversals.slice(-6);
    return last.reduce((a, b) => a + b, 0) / last.length;
  }

  /** 匯出目前狀態供跨 session 持久化延續 */
  exportState() {
    return { delta: this.delta, correctStreak: this.correctStreak, reversals: this.reversals.slice(), lastDirection: this.lastDirection };
  }
}

/** 3-down-1-up：收斂於約 79.4% 正確率，用於對比度 (log scale) */
class ContrastStaircase {
  constructor({ start = 0.5, min = 0.02, max = 1, stepDown = 0.85, stepUp = 1.3, savedState = null } = {}) {
    this.min = min;
    this.max = max;
    this.stepDown = stepDown; // 乘法下降
    this.stepUp = stepUp; // 乘法上升
    if (savedState && typeof savedState.contrast === "number") {
      this.contrast = savedState.contrast;
      this.correctStreak = savedState.correctStreak ?? 0;
      this.reversals = Array.isArray(savedState.reversals) ? savedState.reversals.slice() : [];
      this.lastDirection = savedState.lastDirection ?? null;
    } else {
      this.contrast = start;
      this.correctStreak = 0;
      this.reversals = [];
      this.lastDirection = null;
    }
  }

  nextTrial() {
    const side = Math.random() < 0.5 ? "left" : "right";
    return { contrast: this.contrast, side };
  }

  update(isCorrect) {
    let direction;
    if (isCorrect) {
      this.correctStreak++;
      if (this.correctStreak >= 3) {
        direction = "down";
        this.contrast = Math.max(this.min, this.contrast * this.stepDown);
        this.correctStreak = 0;
      }
    } else {
      this.correctStreak = 0;
      direction = "up";
      this.contrast = Math.min(this.max, this.contrast * this.stepUp);
    }
    if (direction && this.lastDirection && direction !== this.lastDirection) {
      this.reversals.push(this.contrast);
    }
    if (direction) this.lastDirection = direction;
  }

  threshold() {
    if (this.reversals.length === 0) return this.contrast;
    const last = this.reversals.slice(-6);
    return last.reduce((a, b) => a + b, 0) / last.length;
  }

  /** 匯出目前狀態供跨 session 持久化延續 */
  exportState() {
    return { contrast: this.contrast, correctStreak: this.correctStreak, reversals: this.reversals.slice(), lastDirection: this.lastDirection };
  }
}

/* ---------------------- 難度預設（手動模式）---------------------- */
const DIFFICULTY_PRESETS = {
  easy: { orientationDelta: 25, contrast: 0.7 },
  medium: { orientationDelta: 12, contrast: 0.35 },
  hard: { orientationDelta: 5, contrast: 0.15 },
};

/* ---------------------- 訓練 Session 控制 ---------------------- */
const canvas = document.getElementById("gabor-canvas");
const timerDisplay = document.getElementById("timer-display");
const trialDisplay = document.getElementById("trial-display");
const eyeDisplay = document.getElementById("eye-display");
const instructionText = document.getElementById("instruction-text");
const responseGroup = document.getElementById("response-group");
const feedbackDisplay = document.getElementById("feedback-display");

let session = null; // 當前訓練 session 物件

function eyeLabel(eye) {
  return { right: "右眼", left: "左眼", both: "雙眼", alt: "雙眼輪替" }[eye] || eye;
}

function buildSession() {
  const totalMs = state.durationMin * 60 * 1000;
  const savedThresholds = loadThresholds(); // 延續上次收斂的難度，避免每次都從寬鬆預設重新暖身
  const s = {
    eye: state.eye,
    mode: state.mode,
    difficulty: state.difficulty,
    totalMs,
    startTime: null,
    remainingMsAtPause: totalMs,
    trialCount: 0,
    correctCount: 0,
    currentEye: state.eye === "alt" ? "right" : state.eye, // alt 模式先右眼
    altSwitched: false,
    staircases: {
      right: new OrientationStaircase(state.axisRight, { savedState: savedThresholds.right }),
      left: new OrientationStaircase(state.axisLeft, { savedState: savedThresholds.left }),
      contrastRight: new ContrastStaircase({ savedState: savedThresholds.contrastRight }),
      contrastLeft: new ContrastStaircase({ savedState: savedThresholds.contrastLeft }),
      contrastBoth: new ContrastStaircase({ savedState: savedThresholds.contrastBoth }),
      bothOrientation: new OrientationStaircase((state.axisRight + state.axisLeft) / 2, { savedState: savedThresholds.bothOrientation }),
    },
    log: [], // {mode, eye, correct, value}
    timerHandle: null,
    trialTimeoutHandles: [],
    rafCancellers: [],
    trialInFlight: false, // 目前是否有一題尚未作答完成
    ended: false,
  };
  return s;
}

function startTraining() {
  session = buildSession();
  if (state.eye === "alt") {
    promptCover("left", () => beginSessionTimer());
  } else {
    beginSessionTimer();
  }
}

function promptCover(eyeToCover, onContinue) {
  const label = eyeToCover === "left" ? "左眼" : "右眼";
  document.getElementById("cover-text").textContent = `請遮住${label}`;
  showScreen("cover");
  const btn = document.getElementById("btn-cover-continue");
  const handler = () => {
    btn.removeEventListener("click", handler);
    onContinue();
  };
  btn.addEventListener("click", handler);
}

function beginSessionTimer() {
  showScreen("training");
  beginTrialsAfterReadyBuffer();
}

/** 遮眼完成/換眼完成後，先停頓片刻讓眼睛重新對焦，再正式開始計時與出題，
 * 避免剛切換過來視線還沒對準，就錯過第一題的短暫閃現。此緩衝時間不計入訓練倒數。 */
const PRE_TRIAL_BUFFER_MS = 1000;
function beginTrialsAfterReadyBuffer() {
  clearCanvasGray(canvas);
  instructionText.textContent = "準備中…";
  responseGroup.innerHTML = "";
  const handle = setTimeout(() => {
    instructionText.textContent = "";
    session.startTime = Date.now();
    session.endTime = session.startTime + session.remainingMsAtPause;
    updateTimerLoop();
    runNextTrial();
  }, PRE_TRIAL_BUFFER_MS);
  session.trialTimeoutHandles.push(handle);
}

function updateTimerLoop() {
  if (session.ended) return;
  const remaining = Math.max(0, session.endTime - Date.now());
  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  timerDisplay.textContent = `${mm}:${ss}`;

  // 雙眼輪替：時間過半時切換眼別
  if (state.eye === "alt" && !session.altSwitched && remaining <= session.remainingMsAtPause / 2) {
    session.altSwitched = true;
    switchEyeMidway();
    return;
  }

  if (remaining <= 0) {
    endTraining();
    return;
  }
  session.timerHandle = setTimeout(updateTimerLoop, 500);
}

/** 取消目前尚未作答完成的題目（計時器與動畫），並把未完成的題數退回，避免殘留畫面或誤判眼別。 */
function cancelInFlightTrial() {
  session.trialTimeoutHandles.forEach(clearTimeout);
  session.trialTimeoutHandles = [];
  session.rafCancellers.forEach((cancel) => cancel());
  session.rafCancellers = [];
  activeResponse = null;
  if (session.trialInFlight) {
    session.trialCount = Math.max(0, session.trialCount - 1);
    session.trialInFlight = false;
  }
  clearCanvasGray(canvas);
  instructionText.textContent = "";
  responseGroup.innerHTML = "";
  feedbackDisplay.className = "feedback";
  feedbackDisplay.textContent = "";
}

function switchEyeMidway() {
  clearTimeout(session.timerHandle);
  cancelInFlightTrial(); // 中斷進行中的題目，避免換眼後畫面卡住或答案記錯眼別
  session.currentEye = session.currentEye === "right" ? "left" : "right";
  session.remainingMsAtPause = session.endTime - Date.now();
  const coverEye = session.currentEye === "right" ? "left" : "right";
  promptCover(coverEye, () => {
    showScreen("training");
    beginTrialsAfterReadyBuffer(); // 換眼後先緩衝對焦，再開始全新一題，而不是沿用被中斷的舊題目
  });
}

function endTraining(aborted = false) {
  session.ended = true;
  clearTimeout(session.timerHandle);
  session.trialTimeoutHandles.forEach(clearTimeout);
  session.rafCancellers.forEach((cancel) => cancel());
  if (!aborted) {
    saveThresholds(session.staircases); // 中斷結束的訓練資料不可靠，不採用；只有正常跑完才記住收斂難度
  }
  showSummary();
}

document.getElementById("btn-abort").addEventListener("click", () => {
  if (session) endTraining(true);
});

/* ---------------------- Trial 邏輯 ---------------------- */
function currentTrialMode() {
  if (state.mode === "mixed") {
    return Math.random() < 0.5 ? "astig" : "myopia";
  }
  return state.mode;
}

function runNextTrial() {
  if (session.ended) return;
  session.trialCount++;
  session.trialInFlight = true;
  trialDisplay.textContent = `第 ${session.trialCount} 題`;
  eyeDisplay.textContent = eyeLabel(session.currentEye === "right" || session.currentEye === "left" ? session.currentEye : state.eye);

  feedbackDisplay.className = "feedback";
  feedbackDisplay.textContent = "";
  responseGroup.innerHTML = "";
  activeResponse = null;

  const mode = currentTrialMode();
  if (mode === "astig") {
    runAstigTrial();
  } else {
    runMyopiaTrial();
  }
}

function getEyeKeyForStaircase(base) {
  // base: 'right' | 'left' 的 staircase 命名前綴
  if (state.eye === "both") return "bothOrientation";
  return session.currentEye === "left" ? "left" : "right";
}

function manualDeltaForDifficulty() {
  return DIFFICULTY_PRESETS[state.difficulty]?.orientationDelta ?? 12;
}
function manualContrastForDifficulty() {
  return DIFFICULTY_PRESETS[state.difficulty]?.contrast ?? 0.35;
}

const SCREEN_REFERENCE_FLASH_MS = 600; // 基準方向淡入淡出總時長
const SCREEN_ISI_MS = 150; // 刺激間空白間隔
const SCREEN_STIMULUS_FLASH_MS = 300; // 偏移刺激淡入淡出總時長
const SCREEN_MYOPIA_FLASH_MS = 250; // 對比敏感度刺激閃現時長

function runAstigTrial() {
  const trialEye = session.currentEye; // 鎖定本題的眼別，避免題目進行中途被切眼而記錯
  let delta, axisDeg, staircaseKey;
  if (state.difficulty === "auto") {
    staircaseKey = getEyeKeyForStaircase();
    const sc = session.staircases[staircaseKey];
    const trial = sc.nextTrial();
    delta = trial.delta;
    axisDeg = trial.axisDeg;
    var sign = trial.sign;
  } else {
    axisDeg = state.eye === "both" ? (state.axisRight + state.axisLeft) / 2
      : session.currentEye === "left" ? state.axisLeft : state.axisRight;
    delta = manualDeltaForDifficulty();
    sign = Math.random() < 0.5 ? 1 : -1;
  }
  const orientation = axisDeg + sign * delta;

  const askQuestion = () => {
    instructionText.textContent = "相對剛才的基準，條紋是「順時針偏」還是「逆時針偏」？（可用左右方向鍵）";
    renderResponseButtons([
      { label: "逆時針 ↺ (←)", value: -1 },
      { label: "順時針 ↻ (→)", value: 1 },
    ], (answer) => {
      const isCorrect = answer === sign;
      if (state.difficulty === "auto") {
        session.staircases[staircaseKey].update(isCorrect);
      }
      recordAndContinue("astig", isCorrect, delta, trialEye);
    });
  };

  // 先以短暫閃現＋淡入淡出顯示基準方向，答題在偏移刺激消失後進行
  instructionText.textContent = "請先記住基準方向（閃現中）";
  responseGroup.innerHTML = "";
  const refPattern = computeGaborPatternFull(canvas.width, canvas.height, {
    orientationDeg: axisDeg, spatialFreq: 6, sigmaRatio: 0.35,
  });
  const cancel1 = animateFlashPresentation(canvas, refPattern, { peakContrast: 0.9, durationMs: SCREEN_REFERENCE_FLASH_MS }, () => {
    instructionText.textContent = "";
    const h = setTimeout(() => {
      const stimPattern = computeGaborPatternFull(canvas.width, canvas.height, {
        orientationDeg: orientation, spatialFreq: 6, sigmaRatio: 0.35,
      });
      instructionText.textContent = "請專注看清楚方向（閃現中）";
      const cancel2 = animateFlashPresentation(canvas, stimPattern, { peakContrast: 0.9, durationMs: SCREEN_STIMULUS_FLASH_MS }, askQuestion);
      session.rafCancellers.push(cancel2);
    }, SCREEN_ISI_MS);
    session.trialTimeoutHandles.push(h);
  });
  session.rafCancellers.push(cancel1);
}

function runMyopiaTrial() {
  const trialEye = session.currentEye; // 鎖定本題的眼別，避免題目進行中途被切眼而記錯
  let contrast, side, staircaseKey;
  if (state.difficulty === "auto") {
    staircaseKey = state.eye === "both" ? "contrastBoth" : session.currentEye === "left" ? "contrastLeft" : "contrastRight";
    const sc = session.staircases[staircaseKey];
    const trial = sc.nextTrial();
    contrast = trial.contrast;
    side = trial.side;
  } else {
    contrast = manualContrastForDifficulty();
    side = Math.random() < 0.5 ? "left" : "right";
  }

  const w = canvas.width, h = canvas.height;
  const targetX = side === "left" ? w * 0.25 : w * 0.75;

  const askQuestion = () => {
    instructionText.textContent = "剛才圖案出現在畫面的「左側」還是「右側」？（可用左右方向鍵）";
    renderResponseButtons([
      { label: "左側 ⬅ (←)", value: "left" },
      { label: "右側 ➡ (→)", value: "right" },
    ], (answer) => {
      const isCorrect = answer === side;
      if (state.difficulty === "auto") {
        session.staircases[staircaseKey].update(isCorrect);
      }
      recordAndContinue("myopia", isCorrect, contrast, trialEye);
    });
  };

  // 刺激短暫閃現後消失，答題憑記憶判斷（更接近正式對比敏感度測驗）
  instructionText.textContent = "請注意圖案閃現的位置";
  responseGroup.innerHTML = "";
  const pattern = computeGaborPatternFull(w, h, {
    orientationDeg: 90, spatialFreq: 4, sigmaRatio: 0.18, cx: targetX, cy: h / 2,
  });
  const cancel = animateFlashPresentation(canvas, pattern, { peakContrast: contrast, durationMs: SCREEN_MYOPIA_FLASH_MS }, askQuestion);
  session.rafCancellers.push(cancel);
}

// 目前可回答的選項與回呼，供鍵盤快捷鍵使用
// 慣例：options[0] 對應左方向鍵（左側／逆時針），options[1] 對應右方向鍵（右側／順時針）
let activeResponse = null; // { options, onAnswer, answered }

function renderResponseButtons(options, onAnswer) {
  responseGroup.innerHTML = "";
  activeResponse = { options, onAnswer, answered: false };

  const selectAnswer = (value) => {
    if (!activeResponse || activeResponse.answered) return;
    activeResponse.answered = true;
    responseGroup.querySelectorAll("button").forEach((b) => (b.disabled = true));
    onAnswer(value);
  };

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "opt-btn";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => selectAnswer(opt.value));
    responseGroup.appendChild(btn);
  });

  activeResponse.selectAnswer = selectAnswer;
}

document.addEventListener("keydown", (e) => {
  if (!activeResponse || activeResponse.answered) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    activeResponse.selectAnswer(activeResponse.options[0].value);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    activeResponse.selectAnswer(activeResponse.options[1].value);
  }
});

function playFeedbackSound(isCorrect) {
  if (!state.soundFeedback) return;
  try {
    const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    osc.frequency.value = isCorrect ? 880 : 220;
    osc.connect(gain);
    gain.connect(ctxAudio.destination);
    gain.gain.setValueAtTime(0.2, ctxAudio.currentTime);
    osc.start();
    osc.stop(ctxAudio.currentTime + 0.15);
  } catch (e) {
    /* 忽略不支援音效的環境 */
  }
}

function recordAndContinue(mode, isCorrect, value, trialEye) {
  session.trialInFlight = false;
  session.correctCount += isCorrect ? 1 : 0;
  session.log.push({ mode, eye: trialEye ?? session.currentEye, correct: isCorrect, value });

  feedbackDisplay.className = "feedback " + (isCorrect ? "correct" : "incorrect");
  playFeedbackSound(isCorrect);

  const handle = setTimeout(() => {
    if (!session.ended) runNextTrial();
  }, 700);
  session.trialTimeoutHandles.push(handle);
}

/* ---------------------- 總結畫面 ---------------------- */
function showSummary() {
  const content = document.getElementById("summary-content");
  const accuracy = session.trialCount > 0 ? Math.round((session.correctCount / session.trialCount) * 100) : 0;

  const astigRightThreshold = session.staircases.right.threshold().toFixed(1);
  const astigLeftThreshold = session.staircases.left.threshold().toFixed(1);
  const contrastRightThreshold = session.staircases.contrastRight.threshold().toFixed(3);
  const contrastLeftThreshold = session.staircases.contrastLeft.threshold().toFixed(3);

  content.innerHTML = `
    <p><strong>訓練眼別：</strong>${eyeLabel(state.eye)}</p>
    <p><strong>訓練模式：</strong>${{ astig: "方向辨別", myopia: "對比敏感度", mixed: "混合交替" }[state.mode]}</p>
    <p><strong>總題數：</strong>${session.trialCount}　<strong>正確率：</strong>${accuracy}%</p>
    <p><strong>右眼方向辨別角度閾值：</strong>${astigRightThreshold}°</p>
    <p><strong>左眼方向辨別角度閾值：</strong>${astigLeftThreshold}°</p>
    <p><strong>右眼對比敏感度閾值：</strong>${contrastRightThreshold}</p>
    <p><strong>左眼對比敏感度閾值：</strong>${contrastLeftThreshold}</p>
    <p class="hint">閾值越小代表辨別能力越好；持續訓練後應逐漸下降。</p>
  `;

  saveHistory({
    date: new Date().toISOString(),
    eye: state.eye,
    mode: state.mode,
    trialCount: session.trialCount,
    accuracy,
    astigRightThreshold,
    astigLeftThreshold,
    contrastRightThreshold,
    contrastLeftThreshold,
  });

  showScreen("summary");
}

/* ---------------------- 歷史紀錄 ---------------------- */
const HISTORY_KEY = "gaborTrainingHistory";

function saveHistory(entry) {
  const list = loadHistory();
  list.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch (e) {
    return [];
  }
}

/* ---------------------- 難度閾值記憶（跨 session 延續上次收斂結果）---------------------- */
const THRESHOLDS_KEY = "gaborThresholds";
// 鍵名對應 session.staircases 的 key：right/left/contrastRight/contrastLeft/contrastBoth/bothOrientation

function loadThresholds() {
  try {
    return JSON.parse(localStorage.getItem(THRESHOLDS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveThresholds(staircases) {
  const stored = loadThresholds();
  // 完整狀態（含反轉紀錄、連續答對次數）跨 session 延續，讓反轉次數可以累積到好幾天後才收斂，
  // 不需要在單一 session 內就湊滿3次反轉。中斷的 session 不會呼叫到這裡（見 endTraining）。
  Object.entries(staircases).forEach(([key, sc]) => {
    stored[key] = sc.exportState();
  });
  localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(stored));
}

/* ---------------------- 跨裝置同步（文字碼，不含訓練歷史）---------------------- */
// 只打包軸度設定與難度閾值狀態，刻意不含歷史紀錄，避免同步碼過長
function buildSyncPayload() {
  return JSON.stringify({
    v: 1, // schema 版本，之後格式變動可用來判斷相容性
    t: Date.now(), // 匯出時間戳，匯入時可用來提示「目標裝置資料較新」
    axis: loadAxisSettings(),
    thresholds: loadThresholds(),
  });
}

function applySyncPayload(text) {
  let data;
  try {
    data = JSON.parse(text.trim());
  } catch (e) {
    throw new Error("格式錯誤，請確認貼上的是完整的同步碼");
  }
  if (!data || typeof data !== "object" || !data.axis || !data.thresholds) {
    throw new Error("內容不完整，請確認貼上的是完整的同步碼");
  }
  localStorage.setItem(AXIS_SETTINGS_KEY, JSON.stringify(data.axis));
  localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(data.thresholds));
  // 套用到目前頁面狀態，不用重新整理就能生效
  state.axisRight = typeof data.axis.axisRight === "number" ? data.axis.axisRight : 0;
  state.axisLeft = typeof data.axis.axisLeft === "number" ? data.axis.axisLeft : 0;
  document.getElementById("axis-right").value = state.axisRight;
  document.getElementById("axis-left").value = state.axisLeft;
}

document.getElementById("btn-sync-export").addEventListener("click", () => {
  const payload = buildSyncPayload();
  document.getElementById("sync-export-text").value = payload;
  document.getElementById("sync-export-area").style.display = "block";
  document.getElementById("sync-copy-status").textContent = "";
});

document.getElementById("btn-sync-copy").addEventListener("click", async () => {
  const text = document.getElementById("sync-export-text").value;
  const status = document.getElementById("sync-copy-status");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "已複製！";
  } catch (e) {
    // 部分瀏覽器/不安全的連線下 clipboard API 無法使用，退回手動選取
    const ta = document.getElementById("sync-export-text");
    ta.select();
    status.textContent = "無法自動複製，已幫你選取文字，請手動複製（Ctrl/Cmd+C）";
  }
});

document.getElementById("btn-sync-import").addEventListener("click", () => {
  const text = document.getElementById("sync-import-text").value;
  const status = document.getElementById("sync-import-status");
  if (!text.trim()) {
    status.textContent = "請先貼上同步碼";
    return;
  }
  if (!confirm("匯入後會覆蓋這台裝置目前的軸度與難度閾值設定，確定要匯入嗎？")) return;
  try {
    applySyncPayload(text);
    status.textContent = "匯入成功！";
  } catch (e) {
    status.textContent = e.message;
  }
});

/* ---------------------- 每日練習進度與連續天數 ---------------------- */
/** 將日期轉成本地時區的 YYYY-MM-DD 字串，避免用 UTC 轉換造成跨日誤差 */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const RECOMMENDED_SESSIONS_PER_DAY = 2;

function renderDailyProgress() {
  const history = loadHistory();
  const todayKey = dateKey(new Date());
  const todayCount = history.filter((h) => dateKey(new Date(h.date)) === todayKey).length;

  // 計算連續練習天數：從今天（或今天尚未練習則從昨天）往回算，
  // 只要當天至少完成一次訓練就算，直到遇到空白的一天為止。
  const daysWithSession = new Set(history.map((h) => dateKey(new Date(h.date))));
  let streak = 0;
  const cursor = new Date();
  if (!daysWithSession.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (daysWithSession.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const checkIcon = todayCount >= RECOMMENDED_SESSIONS_PER_DAY ? "✓" : "○";
  const el = document.getElementById("today-progress-text");
  el.textContent = `${checkIcon} 今日已完成 ${todayCount} 次訓練（建議 ${RECOMMENDED_SESSIONS_PER_DAY}~3 次）　🔥 連續練習 ${streak} 天`;
}

function renderHistory() {
  const container = document.getElementById("history-content");
  const all = loadHistory();
  const list = all.slice().reverse();
  if (list.length === 0) {
    container.innerHTML = "<p>尚無訓練紀錄。</p>";
    return;
  }
  const rows = list
    .map((h, i) => {
      const originalIndex = all.length - 1 - i; // 換算回 loadHistory() 原始陣列中的索引，供刪除使用
      return `
    <tr>
      <td>${new Date(h.date).toLocaleString("zh-TW", { hour12: false })}</td>
      <td>${eyeLabel(h.eye)}</td>
      <td>${{ astig: "方向辨別", myopia: "對比敏感度", mixed: "混合" }[h.mode] || h.mode}</td>
      <td>${h.trialCount}</td>
      <td>${h.accuracy}%</td>
      <td>${h.astigRightThreshold}° / ${h.astigLeftThreshold}°</td>
      <td>${h.contrastRightThreshold} / ${h.contrastLeftThreshold}</td>
      <td><button class="small-btn btn-delete-history" data-index="${originalIndex}">刪除</button></td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>時間</th><th>眼別</th><th>模式</th><th>題數</th><th>正確率</th>
          <th>方向閾值(右/左)</th><th>對比閾值(右/左)</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.querySelectorAll(".btn-delete-history").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      deleteHistoryEntry(idx);
    });
  });
}

function deleteHistoryEntry(index) {
  const all = loadHistory();
  if (index < 0 || index >= all.length) return;
  if (!confirm("確定要刪除這筆訓練紀錄嗎？")) return;
  all.splice(index, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  renderHistory();
  renderDailyProgress(); // 刪除紀錄可能影響今日次數與連續天數的統計
}

/* ---------------------- 導覽按鈕 ---------------------- */
document.getElementById("btn-start").addEventListener("click", startTraining);
document.getElementById("btn-history").addEventListener("click", () => {
  renderHistory();
  showScreen("history");
});
document.getElementById("btn-back-setup").addEventListener("click", () => {
  renderDailyProgress();
  showScreen("setup");
});
document.getElementById("btn-history-back").addEventListener("click", () => {
  renderDailyProgress();
  showScreen("setup");
});
document.getElementById("btn-clear-history").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  renderDailyProgress();
});

/* ---------------------- 初始畫面 ---------------------- */
renderDailyProgress();
showScreen("setup");
