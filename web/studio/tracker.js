/**
 * SVGTuber Studio MediaPipe Face Tracker & WebSocket Client
 * Includes background tab keep-alive (Web Worker ticker + Web Audio API)
 */

import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("webcam");
const canvas = document.getElementById("landmark-canvas");
const canvasCtx = canvas.getContext("2d");
const cameraSelect = document.getElementById("camera-select");
const btnToggleCamera = document.getElementById("btn-toggle-camera");
const btnCalibrate = document.getElementById("btn-calibrate");
const trackingStatus = document.getElementById("tracking-status");
const fpsDisplay = document.getElementById("fps-display");

// Audio Controls & VU Meter
const micSelect = document.getElementById("mic-select");
const btnToggleMic = document.getElementById("btn-toggle-mic");
const modeSelect = document.getElementById("mode-select");
const settingsModeSelect = document.getElementById("settings-mode-select");
const vuMeterBar = document.getElementById("vu-meter-bar");
const noiseGateMarker = document.getElementById("noise-gate-marker");
const valVuMeter = document.getElementById("val-vu-meter");

// Gauges
const gaugeYaw = document.getElementById("gauge-yaw");
const gaugePitch = document.getElementById("gauge-pitch");
const gaugeRoll = document.getElementById("gauge-roll");
const valYaw = document.getElementById("val-yaw");
const valPitch = document.getElementById("val-pitch");
const valRoll = document.getElementById("val-roll");

const gaugeBlinkL = document.getElementById("gauge-blink-l");
const gaugeBlinkR = document.getElementById("gauge-blink-r");
const gaugeMouthOpen = document.getElementById("gauge-mouth-open");
const gaugeSmile = document.getElementById("gauge-smile");
const valSmile = document.getElementById("val-smile");
const smileThresholdMarker = document.getElementById("smile-threshold-marker");

let faceLandmarker = null;
let runningMode = "VIDEO";
let webcamRunning = false;
let socket = null;
let reconnectTimer = null;
let lastVideoTime = -1;
let frameCount = 0;
let lastFpsTime = performance.now();
let drawingUtils = null;

let isProcessing = false;
let animFrameId = null;
let tickerWorker = null;
let audioContext = null;

// Audio Streaming State
let micStream = null;
let micSource = null;
let analyserNode = null;
let audioDataArray = null;
let micRunning = false;
let smoothedAudioVol = 0;

// Calibration reference state
let latestRawPose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
let latestRawBlendshapes = {};
let neutralPose = { yaw: 0, pitch: 0, roll: 0 };
let neutralSmile = 0;
let neutralMouth = 0;
let isCalibrated = false;

// Inline Web Worker ticker to maintain 60 FPS in background tabs
function initTickerWorker() {
  if (tickerWorker) return;
  try {
    const workerBlob = new Blob([`
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!timer) {
            timer = setInterval(function() {
              self.postMessage('tick');
            }, 16);
          }
        } else if (e.data === 'stop') {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      };
    `], { type: 'application/javascript' });

    tickerWorker = new Worker(URL.createObjectURL(workerBlob));
    tickerWorker.onmessage = () => {
      if (webcamRunning) {
        // In background tabs, requestAnimationFrame is paused by the browser.
        // The worker tick steps the detection loop without screen redraw.
        if (document.hidden) {
          processFrame(false);
        }
      } else if (micRunning) {
        if (document.hidden) {
          processAudioOnlyFrame(false);
        }
      }
    };
  } catch (err) {
    console.warn("[Studio Tracker] Could not initialize background worker ticker:", err);
  }
}

// AudioContext & silent keep-alive to prevent Chromium from throttling/discarding background tab
function getOrCreateAudioContext() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0.0; // Completely silent
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  } catch (e) {
    console.warn("[Studio Tracker] Web Audio keep-alive error:", e);
  }
  return audioContext;
}

function stopAudioKeepAlive() {
  if (audioContext && !micRunning) {
    try {
      audioContext.close();
    } catch (e) {}
    audioContext = null;
  }
}

// Enumerate audio input devices
async function populateAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(d => d.kind === "audioinput");
    if (micSelect) {
      const currentVal = micSelect.value;
      micSelect.innerHTML = "";
      if (audioDevices.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Default Microphone";
        micSelect.appendChild(option);
      } else {
        audioDevices.forEach((device, i) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${i + 1}`;
          micSelect.appendChild(option);
        });
        if (currentVal) micSelect.value = currentVal;
      }
    }
  } catch (err) {
    console.warn("[Studio Tracker] Could not enumerate audio devices:", err);
  }
}

// Web Audio API Microphone Capture
async function toggleMic() {
  if (micRunning) {
    stopMic();
    return;
  }
  await startMic();
}

async function startMic() {
  const ctx = getOrCreateAudioContext();
  const deviceId = micSelect ? micSelect.value : "";
  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  };

  try {
    micStream = await navigator.mediaDevices.getUserMedia(constraints);
    micSource = ctx.createMediaStreamSource(micStream);
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.2;
    micSource.connect(analyserNode);
    audioDataArray = new Float32Array(analyserNode.fftSize);

    micRunning = true;
    if (btnToggleMic) {
      btnToggleMic.textContent = "Stop Mic";
      btnToggleMic.classList.add("btn-danger");
    }

    await populateAudioDevices();

    if (tickerWorker) {
      tickerWorker.postMessage('start');
    }

    if (!webcamRunning) {
      startAudioOnlyLoop();
    }
  } catch (err) {
    console.error("[Studio Tracker] Microphone access error:", err);
    updateStatus(`Mic error: ${err.message}`, "status-warn");
  }
}

function stopMic() {
  micRunning = false;
  if (micSource) {
    try { micSource.disconnect(); } catch (e) {}
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  analyserNode = null;
  audioDataArray = null;
  smoothedAudioVol = 0;

  if (btnToggleMic) {
    btnToggleMic.textContent = "Start Mic";
    btnToggleMic.classList.remove("btn-danger");
  }
  if (vuMeterBar) vuMeterBar.style.width = "0%";
  if (valVuMeter) valVuMeter.textContent = "0%";

  if (!webcamRunning) {
    if (tickerWorker) tickerWorker.postMessage('stop');
    stopAudioKeepAlive();
    sendTrackingLoss({ volume: 0, isSpeaking: false });
  }
}

// Compute RMS Audio Volume & Speech Gate
function sampleAudio() {
  if (!micRunning || !analyserNode || !audioDataArray) {
    return null;
  }
  analyserNode.getFloatTimeDomainData(audioDataArray);
  let sum = 0;
  for (let i = 0; i < audioDataArray.length; i++) {
    const v = audioDataArray[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / audioDataArray.length);

  const decay = parseFloat(sliderDecaySmooth?.value || 0.10);
  if (rms > smoothedAudioVol) {
    smoothedAudioVol = rms; // instant attack
  } else {
    smoothedAudioVol = smoothedAudioVol * (1 - decay) + rms * decay; // smooth release
  }

  const micGain = parseFloat(sliderMicGain?.value || 1.5);
  const noiseGate = parseFloat(sliderNoiseGate?.value || 0.04);
  const isSpeaking = (smoothedAudioVol * micGain) >= noiseGate;

  return { active: true, volume: smoothedAudioVol, isSpeaking };
}

function updateAudioUI(audioState) {
  if (!vuMeterBar || !valVuMeter) return;
  if (!audioState || !audioState.active) {
    vuMeterBar.style.width = "0%";
    valVuMeter.textContent = "0%";
    vuMeterBar.style.background = "#4b5563";
    return;
  }
  const micGain = parseFloat(sliderMicGain?.value || 1.5);
  const noiseGate = parseFloat(sliderNoiseGate?.value || 0.04);

  const displayPercent = Math.min(100, Math.round(audioState.volume * micGain * 100));
  vuMeterBar.style.width = `${displayPercent}%`;
  valVuMeter.textContent = `${displayPercent}%`;

  if (audioState.isSpeaking) {
    vuMeterBar.style.background = "#22c55e"; // bright green
  } else {
    vuMeterBar.style.background = "#4b5563"; // gray below noise gate
  }

  if (noiseGateMarker) {
    const gatePercent = Math.min(100, Math.round(noiseGate * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}

function startAudioOnlyLoop() {
  function audioLoop() {
    if (!micRunning || webcamRunning) return;
    if (!document.hidden) {
      processAudioOnlyFrame(true);
    }
    requestAnimationFrame(audioLoop);
  }
  requestAnimationFrame(audioLoop);
}

function processAudioOnlyFrame(renderUI = true) {
  if (!micRunning) return;
  const now = performance.now();
  const audioState = sampleAudio();
  if (renderUI) {
    updateAudioUI(audioState);
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    const frame = {
      timestamp: now,
      present: false,
      audio: audioState
    };
    socket.send(JSON.stringify(frame));
  }
}

// Connect to SVGTuber Tracker WebSocket
function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws/tracker`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("[Studio Tracker] Connected to Go server.");
    updateStatus("Connected (Camera Offline)", "status-warn");
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "calibrated") {
        console.log("[Studio Tracker] Calibration confirmed by server.");
        showCalibratedFlash();
      }
    } catch (e) {}
  };

  socket.onclose = () => {
    updateStatus("Server Disconnected", "status-error");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  };

  socket.onerror = (err) => {
    console.error("[Studio Tracker] WebSocket error:", err);
    socket.close();
  };
}

function updateStatus(text, className) {
  if (trackingStatus) {
    trackingStatus.textContent = text;
    trackingStatus.className = `status-badge ${className}`;
  }
}

function showCalibratedFlash() {
  btnCalibrate.textContent = "✓ Calibrated!";
  btnCalibrate.style.background = "#22c55e";
  setTimeout(() => {
    btnCalibrate.textContent = "Set Neutral Pose";
    btnCalibrate.style.background = "";
  }, 1200);
}

// Initialize MediaPipe Vision Tasks
async function initMediaPipe() {
  try {
    updateStatus("Loading MediaPipe AI Model...", "status-warn");
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });

    drawingUtils = new DrawingUtils(canvasCtx);
    console.log("[Studio Tracker] MediaPipe FaceLandmarker initialized.");
    updateStatus("Model Ready. Start Camera.", "status-ok");
    btnToggleCamera.disabled = false;
    initTickerWorker();
    await populateCameraDevices();
    await populateAudioDevices();
  } catch (err) {
    console.error("[Studio Tracker] Failed to initialize MediaPipe:", err);
    updateStatus(`Error loading AI model: ${err.message}`, "status-error");
  }
}

async function populateCameraDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");
    cameraSelect.innerHTML = "";
    videoDevices.forEach((device, i) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${i + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) {
    console.warn("[Studio Tracker] Could not enumerate camera devices:", err);
  }
}

// Start / Stop Camera Stream
async function toggleCamera() {
  if (webcamRunning) {
    webcamRunning = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (micRunning) {
      startAudioOnlyLoop();
    } else {
      if (tickerWorker) {
        tickerWorker.postMessage('stop');
      }
      stopAudioKeepAlive();
    }

    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    btnToggleCamera.textContent = "Start Camera";
    btnToggleCamera.classList.remove("btn-danger");
    updateStatus(micRunning ? "Audio Lip-Sync Active" : "Camera Stopped", micRunning ? "status-ok" : "status-warn");
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    sendTrackingLoss();
    return;
  }

  const deviceId = cameraSelect.value;
  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 60 }
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      webcamRunning = true;
      btnToggleCamera.textContent = "Stop Camera";
      btnToggleCamera.classList.add("btn-danger");
      updateStatus("Tracking Active", "status-ok");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Start background keep-alive mechanisms
      getOrCreateAudioContext();
      if (tickerWorker) {
        tickerWorker.postMessage('start');
      }

      // Auto-start microphone if not running yet
      if (!micRunning) {
        startMic().catch(e => console.warn("[Studio Tracker] Auto-start mic:", e));
      }

      animFrameId = requestAnimationFrame(predictLoop);
    }, { once: true });
  } catch (err) {
    console.error("[Studio Tracker] Camera access error:", err);
    updateStatus(`Camera access denied: ${err.message}`, "status-error");
  }
}

// Extract Euler angles from MediaPipe 4x4 matrix
function extractEulerAngles(matrix) {
  if (!matrix || matrix.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  }
  const m00 = matrix[0], m10 = matrix[1], m20 = matrix[2];
  const m01 = matrix[4], m11 = matrix[5], m21 = matrix[6];
  const m02 = matrix[8], m12 = matrix[9], m22 = matrix[10];
  const m03 = matrix[12], m13 = matrix[13], m23 = matrix[14];

  // Tait-Bryan angles (YXZ order)
  const pitchRad = Math.asin(-Math.max(-1, Math.min(1, m12)));
  const yawRad = Math.atan2(m02, m22);
  const rollRad = Math.atan2(m10, m11);

  const radToDeg = 180 / Math.PI;

  return {
    yaw: yawRad * radToDeg,
    pitch: pitchRad * radToDeg,
    roll: rollRad * radToDeg,
    x: m03,
    y: m13,
    z: m23
  };
}

// Core Detection Function (can be called by rAF or by Worker tick in background)
function processFrame(renderUI = true) {
  if (!webcamRunning || !faceLandmarker || isProcessing) return;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;
  isProcessing = true;

  try {
    const results = faceLandmarker.detectForVideo(video, now);

    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // Blendshapes
      const blendshapes = {};
      if (results.faceBlendshapes && results.faceBlendshapes[0]) {
        results.faceBlendshapes[0].categories.forEach(c => {
          blendshapes[c.categoryName] = c.score;
        });
      }

      // Matrix & Euler angles
      let pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes[0]) {
        pose = extractEulerAngles(results.facialTransformationMatrixes[0].data);
      }

      // Sample Audio
      const audioState = sampleAudio();
      if (renderUI) {
        updateAudioUI(audioState);
      }

      // Stream to Go server
      if (socket && socket.readyState === WebSocket.OPEN) {
        const frame = {
          timestamp: now,
          present: true,
          yaw: pose.yaw,
          pitch: pose.pitch,
          roll: pose.roll,
          x: pose.x,
          y: pose.y,
          z: pose.z,
          blendshapes: blendshapes,
          audio: audioState
        };
        socket.send(JSON.stringify(frame));
      }

      // UI Rendering only when visible
      if (renderUI) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
          color: "#6366f140",
          lineWidth: 1
        });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#38bdf8" });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#38bdf8" });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#f43f5e" });

        updateGauges(pose, blendshapes);
        updateStatus("Tracking Face", "status-ok");
      }
    } else {
      const audioState = sampleAudio();
      if (renderUI) {
        updateAudioUI(audioState);
      }
      sendTrackingLoss(audioState);
      if (renderUI) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        updateStatus("No Face Detected", "status-warn");
      }
    }

    // FPS calculation
    frameCount++;
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      fpsDisplay.textContent = `${fps} FPS`;
      frameCount = 0;
      lastFpsTime = now;
    }
  } catch (err) {
    console.error("[Studio Tracker] Detection error:", err);
  } finally {
    isProcessing = false;
  }
}

// Foreground 60 FPS loop
function predictLoop() {
  if (!webcamRunning) return;

  if (!document.hidden) {
    processFrame(true);
    animFrameId = requestAnimationFrame(predictLoop);
  }
}

// Resume rAF loop when tab returns to foreground
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && webcamRunning) {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(predictLoop);
  }
});

function sendTrackingLoss(audioState) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      timestamp: performance.now(),
      present: false,
      audio: audioState || sampleAudio()
    }));
  }
}

function updateGauges(pose, blendshapes) {
  latestRawPose = pose;
  latestRawBlendshapes = blendshapes;

  const displayYaw = isCalibrated ? pose.yaw - neutralPose.yaw : pose.yaw;
  const displayPitch = isCalibrated ? pose.pitch - neutralPose.pitch : pose.pitch;
  const displayRoll = isCalibrated ? pose.roll - neutralPose.roll : pose.roll;

  valYaw.textContent = `${displayYaw.toFixed(1)}°`;
  valPitch.textContent = `${displayPitch.toFixed(1)}°`;
  valRoll.textContent = `${displayRoll.toFixed(1)}°`;

  gaugeYaw.style.width = `${Math.max(0, Math.min(100, ((displayYaw + 30) / 60) * 100))}%`;
  gaugePitch.style.width = `${Math.max(0, Math.min(100, ((displayPitch + 30) / 60) * 100))}%`;
  gaugeRoll.style.width = `${Math.max(0, Math.min(100, ((displayRoll + 30) / 60) * 100))}%`;

  const blinkL = blendshapes.eyeBlinkLeft || 0;
  const blinkR = blendshapes.eyeBlinkRight || 0;

  let mouthOpen = blendshapes.jawOpen || 0;
  if (isCalibrated && neutralMouth > 0) {
    if (mouthOpen > neutralMouth) {
      const denom = 1.0 - neutralMouth;
      mouthOpen = denom > 0.05 ? (mouthOpen - neutralMouth) / denom : 0;
    } else {
      mouthOpen = 0;
    }
  }

  const rawSmile = ((blendshapes.mouthSmileLeft || 0) + (blendshapes.mouthSmileRight || 0)) / 2;
  let smile = rawSmile;
  if (isCalibrated && neutralSmile > 0) {
    if (rawSmile > neutralSmile) {
      const denom = 1.0 - neutralSmile;
      smile = denom > 0.05 ? (rawSmile - neutralSmile) / denom : rawSmile - neutralSmile;
    } else {
      smile = 0;
    }
  }

  gaugeBlinkL.style.width = `${Math.round(blinkL * 100)}%`;
  gaugeBlinkR.style.width = `${Math.round(blinkR * 100)}%`;
  gaugeMouthOpen.style.width = `${Math.round(mouthOpen * 100)}%`;
  gaugeSmile.style.width = `${Math.round(smile * 100)}%`;
  if (valSmile) valSmile.textContent = `${Math.round(smile * 100)}%`;
}

// Calibrate Neutral Pose Button
btnCalibrate.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "calibrate" }));
  }
  if (latestRawPose) {
    neutralPose = { yaw: latestRawPose.yaw, pitch: latestRawPose.pitch, roll: latestRawPose.roll };
  }
  if (latestRawBlendshapes) {
    neutralSmile = ((latestRawBlendshapes.mouthSmileLeft || 0) + (latestRawBlendshapes.mouthSmileRight || 0)) / 2;
    neutralMouth = latestRawBlendshapes.jawOpen || 0;
  }
  isCalibrated = true;
});

btnToggleCamera.addEventListener("click", toggleCamera);
if (btnToggleMic) {
  btnToggleMic.addEventListener("click", toggleMic);
}
if (micSelect) {
  micSelect.addEventListener("change", () => {
    if (micRunning) {
      // Reconnect with new device
      startMic();
    }
  });
}

// Setup on load
connectWebSocket();
initMediaPipe();

// Settings & Tunable Sliders Management
const sliderMouthGain = document.getElementById("slider-mouth-gain");
const sliderMouthThreshold = document.getElementById("slider-mouth-threshold");
const checkboxEnableSmile = document.getElementById("checkbox-enable-smile");
const sliderSmileThreshold = document.getElementById("slider-smile-threshold");
const sliderBlinkThreshold = document.getElementById("slider-blink-threshold");
const sliderEyeGain = document.getElementById("slider-eye-gain");
const sliderYawMultiplier = document.getElementById("slider-yaw-multiplier");
const sliderPitchMultiplier = document.getElementById("slider-pitch-multiplier");

// Audio Settings Sliders
const sliderMicGain = document.getElementById("slider-mic-gain");
const sliderNoiseGate = document.getElementById("slider-noise-gate");
const sliderDecaySmooth = document.getElementById("slider-decay-smooth");
const valMicGain = document.getElementById("val-mic-gain");
const valNoiseGate = document.getElementById("val-noise-gate");
const valDecaySmooth = document.getElementById("val-decay-smooth");

const valMouthGain = document.getElementById("val-mouth-gain");
const valMouthThreshold = document.getElementById("val-mouth-threshold");
const valSmileThreshold = document.getElementById("val-smile-threshold");
const valBlinkThreshold = document.getElementById("val-blink-threshold");
const valEyeGain = document.getElementById("val-eye-gain");
const valYawMultiplier = document.getElementById("val-yaw-multiplier");
const valPitchMultiplier = document.getElementById("val-pitch-multiplier");

const btnSaveSettings = document.getElementById("btn-save-settings");
const btnResetSettings = document.getElementById("btn-reset-settings");
const saveStatus = document.getElementById("save-status");
const configPathDisplay = document.getElementById("config-path-display");

let activeSettings = null;
let saveDebounceTimer = null;

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    activeSettings = data.settings;
    if (configPathDisplay && data.configPath) {
      configPathDisplay.textContent = data.configPath;
    }
    syncSettingsToUI(activeSettings);
  } catch (err) {
    console.warn("[Studio Tracker] Could not load /api/settings:", err);
  }
}

function syncSettingsToUI(s) {
  if (!s) return;
  if (s.tracking) {
    const t = s.tracking;
    if (sliderMouthGain) sliderMouthGain.value = t.mouthGain || 1.4;
    if (sliderMouthThreshold) sliderMouthThreshold.value = t.mouthThreshold || 0.08;
    if (checkboxEnableSmile) checkboxEnableSmile.checked = t.enableSmile !== false;
    if (sliderSmileThreshold) sliderSmileThreshold.value = t.smileThreshold || 0.50;
    if (sliderBlinkThreshold) sliderBlinkThreshold.value = t.blinkThreshold || 0.45;
    if (sliderEyeGain) sliderEyeGain.value = t.eyeGazeGain || 1.0;
    if (sliderYawMultiplier) sliderYawMultiplier.value = t.yawMultiplier || 1.0;
    if (sliderPitchMultiplier) sliderPitchMultiplier.value = t.pitchMultiplier || 1.0;
  }
  if (s.audio) {
    const a = s.audio;
    const mode = a.mode || "hybrid";
    if (modeSelect) modeSelect.value = mode;
    if (settingsModeSelect) settingsModeSelect.value = mode;
    if (sliderMicGain) sliderMicGain.value = a.micGain || 1.5;
    if (sliderNoiseGate) sliderNoiseGate.value = a.noiseGate || 0.04;
    if (sliderDecaySmooth) sliderDecaySmooth.value = a.decaySmooth || 0.10;
  }

  updateSliderLabels();
}

function updateSliderLabels() {
  if (valMouthGain && sliderMouthGain) valMouthGain.textContent = `${parseFloat(sliderMouthGain.value).toFixed(2)}x`;
  if (valMouthThreshold && sliderMouthThreshold) valMouthThreshold.textContent = parseFloat(sliderMouthThreshold.value).toFixed(2);
  if (valSmileThreshold && sliderSmileThreshold) valSmileThreshold.textContent = parseFloat(sliderSmileThreshold.value).toFixed(2);
  if (valBlinkThreshold && sliderBlinkThreshold) valBlinkThreshold.textContent = parseFloat(sliderBlinkThreshold.value).toFixed(2);
  if (valEyeGain && sliderEyeGain) valEyeGain.textContent = `${parseFloat(sliderEyeGain.value).toFixed(1)}x`;
  if (valYawMultiplier && sliderYawMultiplier) valYawMultiplier.textContent = `${parseFloat(sliderYawMultiplier.value).toFixed(1)}x`;
  if (valPitchMultiplier && sliderPitchMultiplier) valPitchMultiplier.textContent = `${parseFloat(sliderPitchMultiplier.value).toFixed(1)}x`;

  if (smileThresholdMarker && sliderSmileThreshold) {
    const smilePercent = Math.min(100, Math.round(parseFloat(sliderSmileThreshold.value) * 100));
    smileThresholdMarker.style.left = `${smilePercent}%`;
  }

  if (valMicGain && sliderMicGain) valMicGain.textContent = `${parseFloat(sliderMicGain.value).toFixed(1)}x`;
  if (valNoiseGate && sliderNoiseGate) valNoiseGate.textContent = parseFloat(sliderNoiseGate.value).toFixed(2);
  if (valDecaySmooth && sliderDecaySmooth) valDecaySmooth.textContent = parseFloat(sliderDecaySmooth.value).toFixed(2);

  // Update noise gate marker on VU meter
  if (noiseGateMarker && sliderNoiseGate) {
    const gatePercent = Math.min(100, Math.round(parseFloat(sliderNoiseGate.value) * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}

function collectSettingsFromUI() {
  return {
    version: 1,
    tracking: {
      mouthGain: parseFloat(sliderMouthGain?.value || 1.4),
      mouthThreshold: parseFloat(sliderMouthThreshold?.value || 0.08),
      enableSmile: checkboxEnableSmile ? checkboxEnableSmile.checked : true,
      smileThreshold: parseFloat(sliderSmileThreshold?.value || 0.50),
      blinkThreshold: parseFloat(sliderBlinkThreshold?.value || 0.45),
      eyeGazeGain: parseFloat(sliderEyeGain?.value || 1.0),
      yawMultiplier: parseFloat(sliderYawMultiplier?.value || 1.0),
      pitchMultiplier: parseFloat(sliderPitchMultiplier?.value || 1.0),
      rollMultiplier: 1.0,
      poseSmoothing: 1.0
    },
    audio: {
      mode: settingsModeSelect?.value || modeSelect?.value || "hybrid",
      micGain: parseFloat(sliderMicGain?.value || 1.5),
      noiseGate: parseFloat(sliderNoiseGate?.value || 0.04),
      decaySmooth: parseFloat(sliderDecaySmooth?.value || 0.10)
    }
  };
}

async function sendSettingsUpdate(showSavedToast = false) {
  const newSettings = collectSettingsFromUI();
  activeSettings = newSettings;
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSettings)
    });
    if (res.ok && showSavedToast && saveStatus) {
      saveStatus.textContent = "✓ Saved!";
      saveStatus.style.opacity = "1";
      setTimeout(() => {
        saveStatus.style.opacity = "0";
      }, 1500);
    }
  } catch (err) {
    console.error("[Studio Tracker] Error saving settings:", err);
  }
}

// Live update on slider movement (debounced by 80ms)
function onSliderInput() {
  updateSliderLabels();
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    sendSettingsUpdate(false);
  }, 80);
}

[
  sliderMouthGain,
  sliderMouthThreshold,
  sliderSmileThreshold,
  sliderBlinkThreshold,
  sliderEyeGain,
  sliderYawMultiplier,
  sliderPitchMultiplier,
  sliderMicGain,
  sliderNoiseGate,
  sliderDecaySmooth
].forEach(slider => {
  if (slider) {
    slider.addEventListener("input", onSliderInput);
  }
});

function onModeChange(e) {
  const newMode = e.target.value;
  if (modeSelect) modeSelect.value = newMode;
  if (settingsModeSelect) settingsModeSelect.value = newMode;
  sendSettingsUpdate(true);
}

if (modeSelect) {
  modeSelect.addEventListener("change", onModeChange);
}
if (settingsModeSelect) {
  settingsModeSelect.addEventListener("change", onModeChange);
}
if (checkboxEnableSmile) {
  checkboxEnableSmile.addEventListener("change", () => sendSettingsUpdate(true));
}

if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", () => sendSettingsUpdate(true));
}

if (btnResetSettings) {
  btnResetSettings.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/settings/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        activeSettings = data.settings;
        syncSettingsToUI(activeSettings);
        if (saveStatus) {
          saveStatus.textContent = "✓ Defaults Reset!";
          saveStatus.style.opacity = "1";
          setTimeout(() => {
            saveStatus.style.opacity = "0";
          }, 1500);
        }
      }
    } catch (err) {
      console.error("[Studio Tracker] Error resetting settings:", err);
    }
  });
}

loadSettings();
