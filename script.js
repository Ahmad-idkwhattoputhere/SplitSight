"use strict";

/* ==========================================
   SPLITSIGHT — PDAF EDUCATIONAL SIMULATION
========================================== */

const $ = (id) => document.getElementById(id);
const INITIAL_DEFOCUS_POSITION = 8;


/* ==========================================
   STATE
========================================== */

const state = {
  mode: "sample",

  stream: null,
  objectURL: null,
  mediaLoadToken: 0,

  blur: INITIAL_DEFOCUS_POSITION,
  lensPosition: INITIAL_DEFOCUS_POSITION,

  profile: [],
  signalA: [],
  signalB: [],

  estimatedDefocus: 0,
  correlationScore: 0,
  lastLensCorrection: 0,
  pdafStageIndex: 0,

  running: false,
  runToken: 0,

  videoTimer: null
};


/* ==========================================
   CANVAS SETUP
========================================== */

const analysisCanvas = $("analysisCanvas");
const analysisCtx = analysisCanvas.getContext("2d", {
  willReadFrequently: true
});

const pdafBaseImageCanvas = document.createElement("canvas");
pdafBaseImageCanvas.width = analysisCanvas.width;
pdafBaseImageCanvas.height = analysisCanvas.height;
const pdafBaseImageContext = pdafBaseImageCanvas.getContext("2d");

const signalCanvasA = $("signalA");
const signalCanvasB = $("signalB");

const signalCtxA = signalCanvasA.getContext("2d");
const signalCtxB = signalCanvasB.getContext("2d");


/* ==========================================
   STATUS
========================================== */

function setStatus(message) {
  $("statusMessage").textContent = message;
}

function cancelAutofocus() {
  if (!state.running) return;

  state.runToken++;
  state.running = false;
  $("runFocus").disabled = false;
  $("runFocus").textContent = "Run autofocus ↗";
  $("defocusSlider").disabled = false;
}

const pdafStages = [
  {
    title: "1. The lens is out of position",
    text: "When a lens is not set for the subject, the image on the sensor looks blurry. In this demo, blur equals the absolute virtual lens offset."
  },
  {
    title: "2. Sensor pixels capture two views",
    text: "In Dual Pixel PDAF, each split pixel receives light from opposite sides of the lens. This creates two slightly shifted views; the demo makes a simplified pair of signals in code."
  },
  {
    title: "3. The camera works out the correction",
    text: "The camera compares the two patterns. Their shift tells it which way and how far to move the lens; this demo estimates that shift by checking how well the signals line up."
  },
  {
    title: "4. The lens moves into focus",
    text: "A real camera physically moves its lens; PDAF does not digitally erase blur. Here, only a virtual lens position moves, and the CSS preview blur follows its absolute offset."
  }
];

function setPdafStage(index) {
  const stage = pdafStages[index];
  if (!stage) return;

  state.pdafStageIndex = index;
  $("pdafStage").textContent = `STAGE 0${index + 1} / 04`;
  $("pdafScienceTitle").textContent = stage.title;
  $("pdafScienceText").textContent = stage.text;
  $("pdafCompletion").classList.add("hidden");

  document.querySelectorAll(".pdaf-diagram-node").forEach(node => {
    node.classList.toggle("active", Number(node.dataset.step) === index);
  });

  renderPdafReference($("pdafLiveReference"), index);
}

function setPdafReadyState() {
  state.pdafStageIndex = 0;
  state.lastLensCorrection = 0;
  const startsDefocused = state.lensPosition !== 0;
  $("pdafCompletion").classList.add("hidden");
  $("pdafStage").textContent = "READY TO BEGIN";
  $("pdafScienceTitle").textContent = startsDefocused
    ? "The lens starts out of position"
    : "How does autofocus work?";
  $("pdafScienceText").textContent = startsDefocused
    ? `Your media starts at virtual offset ${state.lensPosition.toFixed(2)} and is out of focus. Run autofocus to move the lens back to zero.`
    : "The lens is at zero. Move the offset away from zero or run autofocus to see the model create its starting defocus.";

  document.querySelectorAll(".pdaf-diagram-node").forEach(node => {
    node.classList.toggle("active", node.dataset.step === "0");
  });

  applyBlur();
  renderPdafReference($("pdafLiveReference"), 0);
}


/* ==========================================
   MEDIA MANAGEMENT
========================================== */

function getActiveVisual() {

  if (state.mode === "photo") {
    return $("photoPreview");
  }

  if (state.mode === "video") {
    return $("videoPreview");
  }

  if (state.mode === "camera") {
    return $("livePreview");
  }

  return $("sampleScene");
}


function setMode(mode, label) {

  cancelAutofocus();
  const previousMode = state.mode;

  if (previousMode === "video" && mode !== "video") {
    $("videoPreview").pause();
  }

  if (previousMode !== mode && state.videoTimer) {
    clearInterval(state.videoTimer);
    state.videoTimer = null;
  }

  state.mode = mode;
  state.lensPosition = INITIAL_DEFOCUS_POSITION;
  state.lastLensCorrection = 0;
  state.pdafStageIndex = 0;
  $("defocusSlider").value = INITIAL_DEFOCUS_POSITION;

  const elements = [
    "photoPreview",
    "videoPreview",
    "livePreview",
    "sampleScene"
  ];

  elements.forEach(id => {
    $(id).classList.add("hidden");
  });

  getActiveVisual().classList.remove("hidden");

  $("mediaLabel").textContent = label;

  setPdafReadyState();

  if (mode !== "sample") {
    sampleCurrentMedia();
  }
}

function drawPdafSignalTrace(context, values, color, centerY, width, amplitude = 18) {
  if (!values.length) return;

  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 1.5;

  values.forEach((value, index) => {
    const x = 10 + index / (values.length - 1) * (width - 20);
    const y = centerY - value * amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
}

function renderPdafReference(canvas, stageIndex, refreshMedia = true) {
  if (!canvas) return;
  if (refreshMedia && !drawMediaToCanvas()) return;

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const sourceNames = {
    sample: "sample scene",
    photo: "uploaded photo",
    video: "video frame",
    camera: "live camera frame"
  };
  const stageNames = [
    state.lensPosition === 0
      ? "1 · READY IN FOCUS"
      : "1 · OUT OF FOCUS",
    "2 · TWO SENSOR VIEWS",
    "3 · SIGNAL SHIFT",
    state.lensPosition === 0
      ? "4 · FOCUS REACHED"
      : "4 · CURRENT POSITION"
  ];

  context.clearRect(0, 0, width, height);
  context.save();
  context.filter = `blur(${state.blur}px)`;
  context.drawImage(analysisCanvas, 0, 0, width, height);
  context.restore();

  context.save();
  context.lineWidth = 2;
  context.strokeStyle = "#e5bd75";
  context.fillStyle = "rgba(40, 39, 34, .82)";
  context.font = "11px Arial, sans-serif";

  if (stageIndex === 0) {
    context.setLineDash([4, 3]);
    context.beginPath();
    context.arc(width / 2, height / 2, 20, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(width / 2 - 7, height / 2);
    context.lineTo(width / 2 + 7, height / 2);
    context.moveTo(width / 2, height / 2 - 7);
    context.lineTo(width / 2, height / 2 + 7);
    context.stroke();
  } else if (stageIndex === 1) {
    context.setLineDash([5, 4]);
    context.strokeRect(width * .32, height * .22, width * .36, height * .52);
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(width * .32, height * .48);
    context.lineTo(width * .68, height * .48);
    context.stroke();
    context.fillStyle = "#f4f0e7";
    context.fillText("A", width * .36, height * .43);
    context.fillText("B", width * .62, height * .58);
  } else if (stageIndex === 2) {
    context.fillStyle = "rgba(40, 39, 34, .86)";
    context.fillRect(0, height - 76, width, 76);
    drawPdafSignalTrace(
      context,
      state.signalA,
      "#e5bd75",
      height - 57,
      width,
      9
    );
    drawPdafSignalTrace(
      context,
      state.signalB,
      "#a8c0a9",
      height - 33,
      width,
      9
    );
    context.fillStyle = "#f4f0e7";
    context.font = "9px Arial, sans-serif";
    context.fillText("A", 4, height - 54);
    context.fillText("B", 4, height - 30);
  } else {
    const direction = state.lastLensCorrection || 0;
    const arrowStart = width / 2 - Math.sign(direction) * 28;
    const arrowEnd = width / 2;
    context.beginPath();
    context.moveTo(arrowStart, height / 2);
    context.lineTo(arrowEnd, height / 2);
    context.lineTo(arrowEnd - Math.sign(direction) * 8, height / 2 - 6);
    context.moveTo(arrowEnd, height / 2);
    context.lineTo(arrowEnd - Math.sign(direction) * 8, height / 2 + 6);
    context.stroke();
    context.beginPath();
    context.moveTo(width / 2 - 12, height / 2);
    context.lineTo(width / 2 + 12, height / 2);
    context.moveTo(width / 2, height / 2 - 12);
    context.lineTo(width / 2, height / 2 + 12);
    context.stroke();
  }

  context.fillStyle = "rgba(40, 39, 34, .86)";
  context.fillRect(0, height - 20, width, 20);
  context.fillStyle = "#fbf9f4";
  context.font = "10px Arial, sans-serif";
  context.fillText(
    `${stageNames[stageIndex]}  ·  blur ${state.blur.toFixed(2)} px`,
    8,
    height - 6
  );
  context.restore();

  const sourceName = sourceNames[state.mode];
  canvas.setAttribute(
    "aria-label",
    `${sourceName} reference, ${stageNames[stageIndex].toLowerCase()}, blur ${state.blur.toFixed(2)} pixels`
  );

  const caption = $("pdafReferenceCaption");
  if (caption && canvas.id === "pdafLiveReference") {
    caption.textContent =
      `Current ${sourceName} · ${stageNames[stageIndex].toLowerCase()}`;
  }
}

function renderPdafBaseReference() {
  const canvas = $("pdafBaseReference");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    pdafBaseImageCanvas,
    0,
    0,
    canvas.width,
    canvas.height
  );
}

function renderPdafCompletionMedia(
  startingPosition,
  converged,
  startingSignalA,
  startingSignalB
) {
  if (!drawMediaToCanvas()) return;

  const stageLabels = [
    "STARTING DEFOCUS",
    "SPLIT VIEWS A / B",
    "SIGNAL COMPARISON",
    converged ? "FOCUSED · VIRTUAL LENS" : "CURRENT MODEL RESULT"
  ];
  const sourceNames = {
    sample: "sample scene",
    photo: "uploaded photo",
    video: "video frame",
    camera: "live camera frame"
  };

  document.querySelectorAll(".pdaf-input-step").forEach(canvas => {
    const step = Number(canvas.dataset.step);
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#252520";
    context.fillRect(0, 0, width, height);

    if (step === 0) {
      context.save();
      context.filter = `blur(${Math.min(14, Math.abs(startingPosition))}px)`;
      context.drawImage(analysisCanvas, 0, 0, width, height);
      context.restore();
    } else if (step === 1) {
      const halfWidth = width / 2;
      const splitShift = Math.min(8, Math.abs(startingPosition) * 0.5);

      context.save();
      context.beginPath();
      context.rect(0, 0, halfWidth, height);
      context.clip();
      context.drawImage(analysisCanvas, -splitShift, 0, width, height);
      context.restore();

      context.save();
      context.beginPath();
      context.rect(halfWidth, 0, halfWidth, height);
      context.clip();
      context.drawImage(analysisCanvas, splitShift, 0, width, height);
      context.restore();

      context.strokeStyle = "#e5bd75";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(halfWidth, 0);
      context.lineTo(halfWidth, height);
      context.stroke();
    } else if (step === 2) {
      context.drawImage(analysisCanvas, 0, 0, width, height);
      context.fillStyle = "rgba(40, 39, 34, .84)";
      context.fillRect(0, height - 52, width, 52);
      drawPdafSignalTrace(
        context,
        startingSignalA,
        "#e5bd75",
        height - 35,
        width,
        5
      );
      drawPdafSignalTrace(
        context,
        startingSignalB,
        "#a8c0a9",
        height - 15,
        width,
        5
      );
      context.fillStyle = "#fbf9f4";
      context.font = "9px Arial, sans-serif";
      context.fillText("A", 5, height - 32);
      context.fillText("B", 5, height - 12);
    } else {
      context.save();
      context.filter = `blur(${Math.abs(state.lensPosition)}px)`;
      context.drawImage(analysisCanvas, 0, 0, width, height);
      context.restore();
    }

    context.fillStyle = "rgba(40, 39, 34, .86)";
    context.fillRect(0, 0, width, 20);
    context.fillStyle = "#fbf9f4";
    context.font = "9px Arial, sans-serif";
    context.fillText(stageLabels[step], 7, 14);

    if (step === 3 && !converged) {
      context.fillStyle = "rgba(40, 39, 34, .86)";
      context.fillRect(0, height - 20, width, 20);
      context.fillStyle = "#fbf9f4";
      context.fillText("Focus not confirmed", 7, height - 6);
    }

    canvas.setAttribute(
      "aria-label",
      `Your ${sourceNames[state.mode]} shown during stage ${step + 1}: ${stageLabels[step].toLowerCase()}`
    );
  });
}

/* ==========================================
   BLUR CONTROL
========================================== */

function applyBlur() {

  const visual = getActiveVisual();

  state.blur = Math.abs(state.lensPosition);
  $("blurSlider").value = state.blur;

  visual.style.filter = `blur(${state.blur}px)`;

  $("blurValue").textContent = `${state.blur.toFixed(2)} px`;

  $("defocusValue").textContent =
    `${state.lensPosition >= 0 ? "+" : ""}${state.lensPosition.toFixed(2)}`;

  $("focusNumber").textContent =
    Math.abs(state.lensPosition).toFixed(2).padStart(5, "0");

  const focused = state.lensPosition === 0;

  $("focusState").textContent =
    focused ? "FOCUSED (MODEL)" : "OUT OF FOCUS";

  $("focusLabel").textContent =
    focused ? "MODEL IN FOCUS" : "OUT OF FOCUS";
}


/* ==========================================
   SAMPLE IMAGE
========================================== */

function createSampleScene() {

  const ctx = analysisCtx;
  const canvas = analysisCanvas;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(
    0, 0, 0, canvas.height
  );

  gradient.addColorStop(0, "#c8c3b6");
  gradient.addColorStop(0.62, "#aaa48e");
  gradient.addColorStop(0.63, "#8b927c");
  gradient.addColorStop(1, "#a7a18b");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);


  // Sun

  ctx.fillStyle = "#e9d8ae";

  ctx.beginPath();
  ctx.arc(260, 35, 19, 0, Math.PI * 2);
  ctx.fill();


  // Mountains

  ctx.fillStyle = "#929783";

  ctx.beginPath();
  ctx.moveTo(0, 115);
  ctx.lineTo(85, 32);
  ctx.lineTo(170, 115);
  ctx.fill();


  ctx.fillStyle = "#737d6d";

  ctx.beginPath();
  ctx.moveTo(105, 130);
  ctx.lineTo(230, 28);
  ctx.lineTo(320, 130);
  ctx.fill();


  // House

  ctx.fillStyle = "#806e58";

  ctx.beginPath();
  ctx.moveTo(128, 118);
  ctx.lineTo(166, 78);
  ctx.lineTo(205, 118);
  ctx.fill();


  ctx.fillStyle = "#d7c5a3";
  ctx.fillRect(137, 116, 58, 38);

  ctx.fillStyle = "#69766d";
  ctx.fillRect(147, 126, 10, 17);
  ctx.fillRect(174, 126, 10, 17);


  // Ground

  ctx.fillStyle = "#9b9a7d";
  ctx.fillRect(0, 150, 320, 30);

  pdafBaseImageContext.clearRect(
    0,
    0,
    pdafBaseImageCanvas.width,
    pdafBaseImageCanvas.height
  );
  pdafBaseImageContext.drawImage(
    analysisCanvas,
    0,
    0
  );
  renderPdafBaseReference();

  setMode("sample", "SAMPLE SCENE");

  updateModel();
}


/* ==========================================
   MEDIA DIMENSIONS
========================================== */

function getMediaDimensions() {

  if (state.mode === "photo") {
    return [
      $("photoPreview").naturalWidth,
      $("photoPreview").naturalHeight
    ];
  }

  if (state.mode === "video") {
    return [
      $("videoPreview").videoWidth,
      $("videoPreview").videoHeight
    ];
  }

  if (state.mode === "camera") {
    return [
      $("livePreview").videoWidth,
      $("livePreview").videoHeight
    ];
  }

  return [
    analysisCanvas.width,
    analysisCanvas.height
  ];
}


/* ==========================================
   DRAW MEDIA INTO ANALYSIS CANVAS
========================================== */

function drawMediaToCanvas() {

  if (state.mode === "sample") {
    return true;
  }

  const [width, height] = getMediaDimensions();

  if (!width || !height) {
    return false;
  }

  let source;

  if (state.mode === "photo") {
    source = $("photoPreview");
  }

  else if (state.mode === "video") {
    source = $("videoPreview");
  }

  else if (state.mode === "camera") {
    source = $("livePreview");
  }

  const scale = Math.min(
    analysisCanvas.width / width,
    analysisCanvas.height / height
  );

  const drawWidth = width * scale;
  const drawHeight = height * scale;

  analysisCtx.clearRect(
    0,
    0,
    analysisCanvas.width,
    analysisCanvas.height
  );

  analysisCtx.fillStyle = "#252520";
  analysisCtx.fillRect(
    0,
    0,
    analysisCanvas.width,
    analysisCanvas.height
  );

  analysisCtx.drawImage(
    source,
    (analysisCanvas.width - drawWidth) / 2,
    (analysisCanvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  return true;
}


/* ==========================================
   EXTRACT IMAGE BRIGHTNESS PROFILE
========================================== */

function extractBrightnessProfile() {

  if (!drawMediaToCanvas()) {
    return null;
  }

  const image = analysisCtx.getImageData(
    0,
    0,
    analysisCanvas.width,
    analysisCanvas.height
  );

  const data = image.data;

  const width = image.width;
  const height = image.height;

  const bins = 160;

  const profile = new Array(bins).fill(0);


  // Calculate average brightness in vertical strips.

  for (let x = 0; x < bins; x++) {

    let total = 0;
    let count = 0;

    const startX = Math.floor(x * width / bins);

    const endX = Math.max(
      startX + 1,
      Math.floor((x + 1) * width / bins)
    );

    for (let y = 0; y < height; y += 2) {

      for (let px = startX; px < endX; px++) {

        const index = (y * width + px) * 4;

        const brightness =
          0.2126 * data[index] +
          0.7152 * data[index + 1] +
          0.0722 * data[index + 2];

        total += brightness;
        count++;
      }
    }

    profile[x] = count ? total / count : 0;
  }


  // Remove average brightness.

  const mean =
    profile.reduce((a, b) => a + b, 0) / profile.length;

  const centered = profile.map(value => value - mean);


  // Normalize signal.

  const norm = Math.sqrt(
    centered.reduce((sum, value) => {
      return sum + value * value;
    }, 0)
  ) || 1;

  return centered.map(value => value / norm);
}


/* ==========================================
   GENERATE SHIFTED SIGNAL
========================================== */

function shiftSignal(signal, shift) {

  const length = signal.length;

  const result = new Array(length);

  for (let i = 0; i < length; i++) {

    const sourcePosition = i - shift;

    if (
      sourcePosition < 0 ||
      sourcePosition >= length - 1
    ) {
      result[i] = 0;
      continue;
    }

    const lower = Math.floor(sourcePosition);
    const fraction = sourcePosition - lower;

    result[i] =
      signal[lower] * (1 - fraction) +
      signal[lower + 1] * fraction;
  }

  return result;
}


/* ==========================================
   NORMALIZED CROSS-CORRELATION
========================================== */

function calculateCorrelation(a, b, shift) {

  let sumA = 0;
  let sumB = 0;

  let sumAA = 0;
  let sumBB = 0;

  let sumAB = 0;

  let count = 0;


  for (let i = 0; i < a.length; i++) {

    const j = i + shift;

    if (j < 0 || j >= b.length) {
      continue;
    }

    const av = a[i];
    const bv = b[j];

    sumA += av;
    sumB += bv;

    sumAA += av * av;
    sumBB += bv * bv;

    sumAB += av * bv;

    count++;
  }


  const covariance =
    sumAB - (sumA * sumB / Math.max(1, count));

  const varianceA =
    sumAA - (sumA * sumA / Math.max(1, count));

  const varianceB =
    sumBB - (sumB * sumB / Math.max(1, count));


  if (varianceA <= 1e-12 || varianceB <= 1e-12) {
    return 0;
  }

  return covariance /
    Math.sqrt(varianceA * varianceB);
}


/* ==========================================
   FIND BEST SIGNAL ALIGNMENT
========================================== */

function findBestShift(a, b) {

  let bestShift = 0;
  let bestScore = -Infinity;

  const scores = [];


  for (let shift = -24; shift <= 24; shift++) {

    const score = calculateCorrelation(
      a,
      b,
      shift
    );

    scores.push(score);

    if (score > bestScore) {

      bestScore = score;
      bestShift = shift;
    }
  }


  // Sub-pixel interpolation.

  const index = bestShift + 24;

  if (index > 0 && index < scores.length - 1) {

    const left = scores[index - 1];
    const middle = scores[index];
    const right = scores[index + 1];

    const denominator =
      left - 2 * middle + right;

    if (Math.abs(denominator) > 1e-9) {

      const fraction =
        0.5 * (left - right) / denominator;

      bestShift += Math.max(
        -0.5,
        Math.min(0.5, fraction)
      );
    }
  }

  return {
    shift: bestShift,
    score: bestScore
  };
}


/* ==========================================
   DRAW SIGNAL GRAPHS
========================================== */

function drawSignal(ctx, values, colour) {

  const width = 640;
  const height = 180;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#e3ded4";
  ctx.lineWidth = 1;


  // Grid.

  for (let y = 30; y < height; y += 30) {

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }


  // Signal.

  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;

  ctx.beginPath();

  values.forEach((value, index) => {

    const x =
      index / (values.length - 1) * width;

    const y =
      height / 2 - value * 65;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

  });

  ctx.stroke();
}


/* ==========================================
   UPDATE PDAF MODEL
========================================== */

function updateModel() {

  const profile = extractBrightnessProfile();

  if (!profile) {
    return;
  }

  state.profile = profile;

  /*
    Simplified educational model.

    The selected image provides the brightness pattern.

    A controlled simulated lens offset creates a synthetic
    displacement between the two photodiode signals.

    This is NOT a physical ray-traced Dual Pixel sensor model.
  */

  const calibration = 1.45;

  const syntheticShift = Math.max(
    -20,
    Math.min(20, state.lensPosition * calibration)
  );


  state.signalA = profile;

  state.signalB = shiftSignal(
    profile,
    syntheticShift
  );


  const result = findBestShift(
    state.signalA,
    state.signalB
  );


  // Correlation compares A[i] with B[i + shift], so the best shift has the
  // same sign as the synthetic displacement and virtual lens offset.
  state.estimatedDefocus =
    result.shift / calibration;

  state.correlationScore = result.score;


  // Draw both signals.

  drawSignal(
    signalCtxA,
    state.signalA,
    "#a88b5d"
  );

  drawSignal(
    signalCtxB,
    state.signalB,
    "#6f8171"
  );


  // Update statistics.

  $("shiftValue").textContent =
    `${result.shift >= 0 ? "+" : ""}${result.shift.toFixed(2)} px`;

  $("correlationValue").textContent =
    result.score.toFixed(3);

  $("estimatedDefocus").textContent =
    `${state.estimatedDefocus >= 0 ? "+" : ""}${state.estimatedDefocus.toFixed(2)}`;

  applyBlur();
  renderPdafReference(
    $("pdafLiveReference"),
    state.pdafStageIndex,
    false
  );
}


/* ==========================================
   REFRESH MEDIA DATA
========================================== */

function sampleCurrentMedia() {

  if (
    state.mode === "video" &&
    $("videoPreview").readyState < 2
  ) {
    return;
  }

  if (
    state.mode === "camera" &&
    $("livePreview").readyState < 2
  ) {
    return;
  }

  updateModel();
}

async function animatePdafLens(targetPosition, duration, token) {
  const startPosition = state.lensPosition;
  const startTime = performance.now();
  const mediaStage = $("sampleScene").parentElement;
  const correctionDirection = targetPosition - startPosition;
  let lastSignalUpdate = startTime;

  state.lastLensCorrection = correctionDirection;

  mediaStage.classList.add("pdaf-lens-moving");

  try {
    while (token === state.runToken) {
      const progress = Math.min(
        1,
        (performance.now() - startTime) / duration
      );
      const easedProgress =
        0.5 - 0.5 * Math.cos(Math.PI * progress);

      state.lensPosition =
        startPosition + (targetPosition - startPosition) * easedProgress;

      $("defocusSlider").value = state.lensPosition;
      applyBlur();

      if (performance.now() - lastSignalUpdate >= 120) {
        sampleCurrentMedia();
        lastSignalUpdate = performance.now();
      }

      if (progress >= 1) break;

      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  } finally {
    mediaStage.classList.remove("pdaf-lens-moving");
  }

  if (token === state.runToken) {
    state.lensPosition = targetPosition;
    $("defocusSlider").value = targetPosition;
    applyBlur();
  }

  return token === state.runToken;
}


/* ==========================================
   AUTOFOCUS CONTROLLER
========================================== */

async function runAutofocus() {

  if (state.running) {
    return;
  }

  if (state.lensPosition === 0) {
    state.lensPosition = INITIAL_DEFOCUS_POSITION;
    $("defocusSlider").value = INITIAL_DEFOCUS_POSITION;
    updateModel();
  }

  const startingPosition = state.lensPosition;
  state.running = true;
  state.lastLensCorrection = 0;

  const token = ++state.runToken;

  $("runFocus").disabled = true;
  $("runFocus").textContent = "Focusing…";
  $("defocusSlider").disabled = true;

  sampleCurrentMedia();
  const startingSignalA = state.signalA.slice();
  const startingSignalB = state.signalB.slice();
  setPdafStage(0);
  setStatus(
    "Following the defocused image through the PDAF focus cycle..."
  );

  await new Promise(resolve => setTimeout(resolve, 650));

  let iterations = 0;


  while (
    state.lensPosition !== 0 &&
    iterations < 24 &&
    token === state.runToken
  ) {

    setPdafStage(1);
    await new Promise(resolve => setTimeout(resolve, 600));
    if (token !== state.runToken) break;

    sampleCurrentMedia();

    if (state.correlationScore <= 0.05) {
      setStatus(
        "The scene has too little contrast for a reliable signal match. Try a more detailed image or the sample scene."
      );
      break;
    }

    setPdafStage(2);
    await new Promise(resolve => setTimeout(resolve, 600));
    if (token !== state.runToken) break;
    sampleCurrentMedia();

    const error = Number.isFinite(state.estimatedDefocus)
      ? state.estimatedDefocus
      : state.lensPosition;

    /*
      Proportional feedback controller.

      The estimated defocus determines the correction.
    */

    const gain = 0.62;
    const proposedPosition = Math.max(
      -14,
      Math.min(14, state.lensPosition - gain * error)
    );
    const targetPosition = Math.abs(proposedPosition) <= 0.22
      ? 0
      : proposedPosition;

    setPdafStage(3);
    setStatus("The virtual lens is moving towards the focus position…");
    const moved = await animatePdafLens(
      targetPosition,
      750,
      token
    );
    if (!moved) break;

    iterations++;
    sampleCurrentMedia();


    setStatus(
      `Autofocus iteration ${iterations}: ` +
      `remaining estimated defocus ${Math.abs(error).toFixed(2)}, ` +
      `preview blur ${state.blur.toFixed(2)} px.`
    );


  }


  if (token === state.runToken) {

    const converged = state.lensPosition === 0;

    if (converged) {
      $("defocusSlider").value = state.lensPosition;
    }

    applyBlur();

    sampleCurrentMedia();
    renderPdafCompletionMedia(
      startingPosition,
      converged,
      startingSignalA,
      startingSignalB
    );

    $("pdafStage").textContent = converged
      ? "AUTOFOCUS COMPLETE"
      : "FOCUS NOT CONFIRMED";
    $("pdafScienceTitle").textContent = converged
      ? "Four steps from blur to sharp"
      : "No reliable focus estimate";
    $("pdafScienceText").textContent = converged
      ? `The lens reached a virtual offset of ${state.lensPosition.toFixed(2)}. Read the short steps below to see how real PDAF finds focus and what this demo approximates.`
      : "The signals did not have a strong enough match, or the iteration limit was reached. The model left the lens setting unchanged rather than claiming a reliable focus result.";
    $("pdafCompletionTitle").textContent = converged
      ? "Autofocus Complete!"
      : "Autofocus did not complete";
    $("pdafCompletion").classList.remove("hidden");
    document.querySelectorAll(".pdaf-diagram-node").forEach(node => {
      node.classList.add("active");
    });

    const mediaName = {
      sample: "sample scene",
      photo: "uploaded photo",
      video: "video frame",
      camera: "live camera frame"
    }[state.mode];


    $("scienceSummary").textContent =
      `Your ${mediaName} produced a brightness profile. ` +
      `The model created two related signals with a synthetic ` +
      `phase displacement. Normalized cross-correlation estimated ` +
      (converged
        ? `their alignment, and a proportional feedback controller ` +
          `used that estimate to move the virtual lens towards its ` +
          `in-focus position. The model converged.`
        : `the model could not establish a reliable alignment, so it ` +
          `did not claim that focus had been reached.`);


    if (converged) {
      setStatus(
        "The virtual lens reached focus. Read the four steps beside the experiment."
      );
    }
  }


  state.running = false;

  $("runFocus").disabled = false;
  $("defocusSlider").disabled = false;

  $("runFocus").innerHTML =
    "Run autofocus ↗";
}


/* ==========================================
   RESET
========================================== */

function resetExperiment() {

  state.runToken++;

  state.running = false;

  state.lensPosition = INITIAL_DEFOCUS_POSITION;
  state.lastLensCorrection = 0;
  state.blur = INITIAL_DEFOCUS_POSITION;
  $("defocusSlider").value = INITIAL_DEFOCUS_POSITION;
  $("defocusSlider").disabled = false;

  $("runFocus").disabled = false;

  $("runFocus").innerHTML =
    "Run autofocus ↗";

  setPdafReadyState();

  updateModel();

  $("scienceSummary").textContent =
    "Run autofocus to see how the signals guide the virtual lens back to zero.";

  setStatus(
    `Media reset to offset +${INITIAL_DEFOCUS_POSITION}. Run autofocus to bring it back to zero.`
  );
}


/* ==========================================
   LIVE CAMERA
========================================== */

async function startCamera() {

  cancelAutofocus();

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {

    setStatus(
      "Camera access requires HTTPS or localhost and a supported browser."
    );

    return;
  }

  const requestToken = ++state.mediaLoadToken;

  try {

    if (state.mode === "camera") {
      stopCamera();
    }

    const stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment"
        },
        audio: false
      });

    if (requestToken !== state.mediaLoadToken) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    clearUploadedMediaSources();
    state.stream = stream;


    const video = $("livePreview");

    video.srcObject = state.stream;

    await video.play();

    if (requestToken !== state.mediaLoadToken) {
      stream.getTracks().forEach(track => track.stop());
      if (state.stream === stream) {
        state.stream = null;
      }
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
      return;
    }


    setMode("camera", "LIVE CAMERA");

    $("startCamera").disabled = true;

    $("stopCamera").disabled = false;


    setStatus(
      `Camera connected at virtual offset +${INITIAL_DEFOCUS_POSITION}. Your device may autofocus automatically; this model moves its virtual lens back to zero.`
    );


    sampleCurrentMedia();


    if (state.videoTimer) {
      clearInterval(state.videoTimer);
    }

    state.videoTimer = setInterval(() => {

      if (state.mode === "camera") {
        sampleCurrentMedia();
      }

    }, 250);


  } catch (error) {
    if (requestToken !== state.mediaLoadToken) {
      return;
    }

    let message = error.message;

    if (error.name === "NotAllowedError") {
      message = "Camera permission was denied.";
    }

    setStatus(`Could not start camera: ${message}`);
  }
}


/* ==========================================
   STOP CAMERA
========================================== */

function stopCamera() {

  if (state.stream) {

    state.stream.getTracks().forEach(track => {
      track.stop();
    });

  }

  state.stream = null;

  const livePreview = $("livePreview");
  livePreview.pause();
  livePreview.srcObject = null;
  livePreview.removeAttribute("src");
  livePreview.load();

  $("startCamera").disabled = false;

  $("stopCamera").disabled = true;


  if (state.videoTimer) {

    clearInterval(state.videoTimer);

    state.videoTimer = null;
  }


  if (state.mode === "camera") {

    createSampleScene();
  }
}


/* ==========================================
   UPLOAD PHOTO OR VIDEO
========================================== */

function clearVideoPlayback() {
  const video = $("videoPreview");
  video.pause();
  video.onloadeddata = null;
  video.onerror = null;
  video.removeAttribute("src");
  video.load();

  if (state.videoTimer) {
    clearInterval(state.videoTimer);
    state.videoTimer = null;
  }
}

function clearPhotoSource() {
  const image = $("photoPreview");
  image.onload = null;
  image.onerror = null;
  image.removeAttribute("src");
}

function clearUploadedMediaSources() {
  clearPhotoSource();
  clearVideoPlayback();

  if (state.objectURL) {
    URL.revokeObjectURL(state.objectURL);
    state.objectURL = null;
  }
}

function clearMediaSources() {
  clearUploadedMediaSources();
  stopCamera();
}

function restoreSampleAfterMediaError(loadToken, message) {
  if (loadToken !== state.mediaLoadToken) return;

  state.mediaLoadToken++;
  clearMediaSources();
  createSampleScene();
  setStatus(message);
}

function loadMedia(file) {

  if (!file) {
    return;
  }

  const fileType = file.type.toLowerCase();
  const isImage =
    fileType.startsWith("image/") ||
    /\.(apng|avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
  const isVideo =
    fileType.startsWith("video/") ||
    /\.(m4v|mov|mp4|ogv|webm)$/i.test(file.name);

  if (!isImage && !isVideo) {
    setStatus("Please select a supported image or video file.");
    return;
  }

  cancelAutofocus();
  const loadToken = ++state.mediaLoadToken;

  clearMediaSources();
  createSampleScene();

  state.objectURL = URL.createObjectURL(file);
  const mediaURL = state.objectURL;
  const isCurrentLoad = source =>
    loadToken === state.mediaLoadToken &&
    state.objectURL === mediaURL &&
    source.src === mediaURL;

  setStatus(`Loading ${isImage ? "photo" : "video"} locally...`);

  const image = $("photoPreview");

  if (isImage) {

    image.onload = () => {
      if (!isCurrentLoad(image)) return;

      setMode("photo", "UPLOADED PHOTO");

      setStatus(
        `Photo loaded locally at offset +${INITIAL_DEFOCUS_POSITION}; it starts out of focus. Run autofocus to move the lens to zero.`
      );

    };

    image.onerror = () => {
      if (!isCurrentLoad(image)) return;
      restoreSampleAfterMediaError(
        loadToken,
        "This image could not be opened. Try JPG, PNG or WebP. The sample scene has been restored."
      );
    };

    image.src = mediaURL;
    return;
  }

  const video = $("videoPreview");

  video.onloadeddata = async () => {
    if (!isCurrentLoad(video)) return;

    setMode("video", "UPLOADED VIDEO");

    try {
      await video.play();
      if (isCurrentLoad(video)) {
        setStatus(
          `Video is playing at offset +${INITIAL_DEFOCUS_POSITION}. Use its controls to pause or seek, then run autofocus to move the lens to zero.`
        );
      }
    } catch (error) {
      if (isCurrentLoad(video)) {
        setStatus(
          `Video loaded at offset +${INITIAL_DEFOCUS_POSITION}, but automatic playback failed (${error.message}). Use the video controls to start it.`
        );
      }
    }

    if (!isCurrentLoad(video)) return;

    if (state.videoTimer) {
      clearInterval(state.videoTimer);
    }

    state.videoTimer = setInterval(() => {

      if (state.mode === "video") {
        sampleCurrentMedia();
      }

    }, 250);
  };


  video.onerror = () => {
    if (!isCurrentLoad(video)) return;

    const detail = video.error
      ? ` (media error ${video.error.code})`
      : "";

    restoreSampleAfterMediaError(
      loadToken,
      `This video could not be decoded${detail}. Try MP4 (H.264) or WebM. The sample scene has been restored.`
    );
  };

  video.src = mediaURL;
  video.load();
}


/* ==========================================
   EVENT LISTENERS
========================================== */

$("startCamera").addEventListener(
  "click",
  startCamera
);

$("stopCamera").addEventListener(
  "click",
  stopCamera
);


$("mediaUpload").addEventListener(
  "change",
  event => {
    const file = event.target.files[0];
    event.target.value = "";
    loadMedia(file);
  }
);


$("useSample").addEventListener(
  "click",
  () => {

    state.mediaLoadToken++;
    clearMediaSources();

    createSampleScene();

    setStatus(
      `Sample scene restored at offset +${INITIAL_DEFOCUS_POSITION}. Run autofocus to bring it to zero.`
    );

  }
);


$("defocusSlider").addEventListener(
  "input",
  event => {

    state.lensPosition = Number(event.target.value);

    setPdafReadyState();
    updateModel();
    setStatus(state.lensPosition === 0
      ? `Lens is at zero. Press Run autofocus to start from offset +${INITIAL_DEFOCUS_POSITION} and watch it return to focus.`
      : `Virtual lens offset ${state.lensPosition >= 0 ? "+" : ""}${state.lensPosition.toFixed(2)}; preview blur ${state.blur.toFixed(2)} px. Run autofocus to return to zero.`
    );

  }
);


$("runFocus").addEventListener(
  "click",
  runAutofocus
);


$("resetExperiment").addEventListener(
  "click",
  resetExperiment
);


/* ==========================================
   CLEAN UP
========================================== */

window.addEventListener(
  "beforeunload",
  () => {

    stopCamera();

    if (state.objectURL) {

      URL.revokeObjectURL(state.objectURL);
    }

  }
);


/* ==========================================
   INITIALISE
========================================== */

createSampleScene();

$("defocusSlider").value = INITIAL_DEFOCUS_POSITION;

$("blurSlider").value = INITIAL_DEFOCUS_POSITION;

updateModel();
setPdafReadyState();


/* ==========================================
   EXPERIMENT 2 — PIXEL-PROCESSING WALKTHROUGH
========================================== */

const ocrState = {
  source: null,
  knownText: null,
  builderDirty: false,
  blur: 0,
  threshold: 8,
  thresholdMode: "adaptive",
  thresholds: { adaptive: 8, global: 150 },
  noisePasses: 0,
  pipeline: null
};

function medianNumber(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function imageDataFromMask(mask, width, height) {
  const image = new ImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] ? 0 : 255;
    const offset = i * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  return image;
}

function convertToGray(source) {
  const output = new ImageData(source.width, source.height);
  const input = source.data;

  for (let i = 0; i < input.length; i += 4) {
    const brightness = Math.round(
      0.299 * input[i] +
      0.587 * input[i + 1] +
      0.114 * input[i + 2]
    );
    output.data[i] = brightness;
    output.data[i + 1] = brightness;
    output.data[i + 2] = brightness;
    output.data[i + 3] = 255;
  }

  return output;
}

function medianDenoise(source) {
  let current = source;
  const width = source.width;
  const height = source.height;

  for (let pass = 0; pass < ocrState.noisePasses; pass++) {
    const output = new ImageData(width, height);
    const samples = new Uint8Array(9);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sampleIndex = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const sampleY = Math.max(0, Math.min(height - 1, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const sampleX = Math.max(0, Math.min(width - 1, x + dx));
            samples[sampleIndex++] =
              current.data[(sampleY * width + sampleX) * 4];
          }
        }

        samples.sort();
        const offset = (y * width + x) * 4;
        const value = samples[4];
        output.data[offset] = value;
        output.data[offset + 1] = value;
        output.data[offset + 2] = value;
        output.data[offset + 3] = 255;
      }
    }

    current = output;
  }

  return current;
}

function histogramMedian(histogram, count) {
  const midpoint = Math.ceil(count / 2);
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value++) {
    accumulated += histogram[value];
    if (accumulated >= midpoint) return value;
  }
  return 255;
}

function estimateInkPolarity(grayImage) {
  const { width, height, data } = grayImage;
  const borderSize = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  const borderHistogram = new Uint32Array(256);
  let borderCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x >= borderSize &&
        x < width - borderSize &&
        y >= borderSize &&
        y < height - borderSize
      ) {
        continue;
      }
      const brightness = data[(y * width + x) * 4];
      borderHistogram[brightness]++;
      borderCount++;
    }
  }

  const background = histogramMedian(borderHistogram, borderCount);
  let darkerInk = 0;
  let lighterInk = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const difference = data[pixel * 4] - background;
    if (difference < -6) darkerInk -= difference;
    if (difference > 6) lighterInk += difference;
  }

  return lighterInk > darkerInk ? "light" : "dark";
}

function thresholdImage(grayImage) {
  const width = grayImage.width;
  const height = grayImage.height;
  const mask = new Uint8Array(width * height);
  const pixels = grayImage.data;
  const polarity = estimateInkPolarity(grayImage);
  if (ocrState.thresholdMode === "global") {
    const threshold = ocrState.threshold;
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const brightness = pixels[pixel * 4];
      mask[pixel] = polarity === "dark"
        ? Number(brightness < threshold)
        : Number(brightness > threshold);
    }
  } else {
    const stride = width + 1;
    const integral = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += pixels[(y * width + x) * 4];
        integral[(y + 1) * stride + x + 1] =
          integral[y * stride + x + 1] + rowSum;
      }
    }

    const radius = Math.max(
      4,
      Math.min(18, Math.round(Math.min(width, height) / 40))
    );
    const offset = ocrState.threshold;
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - radius);
        const right = Math.min(width, x + radius + 1);
        const localSum =
          integral[bottom * stride + right] -
          integral[top * stride + right] -
          integral[bottom * stride + left] +
          integral[top * stride + left];
        const localArea = (right - left) * (bottom - top);
        const localMean = localSum / localArea;
        const localCutoff = polarity === "dark"
          ? localMean - offset
          : localMean + offset;
        const brightness = pixels[(y * width + x) * 4];
        mask[y * width + x] = polarity === "dark"
          ? Number(brightness < localCutoff)
          : Number(brightness > localCutoff);
      }
    }
  }

  return { mask, image: imageDataFromMask(mask, width, height), polarity };
}

function findConnectedComponents(mask, width, height) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components = [];
  const minimumArea = Math.max(3, Math.round(total * 0.000004));

  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let xMin = width;
    let yMin = height;
    let xMax = -1;
    let yMax = -1;

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const position = queue[head++];
      const x = position % width;
      const y = Math.floor(position / width);
      xMin = Math.min(xMin, x);
      yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x);
      yMax = Math.max(yMax, y);

      for (let dy = -1; dy <= 1; dy++) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;

        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;

          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    if (tail < minimumArea) continue;
    const box = {
      x0: xMin,
      y0: yMin,
      x1: xMax + 1,
      y1: yMax + 1,
      area: tail
    };
    const boxWidth = box.x1 - box.x0;
    const boxHeight = box.y1 - box.y0;
    if (tail > total * 0.25 || (boxWidth > width * 0.95 && boxHeight > height * 0.7)) {
      continue;
    }
    components.push(box);
  }

  return components;
}

function groupComponentsIntoLines(components) {
  if (!components.length) return [];

  const typicalHeight = medianNumber(
    components.map(box => box.y1 - box.y0).filter(height => height > 2)
  ) || 12;
  const ordered = components.slice().sort((a, b) => {
    const centerA = (a.y0 + a.y1) / 2;
    const centerB = (b.y0 + b.y1) / 2;
    return centerA - centerB || a.x0 - b.x0;
  });
  const lines = [];

  for (const component of ordered) {
    const center = (component.y0 + component.y1) / 2;
    const componentHeight = component.y1 - component.y0;
    let bestLine = null;
    let bestDistance = Infinity;

    for (const line of lines) {
      const overlap = Math.max(
        0,
        Math.min(component.y1, line.y1) - Math.max(component.y0, line.y0)
      );
      const overlapRatio = overlap /
        Math.max(1, Math.min(componentHeight, line.y1 - line.y0));
      const distance = Math.abs(center - line.center);
      const tolerance = Math.max(
        typicalHeight * 0.48,
        Math.min(componentHeight, line.y1 - line.y0) * 0.3
      );

      if ((overlapRatio >= 0.2 || distance <= tolerance) && distance < bestDistance) {
        bestLine = line;
        bestDistance = distance;
      }
    }

    if (!bestLine) {
      bestLine = {
        y0: component.y0,
        y1: component.y1,
        center,
        components: []
      };
      lines.push(bestLine);
    }

    bestLine.components.push(component);
    bestLine.y0 = Math.min(bestLine.y0, component.y0);
    bestLine.y1 = Math.max(bestLine.y1, component.y1);
    bestLine.center = (bestLine.y0 + bestLine.y1) / 2;
  }

  lines.sort((a, b) => a.y0 - b.y0);
  for (const line of lines) {
    line.components.sort((a, b) => a.x0 - b.x0);
  }

  return lines;
}

function mergeSmallVerticalFragments(line, typicalHeight) {
  const boxes = line.components.map(box => ({ ...box }));
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const left = boxes[i];
        const right = boxes[j];
        if (right.x0 > left.x1 + typicalHeight * 0.3) break;
        const overlapX = Math.max(
          0,
          Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0)
        );
        const smallerWidth = Math.max(
          1,
          Math.min(left.x1 - left.x0, right.x1 - right.x0)
        );
        const gapY = Math.max(
          0,
          Math.max(left.y0, right.y0) - Math.min(left.y1, right.y1)
        );
        const smallFragment = Math.min(
          left.y1 - left.y0,
          right.y1 - right.y0
        ) < typicalHeight * 0.45;

        if (
          smallFragment &&
          overlapX / smallerWidth >= 0.35 &&
          gapY <= typicalHeight * 0.3
        ) {
          boxes[i] = {
            x0: Math.min(left.x0, right.x0),
            y0: Math.min(left.y0, right.y0),
            x1: Math.max(left.x1, right.x1),
            y1: Math.max(left.y1, right.y1),
            area: left.area + right.area
          };
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }

  return boxes.sort((a, b) => a.x0 - b.x0);
}

function getColumnInk(mask, width, box, column) {
  let count = 0;
  const x = box.x0 + column;
  for (let y = box.y0; y < box.y1; y++) {
    if (mask[y * width + x]) count++;
  }
  return count;
}

function splitWideComponent(box, mask, width, typicalHeight) {
  const maximumWidth = typicalHeight * 1.4;
  const minimumPartWidth = Math.max(2, typicalHeight * 0.24);
  const pending = [box];
  const result = [];

  while (pending.length) {
    const current = pending.pop();
    const currentWidth = current.x1 - current.x0;
    if (currentWidth <= maximumWidth) {
      result.push(current);
      continue;
    }

    const first = Math.ceil(currentWidth * 0.3);
    const last = Math.floor(currentWidth * 0.7);
    let cut = -1;
    let lowestInk = Infinity;

    for (let column = first; column <= last; column++) {
      if (
        column < minimumPartWidth ||
        currentWidth - column < minimumPartWidth
      ) {
        continue;
      }
      const ink = getColumnInk(mask, width, current, column);
      if (ink < lowestInk) {
        lowestInk = ink;
        cut = column;
      }
    }

    if (cut < 0 || lowestInk > Math.max(1, typicalHeight * 0.22)) {
      result.push(current);
      continue;
    }

    const absoluteCut = current.x0 + cut;
    pending.push(
      { ...current, x0: absoluteCut, area: current.area / 2 },
      { ...current, x1: absoluteCut, area: current.area / 2 }
    );
  }

  return result.sort((a, b) => a.x0 - b.x0);
}

function mergeTouchingGlyphFragments(boxes, mask, width, typicalHeight) {
  const merged = [];
  for (let index = 0; index < boxes.length; index++) {
    let current = { ...boxes[index] };
    while (index + 1 < boxes.length) {
      const next = boxes[index + 1];
      const gap = next.x0 - current.x1;
      const currentWidth = current.x1 - current.x0;
      const nextWidth = next.x1 - next.x0;
      const overlapY = Math.max(
        0,
        Math.min(current.y1, next.y1) - Math.max(current.y0, next.y0)
      );
      const shorterHeight = Math.max(
        1,
        Math.min(current.y1 - current.y0, next.y1 - next.y0)
      );
      const narrowPart = Math.min(currentWidth, nextWidth) <= typicalHeight * 0.75;
      const combinedWidth = next.x1 - current.x0;
      const union = {
        x0: Math.min(current.x0, next.x0),
        y0: Math.min(current.y0, next.y0),
        x1: Math.max(current.x1, next.x1),
        y1: Math.max(current.y1, next.y1),
        area: current.area + next.area
      };

      if (
        gap > 1 ||
        !narrowPart ||
        overlapY / shorterHeight < 0.75 ||
        combinedWidth > typicalHeight * 2.1
      ) {
        break;
      }

      current = union;
      index++;
    }
    merged.push(current);
  }
  return merged;
}

function segmentGlyphs(mask, width, components) {
  const lines = groupComponentsIntoLines(components);

  for (const line of lines) {
    const merged = mergeSmallVerticalFragments(
      line,
      medianNumber(line.components.map(box => box.y1 - box.y0)) || 12
    );
    const typicalHeight = medianNumber(
      merged.map(box => box.y1 - box.y0).filter(value => value > 2)
    ) || 12;

    const joined = mergeTouchingGlyphFragments(
      merged,
      mask,
      width,
      typicalHeight
    );
    line.glyphs = joined
      .flatMap(box => splitWideComponent(box, mask, width, typicalHeight))
      .filter(box => box.x1 > box.x0 && box.y1 > box.y0);
  }

  return lines.filter(line => line.glyphs.length);
}

function processOcrImage(source) {
  const grayscale = convertToGray(source);
  const filteredGray = medianDenoise(grayscale);
  const thresholded = thresholdImage(filteredGray);
  const components = findConnectedComponents(
    thresholded.mask,
    source.width,
    source.height
  );
  const lines = segmentGlyphs(
    thresholded.mask,
    source.width,
    components
  );
  const glyphCount = lines.reduce((total, line) => total + line.glyphs.length, 0);

  return {
    grayscale: filteredGray,
    binary: thresholded.image,
    polarity: thresholded.polarity,
    lines,
    glyphCount
  };
}

function hexToOcrHsv(hex) {
  const values = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!values) throw new Error(`Invalid colour value: ${hex}`);
  const red = parseInt(values[1], 16) / 255;
  const green = parseInt(values[2], 16) / 255;
  const blue = parseInt(values[3], 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  let hue = 0;

  if (difference) {
    if (maximum === red) hue = 60 * (((green - blue) / difference) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / difference + 2);
    else hue = 60 * ((red - green) / difference + 4);
  }

  return {
    hue: (hue + 360) % 360,
    saturation: maximum === 0 ? 0 : difference / maximum,
    brightness: maximum
  };
}

function ocrHsvToHex(hue, saturation, brightness) {
  const chroma = brightness * saturation;
  const sector = hue / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = brightness - chroma;
  let rgb;

  if (sector < 1) rgb = [chroma, secondary, 0];
  else if (sector < 2) rgb = [secondary, chroma, 0];
  else if (sector < 3) rgb = [0, chroma, secondary];
  else if (sector < 4) rgb = [0, secondary, chroma];
  else if (sector < 5) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];

  return `#${rgb.map(value => Math.round((value + offset) * 255)
    .toString(16).padStart(2, "0")).join("")}`;
}

function initializeOcrColorPicker(control) {
  const colorInput = control.querySelector('input[type="hidden"]');
  const hueSlider = control.querySelector(".ocr-color-hue");
  const field = control.querySelector(".ocr-color-field");
  const marker = control.querySelector(".ocr-color-marker");
  const output = $(`${colorInput.id}Value`);
  const name = control.dataset.colorName;
  const state = hexToOcrHsv(colorInput.value);

  function updateColor(markDirty) {
    state.hue = Number(hueSlider.value);
    const color = ocrHsvToHex(state.hue, state.saturation, state.brightness);
    colorInput.value = color;
    output.textContent = color.toUpperCase();
    field.style.setProperty("--ocr-hue", String(state.hue));
    marker.style.left = `${state.saturation * 100}%`;
    marker.style.top = `${(1 - state.brightness) * 100}%`;
    field.setAttribute(
      "aria-label",
      `${name}: saturation ${Math.round(state.saturation * 100)}%, ` +
      `brightness ${Math.round(state.brightness * 100)}%`
    );
    if (markDirty) markOcrBuilderDirty();
  }

  function selectColorAt(clientX, clientY) {
    const bounds = field.getBoundingClientRect();
    state.saturation = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    state.brightness = 1 - Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
    updateColor(true);
  }

  hueSlider.value = String(Math.round(state.hue));
  hueSlider.addEventListener("input", () => updateColor(true));
  field.addEventListener("pointerdown", event => {
    event.preventDefault();
    field.focus();
    selectColorAt(event.clientX, event.clientY);
  });
  field.addEventListener("pointermove", event => {
    if (event.buttons) selectColorAt(event.clientX, event.clientY);
  });
  field.addEventListener("keydown", event => {
    const step = event.shiftKey ? 0.08 : 0.02;
    if (event.key === "ArrowLeft") state.saturation -= step;
    else if (event.key === "ArrowRight") state.saturation += step;
    else if (event.key === "ArrowDown") state.brightness -= step;
    else if (event.key === "ArrowUp") state.brightness += step;
    else return;
    event.preventDefault();
    state.saturation = Math.max(0, Math.min(1, state.saturation));
    state.brightness = Math.max(0, Math.min(1, state.brightness));
    updateColor(true);
  });

  updateColor(false);
}

function showOcrCanvasPlaceholder(canvasId, message) {
    const canvas = $(canvasId);
    canvas.width = 480;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not display the OCR canvas.");
    context.fillStyle = "#f4f0e7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#77766d";
    context.font = "14px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(message, canvas.width / 2, canvas.height / 2, canvas.width - 40);
  }

function clearOcrWalkthrough(message) {
    ocrState.pipeline = null;
    $("ocrKnownText").textContent =
      "Run the pixel walkthrough to show the identified text.";
    $("ocrCopy").disabled = true;
    $("ocrCopy").textContent = "Copy text";
    showOcrCanvasPlaceholder("ocrGrayCanvas", "Run the walkthrough to see grayscale pixels");
    showOcrCanvasPlaceholder("ocrBinaryCanvas", "Run the walkthrough to see thresholded pixels");
    showOcrCanvasPlaceholder("ocrBoundsCanvas", "Run the walkthrough to see detected regions");
    showOcrCanvasPlaceholder("ocrStepGrayCanvas", "Run the walkthrough to see your grayscale pixels");
    showOcrCanvasPlaceholder("ocrStepBinaryCanvas", "Run the walkthrough to see your thresholded pixels");
    showOcrCanvasPlaceholder("ocrStepBoundsCanvas", "Run the walkthrough to see your detected regions");
    $("ocrRunWalkthrough").disabled = !ocrState.source || ocrState.builderDirty;
    if (message) $("ocrStatus").textContent = message;
  }

function setOcrSourceImage(imageData, knownText) {
    if (!imageData.width || !imageData.height) {
      throw new Error("The generated image has no readable pixels.");
    }
    ocrState.source = imageData;
    ocrState.knownText = knownText;
    ocrState.builderDirty = false;
    ocrState.blur = 0;

    const originalCanvas = $("ocrOriginalCanvas");
    originalCanvas.width = imageData.width;
    originalCanvas.height = imageData.height;
    const originalContext = originalCanvas.getContext("2d");
    if (!originalContext) throw new Error("Could not display the original image.");
    originalContext.putImageData(imageData, 0, 0);

    $("ocrBlur").value = "0";
    $("ocrBlurValue").textContent = "0 px · sharp";
    $("ocrImageInfo").textContent = "GENERATED TEXT";
    drawOcrBlurredPreview(false);
    clearOcrWalkthrough();
    $("ocrStatus").textContent =
      "Sharp lesson image generated. Adjust blur, then run the pixel walkthrough.";
  }

function drawOcrBlurredPreview(invalidate = true) {
    if (!ocrState.source) return;
    const originalCanvas = $("ocrOriginalCanvas");
    const blurredCanvas = $("ocrBlurredCanvas");
    const blur = Number($("ocrBlur").value);
    blurredCanvas.width = originalCanvas.width;
    blurredCanvas.height = originalCanvas.height;
    const context = blurredCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not create the blurred image preview.");

    context.clearRect(0, 0, blurredCanvas.width, blurredCanvas.height);
    context.filter = blur === 0 ? "none" : `blur(${blur}px)`;
    context.drawImage(originalCanvas, 0, 0);
    context.filter = "none";
    const stepInput = $("ocrStepInputCanvas");
    stepInput.width = blurredCanvas.width;
    stepInput.height = blurredCanvas.height;
    const stepInputContext = stepInput.getContext("2d");
    if (!stepInputContext) throw new Error("Could not display the image in the explanation.");
    stepInputContext.drawImage(blurredCanvas, 0, 0);
    ocrState.blur = blur;
    $("ocrBlurValue").textContent = blur === 0
      ? "0 px · sharp"
      : `${blur.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} px`;

    if (invalidate) {
      clearOcrWalkthrough(
        ocrState.builderDirty
          ? "Generate the changed text settings before viewing the pixel stages."
          : "Blur updated. Run the pixel walkthrough to refresh the stages."
      );
    }
  }

function splitLongOcrWord(context, word, maxWidth) {
    const chunks = [];
    let chunk = "";
    for (const character of word) {
      const candidate = chunk + character;
      if (chunk && context.measureText(candidate).width > maxWidth) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }

function wrapOcrText(context, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split(/\r?\n/)) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }

      let line = "";
      for (const word of words) {
        if (context.measureText(word).width > maxWidth) {
          if (line) lines.push(line);
          const chunks = splitLongOcrWord(context, word, maxWidth);
          lines.push(...chunks.slice(0, -1));
          line = chunks[chunks.length - 1] || "";
          continue;
        }
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  }

function generateOcrTextImage() {
    const text = $("ocrTextInput").value.replace(/\s+/g, " ").trim();
    if (!text) {
      $("ocrStatus").textContent = "Enter some text before generating an image.";
      $("ocrTextInput").focus();
      return;
    }
    $("ocrTextInput").value = text;

    const canvas = document.createElement("canvas");
    canvas.width = 960;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      $("ocrStatus").textContent = "This browser could not create the text canvas.";
      return;
    }

    const fontSize = Number($("ocrFontSize").value);
    const family = $("ocrFont").value;
    const padding = 54;
    const lineHeight = Math.round(fontSize * 1.48);
    context.font = `700 ${fontSize}px "${family}"`;
    context.textAlign = "left";
    context.textBaseline = "top";
    const lines = wrapOcrText(context, text, canvas.width - padding * 2);
    canvas.height = Math.max(190, padding * 2 + lines.length * lineHeight);
    context.fillStyle = $("ocrBackgroundColor").value;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = $("ocrTextColor").value;
    context.font = `700 ${fontSize}px "${family}"`;
    lines.forEach((line, index) => {
      context.fillText(line, padding, padding + index * lineHeight);
    });

    try {
      setOcrSourceImage(
        context.getImageData(0, 0, canvas.width, canvas.height),
        text
      );
    } catch (error) {
      console.error("Could not generate the OCR learning image.", error);
      $("ocrStatus").textContent =
        error instanceof Error ? error.message : "The text image could not be generated.";
    }
  }

function markOcrBuilderDirty() {
    $("ocrFontSizeValue").textContent = `${$("ocrFontSize").value} px`;
    if (!ocrState.source) return;
    ocrState.builderDirty = true;
    clearOcrWalkthrough(
      "Text or appearance changed. Generate a new image before the walkthrough."
    );
  }

function configureOcrThresholdControl(mode) {
    const threshold = $("ocrThreshold");
    const adaptive = mode === "adaptive";
    $("ocrThresholdLabel").textContent = adaptive
      ? "Threshold offset"
      : "Global cutoff";
    $("ocrThresholdHint").textContent = adaptive
      ? "Offset adjusts the nearby brightness cutoff; for dark ink, cutoff = local mean − offset."
      : "One brightness boundary for the whole image; pixels on the text side become ink.";
    threshold.min = adaptive ? "-20" : "0";
    threshold.max = adaptive ? "40" : "255";
    threshold.value = String(ocrState.thresholds[mode]);
    $("ocrThresholdValue").textContent = String(threshold.value);
    ocrState.thresholdMode = mode;
  }

function updateOcrThresholdSetting() {
    const mode = $("ocrThresholdMode").value;
    ocrState.thresholdMode = mode;
    ocrState.threshold = Number($("ocrThreshold").value);
    ocrState.thresholds[mode] = ocrState.threshold;
    ocrState.noisePasses = Number($("ocrNoise").value);
    $("ocrThresholdValue").textContent = String(ocrState.threshold);
    $("ocrNoiseValue").textContent = ocrState.noisePasses === 0
      ? "Off"
      : `${ocrState.noisePasses} pass${ocrState.noisePasses === 1 ? "" : "es"}`;
  }

function drawOcrCharacterBoxes() {
    const sourceCanvas = $("ocrBlurredCanvas");
    const canvas = $("ocrBoundsCanvas");
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the detected character boxes.");
    context.drawImage(sourceCanvas, 0, 0);
    context.lineWidth = Math.max(1, canvas.width / 700);
    context.font = `700 ${Math.max(11, Math.min(24, canvas.width / 35))}px Arial`;
    context.textBaseline = "bottom";

    let regionNumber = 0;
    for (const line of ocrState.pipeline.lines) {
      for (const glyph of line.glyphs) {
        regionNumber++;
        context.strokeStyle = "#b69761";
        context.strokeRect(
          glyph.x0,
          glyph.y0,
          glyph.x1 - glyph.x0,
          glyph.y1 - glyph.y0
        );
        const label = `R${regionNumber}`;
        const labelY = Math.max(12, glyph.y0 - 2);
        context.fillStyle = "rgba(40, 39, 34, .88)";
        context.fillRect(
          glyph.x0,
          labelY - 13,
          context.measureText(label).width + 4,
          15
        );
        context.fillStyle = "#fbf9f4";
        context.fillText(label, glyph.x0 + 2, labelY);
      }
    }
  }

async function runOcrPixelWalkthrough() {
    if (!ocrState.source || ocrState.builderDirty) return;
    $("ocrRunWalkthrough").disabled = true;
    $("ocrStatus").textContent = "Processing the current blurred canvas pixels…";
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      const blurredCanvas = $("ocrBlurredCanvas");
      const context = blurredCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not read the blurred image canvas.");
      const currentPixels = context.getImageData(
        0,
        0,
        blurredCanvas.width,
        blurredCanvas.height
      );
      updateOcrThresholdSetting();
      const pipeline = processOcrImage(currentPixels);
      ocrState.pipeline = pipeline;
      $("ocrGrayCanvas").width = currentPixels.width;
      $("ocrGrayCanvas").height = currentPixels.height;
      const grayContext = $("ocrGrayCanvas").getContext("2d");
      if (!grayContext) throw new Error("Could not display the grayscale image.");
      grayContext.putImageData(pipeline.grayscale, 0, 0);
      const stepGrayCanvas = $("ocrStepGrayCanvas");
      stepGrayCanvas.width = currentPixels.width;
      stepGrayCanvas.height = currentPixels.height;
      const stepGrayContext = stepGrayCanvas.getContext("2d");
      if (!stepGrayContext) throw new Error("Could not show grayscale pixels in the explanation.");
      stepGrayContext.putImageData(pipeline.grayscale, 0, 0);
      $("ocrBinaryCanvas").width = currentPixels.width;
      $("ocrBinaryCanvas").height = currentPixels.height;
      const binaryContext = $("ocrBinaryCanvas").getContext("2d");
      if (!binaryContext) throw new Error("Could not display the thresholded image.");
      binaryContext.putImageData(pipeline.binary, 0, 0);
      const stepBinaryCanvas = $("ocrStepBinaryCanvas");
      stepBinaryCanvas.width = currentPixels.width;
      stepBinaryCanvas.height = currentPixels.height;
      const stepBinaryContext = stepBinaryCanvas.getContext("2d");
      if (!stepBinaryContext) throw new Error("Could not show thresholded pixels in the explanation.");
      stepBinaryContext.putImageData(pipeline.binary, 0, 0);
      drawOcrCharacterBoxes();
      const stepBoundsCanvas = $("ocrStepBoundsCanvas");
      stepBoundsCanvas.width = $("ocrBoundsCanvas").width;
      stepBoundsCanvas.height = $("ocrBoundsCanvas").height;
      const stepBoundsContext = stepBoundsCanvas.getContext("2d");
      if (!stepBoundsContext) throw new Error("Could not show regions in the explanation.");
      stepBoundsContext.drawImage($("ocrBoundsCanvas"), 0, 0);
      $("ocrKnownText").textContent = ocrState.knownText;
      $("ocrCopy").disabled = !ocrState.knownText;
      const polarity = pipeline.polarity === "dark"
        ? "dark text on light background"
        : "light text on dark background";
      const regionLabel = pipeline.glyphCount === 1 ? "region" : "regions";
      $("ocrStatus").textContent =
        `${pipeline.glyphCount} image ${regionLabel} outlined; detected ${polarity}. ` +
        "The displayed text is the known input, not a pixel-based recognition.";
    } catch (error) {
      console.error("OCR pixel walkthrough failed.", error);
      clearOcrWalkthrough(
        error instanceof Error
          ? `Image processing failed: ${error.message}`
          : "Image processing failed. Generate another text image."
      );
    } finally {
      $("ocrRunWalkthrough").disabled = !ocrState.source || ocrState.builderDirty;
    }
  }

async function copyKnownText() {
    if (!ocrState.pipeline || !ocrState.knownText) return;
    try {
      await navigator.clipboard.writeText(ocrState.knownText);
      $("ocrCopy").textContent = "Copied!";
      $("ocrStatus").textContent = "Known example text copied.";
    } catch (error) {
      console.error("Clipboard copy was unavailable.", error);
      $("ocrStatus").textContent =
        "Clipboard access was blocked. Select the known example text and copy it manually.";
    }
  }

  $("ocrGenerate").addEventListener("click", generateOcrTextImage);
  document.querySelectorAll("[data-ocr-phrase]").forEach(button => {
    button.addEventListener("click", () => {
      $("ocrTextInput").value = button.dataset.ocrPhrase;
      generateOcrTextImage();
    });
  });
  ["ocrTextInput", "ocrFont", "ocrFontSize"]
    .forEach(id => {
      $(id).addEventListener("input", markOcrBuilderDirty);
      $(id).addEventListener("change", markOcrBuilderDirty);
    });
  document.querySelectorAll("[data-ocr-color-picker]")
    .forEach(initializeOcrColorPicker);
  $("ocrBlur").addEventListener("input", () => drawOcrBlurredPreview());
  $("ocrBlurReset").addEventListener("click", () => {
    $("ocrBlur").value = "0";
    drawOcrBlurredPreview();
  });
  $("ocrThresholdMode").addEventListener("change", event => {
    ocrState.thresholds[ocrState.thresholdMode] =
      Number($("ocrThreshold").value);
    configureOcrThresholdControl(event.target.value);
    updateOcrThresholdSetting();
    clearOcrWalkthrough("Threshold method changed. Run the pixel walkthrough again.");
  });
  $("ocrThreshold").addEventListener("input", () => {
    $("ocrThresholdValue").textContent = $("ocrThreshold").value;
  });
  $("ocrThreshold").addEventListener("change", () => {
    updateOcrThresholdSetting();
    clearOcrWalkthrough("Threshold changed. Run the pixel walkthrough again.");
  });
  $("ocrNoise").addEventListener("input", () => {
    $("ocrNoiseValue").textContent = Number($("ocrNoise").value) === 0
      ? "Off"
      : `${$("ocrNoise").value} pass${$("ocrNoise").value === "1" ? "" : "es"}`;
  });
  $("ocrNoise").addEventListener("change", () => {
    updateOcrThresholdSetting();
    clearOcrWalkthrough("Median filter changed. Run the pixel walkthrough again.");
  });
  $("ocrRunWalkthrough").addEventListener("click", runOcrPixelWalkthrough);
  $("ocrCopy").addEventListener("click", copyKnownText);

  for (const canvasId of [
    "ocrGrayCanvas",
    "ocrBinaryCanvas",
    "ocrBoundsCanvas",
    "ocrStepGrayCanvas",
    "ocrStepBinaryCanvas",
    "ocrStepBoundsCanvas"
  ]) {
    showOcrCanvasPlaceholder(canvasId, "Generate an image to begin");
  }
  updateOcrThresholdSetting();
  generateOcrTextImage();

