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
const valBlinkL = document.getElementById("val-blink-l");
const valBlinkR = document.getElementById("val-blink-r");
const blinkThresholdMarkerL = document.getElementById("blink-threshold-marker-l");
const blinkThresholdMarkerR = document.getElementById("blink-threshold-marker-r");
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
      } else {
        if (document.hidden) {
          processCameraOffFrame(false);
        }
      }
    };
    tickerWorker.postMessage('start');
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
    const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
    const currentVal = (micSelect && micSelect.value) ? micSelect.value : savedMic;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(d => d.kind === "audioinput");
    if (!micSelect) return;

    if (audioDevices.length === 0) {
      micSelect.innerHTML = '<option value="">Default Microphone</option>';
      return;
    }

    const hasRealLabels = micSelect.options.length > 0 && micSelect.options[0].textContent && !micSelect.options[0].textContent.startsWith("Microphone 1");
    if (micSelect.options.length === audioDevices.length && hasRealLabels) {
      if (currentVal) micSelect.value = currentVal;
      return;
    }

    micSelect.innerHTML = "";
    audioDevices.forEach((device, i) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${i + 1}`;
      if (currentVal && device.deviceId === currentVal) {
        option.selected = true;
      }
      micSelect.appendChild(option);
    });
    if (currentVal) {
      micSelect.value = currentVal;
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
  const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
  const deviceId = (micSelect && micSelect.value) ? micSelect.value : savedMic;

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      });
    } catch (e) {
      if (deviceId) {
        console.warn("[Studio Tracker] Exact mic failed, falling back to default:", e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw e;
      }
    }

    micStream = stream;
    micSource = ctx.createMediaStreamSource(micStream);
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.2;
    micSource.connect(analyserNode);
    audioDataArray = new Float32Array(analyserNode.fftSize);

    micRunning = true;
    localStorage.setItem("svgtuber_mic_active", "true");
    if (micSelect && micSelect.value) {
      localStorage.setItem("svgtuber_mic_id", micSelect.value);
    }
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
  localStorage.setItem("svgtuber_mic_active", "false");
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
    // Keep camera off loop running to stream face lost frames
    startCameraOffLoop();
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

let cameraOffAnimId = null;

function startCameraOffLoop() {
  if (cameraOffAnimId) cancelAnimationFrame(cameraOffAnimId);
  function cameraOffLoop() {
    if (webcamRunning) {
      cameraOffAnimId = null;
      return;
    }
    if (!document.hidden) {
      processCameraOffFrame(true);
    }
    cameraOffAnimId = requestAnimationFrame(cameraOffLoop);
  }
  cameraOffAnimId = requestAnimationFrame(cameraOffLoop);
}

function processCameraOffFrame(renderUI = true) {
  const now = performance.now();
  const audioState = sampleAudio();
  if (renderUI && audioState) {
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
    if (!webcamRunning) {
      updateStatus(micRunning ? "Camera Off (Face Lost) - Audio Active" : "Camera Off (Face Lost)", "status-warn");
      startCameraOffLoop();
    }
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "calibrated") {
        console.log("[Studio Tracker] Calibration confirmed by server.");
        showCalibratedFlash();
      } else if (msg.type === "expression_update") {
        activeExpressions = msg.expressions || {};
        updateExpressionButtonsUI();
      } else if (msg.type === "accessory_update") {
        configuredAccessories = msg.accessories || [];
        renderAccessoriesUI();
      } else if (msg.type === "rig_update") {
        loadExpressions();
        loadAccessories();
      } else if (msg.type === "avatar_swapped") {
        loadAvatars();
        loadExpressions();
        loadAccessories();
        reloadAvatarFrame();
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

async function fetchAppVersion() {
  try {
    const res = await fetch("/api/version");
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById("app-version");
      if (el && data.version) {
        el.textContent = data.version.startsWith("v") ? data.version : `v${data.version}`;
        if (data.commit && data.commit !== "none") {
          el.title = `Commit: ${data.commit}\nBuilt: ${data.date || "unknown"}`;
        }
      }
    }
  } catch (err) {
    console.debug("[Studio] Could not fetch /api/version:", err);
  }
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
    fetchAppVersion();
    await populateCameraDevices();
    await populateAudioDevices();

    // Auto-restore camera on page reload if not explicitly stopped
    const cameraActive = localStorage.getItem("svgtuber_camera_active");
    if (cameraActive === "true" || cameraActive === null) {
      console.log("[Studio Tracker] Auto-starting camera stream on load...");
      startCamera().catch(e => {
        console.warn("[Studio Tracker] Auto-start camera warning:", e);
        updateStatus("Camera Off (Face Lost)", "status-warn");
        startCameraOffLoop();
      });
    } else {
      updateStatus("Camera Off (Face Lost)", "status-warn");
      startCameraOffLoop();
    }
  } catch (err) {
    console.error("[Studio Tracker] Failed to initialize MediaPipe:", err);
    updateStatus(`Error loading AI model: ${err.message}`, "status-error");
  }
}

async function populateCameraDevices() {
  try {
    const savedCam = localStorage.getItem("svgtuber_camera_id") || "";
    const currentVal = (cameraSelect && cameraSelect.value) ? cameraSelect.value : savedCam;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");
    if (!cameraSelect || videoDevices.length === 0) return;

    const hasRealLabels = cameraSelect.options.length > 0 && cameraSelect.options[0].textContent && !cameraSelect.options[0].textContent.startsWith("Camera 1");
    if (cameraSelect.options.length === videoDevices.length && hasRealLabels) {
      if (currentVal) cameraSelect.value = currentVal;
      return;
    }

    cameraSelect.innerHTML = "";
    videoDevices.forEach((device, i) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${i + 1}`;
      if (currentVal && device.deviceId === currentVal) {
        option.selected = true;
      }
      cameraSelect.appendChild(option);
    });
    if (currentVal) {
      cameraSelect.value = currentVal;
    }
  } catch (err) {
    console.warn("[Studio Tracker] Could not enumerate camera devices:", err);
  }
}

// Start camera stream with resilient fallback and device persistence
async function startCamera(deviceId = null) {
  if (video.srcObject) {
    try {
      video.srcObject.getTracks().forEach(t => t.stop());
    } catch (e) {}
    video.srcObject = null;
  }
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  const savedCam = localStorage.getItem("svgtuber_camera_id") || "";
  const targetId = deviceId || (cameraSelect && cameraSelect.value) || savedCam;

  let stream = null;
  try {
    const constraints = {
      video: targetId ? {
        deviceId: { exact: targetId },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 60 }
      } : {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 60 }
      }
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (targetId) {
      console.warn("[Studio Tracker] Exact camera failed, falling back to default:", err);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }
      });
    } else {
      throw err;
    }
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    console.warn("[Studio Tracker] video.play() warning:", e);
  }

  const onLoaded = () => {
    webcamRunning = true;
    localStorage.setItem("svgtuber_camera_active", "true");

    const effectiveId = targetId || (cameraSelect && cameraSelect.value);
    if (effectiveId) {
      localStorage.setItem("svgtuber_camera_id", effectiveId);
      if (cameraSelect) cameraSelect.value = effectiveId;
    }

    btnToggleCamera.textContent = "Stop Camera";
    btnToggleCamera.classList.add("btn-danger");
    updateStatus("Tracking Active", "status-ok");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    populateCameraDevices();
    populateAudioDevices();

    getOrCreateAudioContext();
    if (tickerWorker) {
      tickerWorker.postMessage('start');
    }

    // Auto-restore mic if previously enabled
    const micActive = localStorage.getItem("svgtuber_mic_active");
    if (micActive === "true" && !micRunning) {
      startMic().catch(e => console.warn("[Studio Tracker] Auto-restore mic:", e));
    }

    if (cameraOffAnimId) {
      cancelAnimationFrame(cameraOffAnimId);
      cameraOffAnimId = null;
    }

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(predictLoop);
  };

  if (video.readyState >= 2 && video.videoWidth > 0) {
    onLoaded();
  } else {
    video.addEventListener("loadeddata", onLoaded, { once: true });
  }
}

// Stop camera stream
function stopCamera() {
  webcamRunning = false;
  localStorage.setItem("svgtuber_camera_active", "false");
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  startCameraOffLoop();

  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  btnToggleCamera.textContent = "Start Camera";
  btnToggleCamera.classList.remove("btn-danger");
  updateStatus(micRunning ? "Camera Off (Face Lost) - Audio Active" : "Camera Off (Face Lost)", "status-warn");
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  resetTrackingGauges();
  sendTrackingLoss();
}

// Seamlessly switch camera without full stop/start cycle
async function switchCamera(deviceId) {
  if (!webcamRunning) {
    return;
  }
  updateStatus("Switching Camera...", "status-warn");
  try {
    await startCamera(deviceId);
  } catch (err) {
    console.error("[Studio Tracker] Error switching camera:", err);
    stopCamera();
    updateStatus(`Camera switch failed: ${err.message}`, "status-error");
  }
}

// Start / Stop Camera Stream
async function toggleCamera() {
  if (webcamRunning) {
    stopCamera();
    return;
  }
  try {
    await startCamera();
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
        resetTrackingGauges();
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
  if (!document.hidden) {
    if (webcamRunning) {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(predictLoop);
    } else {
      startCameraOffLoop();
    }
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

function resetTrackingGauges() {
  if (valYaw) valYaw.textContent = "0.0°";
  if (valPitch) valPitch.textContent = "0.0°";
  if (valRoll) valRoll.textContent = "0.0°";
  if (gaugeYaw) gaugeYaw.style.width = "50%";
  if (gaugePitch) gaugePitch.style.width = "50%";
  if (gaugeRoll) gaugeRoll.style.width = "50%";
  if (gaugeBlinkL) gaugeBlinkL.style.width = "0%";
  if (gaugeBlinkR) gaugeBlinkR.style.width = "0%";
  if (valBlinkL) valBlinkL.textContent = "0%";
  if (valBlinkR) valBlinkR.textContent = "0%";
  if (gaugeMouthOpen) gaugeMouthOpen.style.width = "0%";
  if (gaugeSmile) gaugeSmile.style.width = "0%";
  if (valSmile) valSmile.textContent = "0%";
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
  if (valBlinkL) valBlinkL.textContent = `${Math.round(blinkL * 100)}%`;
  if (valBlinkR) valBlinkR.textContent = `${Math.round(blinkR * 100)}%`;
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
if (cameraSelect) {
  cameraSelect.addEventListener("change", () => {
    if (cameraSelect.value) {
      localStorage.setItem("svgtuber_camera_id", cameraSelect.value);
    }
    if (webcamRunning) {
      switchCamera(cameraSelect.value);
    }
  });
}
if (btnToggleMic) {
  btnToggleMic.addEventListener("click", toggleMic);
}
if (micSelect) {
  micSelect.addEventListener("change", () => {
    if (micSelect.value) {
      localStorage.setItem("svgtuber_mic_id", micSelect.value);
    }
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
const checkboxWinkIsBlink = document.getElementById("checkbox-wink-is-blink");
const checkboxAutoBlink = document.getElementById("checkbox-auto-blink");
const selectAutoBlinkMode = document.getElementById("select-auto-blink-mode");
const sliderAutoBlinkInterval = document.getElementById("slider-auto-blink-interval");
const valAutoBlinkInterval = document.getElementById("val-auto-blink-interval");
const checkboxAutoGaze = document.getElementById("checkbox-auto-gaze");
const selectAutoGazeMode = document.getElementById("select-auto-gaze-mode");
const sliderAutoGazeRange = document.getElementById("slider-auto-gaze-range");
const valAutoGazeRange = document.getElementById("val-auto-gaze-range");
const checkboxAutoTilt = document.getElementById("checkbox-auto-tilt");
const selectAutoTiltMode = document.getElementById("select-auto-tilt-mode");
const sliderAutoTiltAmount = document.getElementById("slider-auto-tilt-amount");
const valAutoTiltAmount = document.getElementById("val-auto-tilt-amount");
const checkboxPhysicsEnabled = document.getElementById("checkbox-physics-enabled");
const sliderPhysicsAmount = document.getElementById("slider-physics-amount");
const valPhysicsAmount = document.getElementById("val-physics-amount");
const sliderSmileThreshold = document.getElementById("slider-smile-threshold");
const sliderBlinkThresholdL = document.getElementById("slider-blink-threshold-l");
const sliderBlinkThresholdR = document.getElementById("slider-blink-threshold-r");
const sliderBlinkSyncDelay = document.getElementById("slider-blink-sync-delay");
const sliderEyeGain = document.getElementById("slider-eye-gain");
const sliderYawMultiplier = document.getElementById("slider-yaw-multiplier");
const sliderPitchMultiplier = document.getElementById("slider-pitch-multiplier");

// Audio Settings Sliders
const sliderMicGain = document.getElementById("slider-mic-gain");
const sliderNoiseGate = document.getElementById("slider-noise-gate");
const sliderDecaySmooth = document.getElementById("slider-decay-smooth");
const sliderBounceAmount = document.getElementById("slider-bounce-amount");
const valMicGain = document.getElementById("val-mic-gain");
const valNoiseGate = document.getElementById("val-noise-gate");
const valDecaySmooth = document.getElementById("val-decay-smooth");
const valBounceAmount = document.getElementById("val-bounce-amount");

const valMouthGain = document.getElementById("val-mouth-gain");
const valMouthThreshold = document.getElementById("val-mouth-threshold");
const valSmileThreshold = document.getElementById("val-smile-threshold");
const valBlinkThresholdL = document.getElementById("val-blink-threshold-l");
const valBlinkThresholdR = document.getElementById("val-blink-threshold-r");
const valBlinkSyncDelay = document.getElementById("val-blink-sync-delay");
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
    if (checkboxWinkIsBlink) checkboxWinkIsBlink.checked = Boolean(t.winkIsBlink);
    if (checkboxAutoBlink) checkboxAutoBlink.checked = t.autoBlink !== false;
    if (selectAutoBlinkMode) selectAutoBlinkMode.value = t.autoBlinkMode || "always";
    if (sliderAutoBlinkInterval) sliderAutoBlinkInterval.value = t.autoBlinkIntervalSec || 4.0;
    if (checkboxAutoGaze) checkboxAutoGaze.checked = t.autoGaze !== false;
    if (selectAutoGazeMode) selectAutoGazeMode.value = t.autoGazeMode || "always";
    if (sliderAutoGazeRange) sliderAutoGazeRange.value = t.autoGazeRange || 1.0;
    if (checkboxAutoTilt) checkboxAutoTilt.checked = t.autoTilt !== false;
    if (selectAutoTiltMode) selectAutoTiltMode.value = t.autoTiltMode || "always";
    if (sliderAutoTiltAmount) sliderAutoTiltAmount.value = t.autoTiltAmount || 1.0;
    if (checkboxPhysicsEnabled) checkboxPhysicsEnabled.checked = t.physicsEnabled !== false;
    if (sliderPhysicsAmount) sliderPhysicsAmount.value = t.physicsAmount !== undefined ? t.physicsAmount : 1.0;
    if (sliderBlinkThresholdL) sliderBlinkThresholdL.value = t.blinkThresholdL || t.blinkThreshold || 0.45;
    if (sliderBlinkThresholdR) sliderBlinkThresholdR.value = t.blinkThresholdR || t.blinkThreshold || 0.45;
    if (sliderBlinkSyncDelay) sliderBlinkSyncDelay.value = (t.blinkSyncDelayMs !== undefined ? t.blinkSyncDelayMs : 50);
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
    if (sliderBounceAmount) sliderBounceAmount.value = a.bounceAmount !== undefined ? a.bounceAmount : 1.0;
  }

  updateSliderLabels();
}

function updateSliderLabels() {
  if (valMouthGain && sliderMouthGain) valMouthGain.textContent = `${parseFloat(sliderMouthGain.value).toFixed(2)}x`;
  if (valMouthThreshold && sliderMouthThreshold) valMouthThreshold.textContent = parseFloat(sliderMouthThreshold.value).toFixed(2);
  if (valSmileThreshold && sliderSmileThreshold) valSmileThreshold.textContent = parseFloat(sliderSmileThreshold.value).toFixed(2);
  if (valBlinkThresholdL && sliderBlinkThresholdL) valBlinkThresholdL.textContent = parseFloat(sliderBlinkThresholdL.value).toFixed(2);
  if (valBlinkThresholdR && sliderBlinkThresholdR) valBlinkThresholdR.textContent = parseFloat(sliderBlinkThresholdR.value).toFixed(2);
  if (valBlinkSyncDelay && sliderBlinkSyncDelay) valBlinkSyncDelay.textContent = `${sliderBlinkSyncDelay.value}ms`;
  if (valAutoBlinkInterval && sliderAutoBlinkInterval) valAutoBlinkInterval.textContent = `${parseFloat(sliderAutoBlinkInterval.value).toFixed(1)}s`;
  if (valAutoGazeRange && sliderAutoGazeRange) valAutoGazeRange.textContent = `${parseFloat(sliderAutoGazeRange.value).toFixed(1)}x`;
  if (valAutoTiltAmount && sliderAutoTiltAmount) valAutoTiltAmount.textContent = `${parseFloat(sliderAutoTiltAmount.value).toFixed(1)}x`;
  if (valPhysicsAmount && sliderPhysicsAmount) valPhysicsAmount.textContent = `${parseFloat(sliderPhysicsAmount.value).toFixed(1)}x`;
  if (valEyeGain && sliderEyeGain) valEyeGain.textContent = `${parseFloat(sliderEyeGain.value).toFixed(1)}x`;
  if (valYawMultiplier && sliderYawMultiplier) valYawMultiplier.textContent = `${parseFloat(sliderYawMultiplier.value).toFixed(1)}x`;
  if (valPitchMultiplier && sliderPitchMultiplier) valPitchMultiplier.textContent = `${parseFloat(sliderPitchMultiplier.value).toFixed(1)}x`;

  if (smileThresholdMarker && sliderSmileThreshold) {
    const smilePercent = Math.min(100, Math.round(parseFloat(sliderSmileThreshold.value) * 100));
    smileThresholdMarker.style.left = `${smilePercent}%`;
  }
  if (blinkThresholdMarkerL && sliderBlinkThresholdL) {
    const blinkPercent = Math.min(100, Math.round(parseFloat(sliderBlinkThresholdL.value) * 100));
    blinkThresholdMarkerL.style.left = `${blinkPercent}%`;
  }
  if (blinkThresholdMarkerR && sliderBlinkThresholdR) {
    const blinkPercent = Math.min(100, Math.round(parseFloat(sliderBlinkThresholdR.value) * 100));
    blinkThresholdMarkerR.style.left = `${blinkPercent}%`;
  }

  if (valMicGain && sliderMicGain) valMicGain.textContent = `${parseFloat(sliderMicGain.value).toFixed(1)}x`;
  if (valNoiseGate && sliderNoiseGate) valNoiseGate.textContent = parseFloat(sliderNoiseGate.value).toFixed(2);
  if (valDecaySmooth && sliderDecaySmooth) valDecaySmooth.textContent = parseFloat(sliderDecaySmooth.value).toFixed(2);
  if (valBounceAmount && sliderBounceAmount) valBounceAmount.textContent = `${parseFloat(sliderBounceAmount.value).toFixed(1)}x`;

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
      blinkThreshold: parseFloat(sliderBlinkThresholdL?.value || 0.45),
      blinkThresholdL: parseFloat(sliderBlinkThresholdL?.value || 0.45),
      blinkThresholdR: parseFloat(sliderBlinkThresholdR?.value || 0.45),
      blinkSyncDelayMs: parseFloat(sliderBlinkSyncDelay?.value || 50),
      winkIsBlink: checkboxWinkIsBlink ? checkboxWinkIsBlink.checked : false,
      autoBlink: checkboxAutoBlink ? checkboxAutoBlink.checked : true,
      autoBlinkMode: selectAutoBlinkMode ? selectAutoBlinkMode.value : "always",
      autoBlinkIntervalSec: parseFloat(sliderAutoBlinkInterval?.value || 4.0),
      autoGaze: checkboxAutoGaze ? checkboxAutoGaze.checked : true,
      autoGazeMode: selectAutoGazeMode ? selectAutoGazeMode.value : "always",
      autoGazeRange: parseFloat(sliderAutoGazeRange?.value || 1.0),
      autoTilt: checkboxAutoTilt ? checkboxAutoTilt.checked : true,
      autoTiltMode: selectAutoTiltMode ? selectAutoTiltMode.value : "always",
      autoTiltAmount: parseFloat(sliderAutoTiltAmount?.value || 1.0),
      physicsEnabled: checkboxPhysicsEnabled ? checkboxPhysicsEnabled.checked : true,
      physicsAmount: parseFloat(sliderPhysicsAmount?.value !== undefined ? sliderPhysicsAmount.value : 1.0),
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
      decaySmooth: parseFloat(sliderDecaySmooth?.value || 0.10),
      bounceAmount: parseFloat(sliderBounceAmount?.value !== undefined ? sliderBounceAmount.value : 1.0)
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
  sliderBlinkThresholdL,
  sliderBlinkThresholdR,
  sliderBlinkSyncDelay,
  sliderAutoBlinkInterval,
  sliderAutoGazeRange,
  sliderAutoTiltAmount,
  sliderEyeGain,
  sliderYawMultiplier,
  sliderPitchMultiplier,
  sliderMicGain,
  sliderNoiseGate,
  sliderDecaySmooth,
  sliderBounceAmount,
  sliderPhysicsAmount
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
if (checkboxWinkIsBlink) {
  checkboxWinkIsBlink.addEventListener("change", () => sendSettingsUpdate(true));
}
if (checkboxAutoBlink) {
  checkboxAutoBlink.addEventListener("change", () => sendSettingsUpdate(true));
}
if (selectAutoBlinkMode) {
  selectAutoBlinkMode.addEventListener("change", () => sendSettingsUpdate(true));
}
if (checkboxAutoGaze) {
  checkboxAutoGaze.addEventListener("change", () => sendSettingsUpdate(true));
}
if (selectAutoGazeMode) {
  selectAutoGazeMode.addEventListener("change", () => sendSettingsUpdate(true));
}
if (checkboxAutoTilt) {
  checkboxAutoTilt.addEventListener("change", () => sendSettingsUpdate(true));
}
if (selectAutoTiltMode) {
  selectAutoTiltMode.addEventListener("change", () => sendSettingsUpdate(true));
}
if (checkboxPhysicsEnabled) {
  checkboxPhysicsEnabled.addEventListener("change", () => sendSettingsUpdate(true));
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

// Expressions & Hotkeys Management
let availableExpressions = [];
let activeExpressions = {};
const expressionsContainer = document.getElementById("expressions-container");
const btnClearExpressions = document.getElementById("btn-clear-expressions");
const expressionCountBadge = document.getElementById("expression-count-badge");
const expressionStatus = document.getElementById("expression-status");

async function loadExpressions() {
  try {
    const res = await fetch("/api/expressions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    activeExpressions = data.active || {};
    availableExpressions = data.available || [];
    renderExpressionButtons();
    updateAllExpressionDropdowns();
  } catch (err) {
    console.warn("[Studio Tracker] Could not load /api/expressions:", err);
  }
}

function renderExpressionButtons() {
  if (!expressionsContainer) return;
  expressionsContainer.innerHTML = "";
  if (expressionCountBadge) {
    expressionCountBadge.textContent = availableExpressions.length;
  }

  if (availableExpressions.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.style.fontSize = "12px";
    emptySpan.style.color = "var(--text-muted)";
    emptySpan.textContent = "No custom expressions detected in current avatar rig.";
    expressionsContainer.appendChild(emptySpan);
    return;
  }

  availableExpressions.forEach((name, idx) => {
    const btn = document.createElement("button");
    btn.className = `expr-btn ${activeExpressions[name] ? "active" : ""}`;
    btn.dataset.name = name;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.appendChild(labelSpan);

    if (idx < 9) {
      const keyBadge = document.createElement("span");
      keyBadge.className = "expr-key-badge";
      keyBadge.textContent = `${idx + 1}`;
      keyBadge.title = `Press ${idx + 1} to toggle`;
      btn.appendChild(keyBadge);
    }

    const copyBtn = document.createElement("span");
    copyBtn.className = "expr-copy-btn";
    copyBtn.title = "Copy Stream Deck API URL";
    copyBtn.textContent = "📋";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const apiUrl = `${location.origin}/api/expressions/toggle?name=${encodeURIComponent(name)}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(apiUrl).then(() => {
          if (expressionStatus) {
            expressionStatus.textContent = `Copied URL for "${name}"!`;
            setTimeout(() => { expressionStatus.textContent = ""; }, 2000);
          }
        });
      }
    });
    btn.appendChild(copyBtn);

    btn.addEventListener("click", () => {
      toggleExpression(name);
    });

    expressionsContainer.appendChild(btn);
  });
}

function updateExpressionButtonsUI() {
  if (!expressionsContainer) return;
  const buttons = expressionsContainer.querySelectorAll(".expr-btn");
  buttons.forEach(btn => {
    const name = btn.dataset.name;
    if (activeExpressions[name]) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

async function toggleExpression(name) {
  try {
    const res = await fetch(`/api/expressions/toggle?name=${encodeURIComponent(name)}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      activeExpressions = data.expressions || {};
      updateExpressionButtonsUI();
    }
  } catch (err) {
    console.error("[Studio Tracker] Error toggling expression:", err);
  }
}

async function clearAllExpressions() {
  try {
    const res = await fetch("/api/expressions/reset", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      activeExpressions = data.expressions || {};
      updateExpressionButtonsUI();
    }
  } catch (err) {
    console.error("[Studio Tracker] Error clearing expressions:", err);
  }
}

if (btnClearExpressions) {
  btnClearExpressions.addEventListener("click", clearAllExpressions);
}

const btnReloadAvatar = document.getElementById("btn-reload-avatar");
if (btnReloadAvatar) {
  btnReloadAvatar.addEventListener("click", async () => {
    btnReloadAvatar.disabled = true;
    btnReloadAvatar.textContent = "Reloading...";
    try {
      await fetch("/api/avatar/reload", { method: "POST" });
      await loadExpressions();
      if (expressionStatus) {
        expressionStatus.textContent = "Avatar rig reloaded!";
        setTimeout(() => { expressionStatus.textContent = ""; }, 2000);
      }
    } catch (e) {
      console.error("[Studio Tracker] Reload rig error:", e);
    } finally {
      btnReloadAvatar.disabled = false;
      btnReloadAvatar.textContent = "↻ Reload Rig";
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
    return;
  }
  const keyNum = parseInt(e.key, 10);
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
    const idx = keyNum - 1;
    if (availableExpressions && availableExpressions[idx]) {
      e.preventDefault();
      toggleExpression(availableExpressions[idx]);
    }
  }
});

// Avatar Switcher & Directory Management
const avatarSelect = document.getElementById("avatar-select");
const avatarDirLabel = document.getElementById("avatar-dir-label");
const btnRefreshAvatars = document.getElementById("btn-refresh-avatars");

function reloadAvatarFrame() {
  const frame = document.getElementById("avatar-frame");
  if (frame) {
    frame.src = `/overlay?t=${Date.now()}`;
  }
}

async function loadAvatars() {
  if (!avatarSelect) return;
  try {
    const res = await fetch(`/api/avatars?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    const dir = data.avatarDir || "";
    const current = data.currentAvatar || "";
    const avatars = data.avatars || [];

    if (avatarDirLabel) {
      avatarDirLabel.textContent = `📁 ${dir}`;
      avatarDirLabel.title = dir;
    }

    avatarSelect.innerHTML = "";
    if (avatars.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No .svg files found in directory";
      avatarSelect.appendChild(opt);
      return;
    }

    avatars.forEach((av) => {
      const opt = document.createElement("option");
      opt.value = av;
      opt.textContent = av;
      if (av === current) {
        opt.selected = true;
      }
      avatarSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("[Studio Tracker] Error loading avatars:", err);
  }
}

if (avatarSelect) {
  avatarSelect.addEventListener("change", async (e) => {
    const selected = e.target.value;
    if (!selected) return;
    avatarSelect.disabled = true;
    try {
      const res = await fetch("/api/avatars/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: selected })
      });
      if (!res.ok) {
        throw new Error(`Failed to switch avatar: ${res.statusText}`);
      }
      reloadAvatarFrame();
      await loadExpressions();
    } catch (err) {
      console.error("[Studio Tracker] Error switching avatar:", err);
      alert(`Could not switch avatar: ${err.message}`);
    } finally {
      avatarSelect.disabled = false;
    }
  });
}

if (btnRefreshAvatars) {
  btnRefreshAvatars.addEventListener("click", async () => {
    btnRefreshAvatars.disabled = true;
    btnRefreshAvatars.textContent = "Scanning...";
    try {
      await loadAvatars();
    } finally {
      btnRefreshAvatars.disabled = false;
      btnRefreshAvatars.textContent = "↻ Scan Folder";
    }
  });
}

loadExpressions();
loadAvatars();

// ==========================================
// Modular Accessories & Props Closet Manager
// ==========================================
let availableAccessoryFiles = [];
let configuredAccessories = [];
const openDrawers = new Set();
const accessoryDebounceMap = new Map();

const accessoryCountBadge = document.getElementById("accessory-count-badge");
const accessoryListEl = document.getElementById("accessory-list");
const availableAccessoriesChipsEl = document.getElementById("available-accessories-chips");
const accessorySaveIndicator = document.getElementById("accessory-save-indicator");
const btnRefreshAccessories = document.getElementById("btn-refresh-accessories");

function flashAccessorySaved() {
  if (accessorySaveIndicator) {
    accessorySaveIndicator.style.opacity = "1";
    setTimeout(() => {
      accessorySaveIndicator.style.opacity = "0";
    }, 1200);
  }
}

async function loadAccessories() {
  try {
    const res = await fetch(`/api/accessories?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    availableAccessoryFiles = data.availableFiles || [];
    configuredAccessories = data.accessories || [];
    renderAccessoriesUI();
  } catch (err) {
    console.error("[Studio Tracker] Error loading accessories:", err);
  }
}

function debounceSaveAccessory(acc) {
  if (accessoryDebounceMap.has(acc.id)) {
    clearTimeout(accessoryDebounceMap.get(acc.id));
  }
  const timer = setTimeout(async () => {
    accessoryDebounceMap.delete(acc.id);
    try {
      const res = await fetch("/api/accessories/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acc)
      });
      if (res.ok) {
        flashAccessorySaved();
      }
    } catch (e) {
      console.error("[Studio Tracker] Error updating accessory:", e);
    }
  }, 50);
  accessoryDebounceMap.set(acc.id, timer);
}

function renderAccessoriesUI() {
  if (accessoryCountBadge) {
    const activeCount = configuredAccessories.filter(a => a.enabled).length;
    accessoryCountBadge.textContent = `${activeCount}/${configuredAccessories.length}`;
  }

  // 1. Render Discovered Files Chips (avoid rebuilding if unchanged)
  if (availableAccessoriesChipsEl) {
    const currentChipsKey = availableAccessoriesChipsEl.dataset.files || "";
    const newChipsKey = availableAccessoryFiles.join(",");
    if (currentChipsKey !== newChipsKey) {
      availableAccessoriesChipsEl.dataset.files = newChipsKey;
      availableAccessoriesChipsEl.innerHTML = "";
      if (availableAccessoryFiles.length === 0) {
        availableAccessoriesChipsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No .svg files in avatar accessories/ folder</span>';
      } else {
        availableAccessoryFiles.forEach(file => {
          const chip = document.createElement("button");
          chip.className = "acc-chip";
          chip.title = `Add ${file} to avatar`;
          chip.innerHTML = `<span>+</span> <span>${file}</span>`;
          chip.addEventListener("click", () => {
            equipNewAccessory(file);
          });
          availableAccessoriesChipsEl.appendChild(chip);
        });
      }
    }
  }

  // 2. Render / Update Configured Accessories List
  if (!accessoryListEl) return;

  if (configuredAccessories.length === 0) {
    accessoryListEl.innerHTML = `
      <div style="text-align: center; padding: 18px 12px; background: #14141c; border-radius: 6px; border: 1px dashed var(--border-color);">
        <div style="font-size: 13px; font-weight: 500; color: var(--text-main); margin-bottom: 4px;">No Accessories Added Yet</div>
        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">
          Click any file below in the <strong>Discovered Accessory Files</strong> bar to equip glasses, ears, sweat drops, or custom SVG props!
        </div>
      </div>`;
    return;
  }

  // Clean empty placeholder if it was there
  const firstChild = accessoryListEl.firstElementChild;
  if (firstChild && !firstChild.classList.contains("accessory-card")) {
    accessoryListEl.innerHTML = "";
  }

  const currentIds = new Set(configuredAccessories.map(a => a.id));

  // Remove deleted cards
  Array.from(accessoryListEl.children).forEach(child => {
    if (child.dataset && child.dataset.accId && !currentIds.has(child.dataset.accId)) {
      child.remove();
    }
  });

  // Update existing or append new cards
  configuredAccessories.forEach((acc) => {
    let card = accessoryListEl.querySelector(`.accessory-card[data-acc-id="${CSS.escape(acc.id)}"]`);
    if (card) {
      // In-place update to prevent DOM recreation and focus loss!
      const meta = card.querySelector('.accessory-meta');
      if (meta) meta.textContent = `${acc.file} • ${acc.target || 'layer_head'}`;

      const switchInput = card.querySelector('.switch input');
      if (switchInput && document.activeElement !== switchInput) {
        switchInput.checked = Boolean(acc.enabled);
      }

      // Do NOT overwrite slider / input values while user is interacting inside this card!
      if (!card.contains(document.activeElement)) {
        const xRange = card.querySelector('.ctrl-x input[type=range]');
        const xNum = card.querySelector('.ctrl-x input[type=number]');
        if (xRange) xRange.value = String(acc.x || 0);
        if (xNum) xNum.value = String(acc.x || 0);

        const yRange = card.querySelector('.ctrl-y input[type=range]');
        const yNum = card.querySelector('.ctrl-y input[type=number]');
        if (yRange) yRange.value = String(acc.y || 0);
        if (yNum) yNum.value = String(acc.y || 0);

        const sxRange = card.querySelector('.ctrl-sx input[type=range]');
        const sxNum = card.querySelector('.ctrl-sx input[type=number]');
        if (sxRange) sxRange.value = String(acc.scaleX !== undefined ? acc.scaleX : 1.0);
        if (sxNum) sxNum.value = String(parseFloat(acc.scaleX !== undefined ? acc.scaleX : 1.0).toFixed(2));

        const syRange = card.querySelector('.ctrl-sy input[type=range]');
        const syNum = card.querySelector('.ctrl-sy input[type=number]');
        if (syRange) syRange.value = String(acc.scaleY !== undefined ? acc.scaleY : 1.0);
        if (syNum) syNum.value = String(parseFloat(acc.scaleY !== undefined ? acc.scaleY : 1.0).toFixed(2));

        const rotRange = card.querySelector('.ctrl-rot input[type=range]');
        const rotNum = card.querySelector('.ctrl-rot input[type=number]');
        if (rotRange) rotRange.value = String(acc.rotation || 0);
        if (rotNum) rotNum.value = String(acc.rotation || 0);

        const exprSelect = card.querySelector('.acc-expr-select');
        if (exprSelect && document.activeElement !== exprSelect) {
          populateExpressionSelect(exprSelect, acc.expression || "");
        }
      }
      return;
    }

    // Card doesn't exist yet; build it
    card = document.createElement("div");
    card.className = "accessory-card";
    card.dataset.accId = acc.id;

    const isOpen = openDrawers.has(acc.id);

    // Header row
    const header = document.createElement("div");
    header.className = "accessory-header";

    const info = document.createElement("div");
    info.className = "accessory-info";

    const title = document.createElement("div");
    title.className = "accessory-title";
    title.textContent = acc.name || acc.file;

    const meta = document.createElement("div");
    meta.className = "accessory-meta";
    meta.textContent = `${acc.file} • ${acc.target || 'layer_head'}`;

    info.appendChild(title);
    info.appendChild(meta);

    const controls = document.createElement("div");
    controls.className = "accessory-controls";

    // Equip Switch
    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    switchLabel.title = acc.enabled ? "Unequip Accessory" : "Equip Accessory";
    const switchInput = document.createElement("input");
    switchInput.type = "checkbox";
    switchInput.checked = Boolean(acc.enabled);
    switchInput.addEventListener("change", async (e) => {
      e.stopPropagation();
      acc.enabled = switchInput.checked;
      try {
        await fetch("/api/accessories/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: acc.id })
        });
        flashAccessorySaved();
        if (accessoryCountBadge) {
          const activeCount = configuredAccessories.filter(a => a.enabled).length;
          accessoryCountBadge.textContent = `${activeCount}/${configuredAccessories.length}`;
        }
      } catch (err) {
        console.error("[Studio Tracker] Toggle error:", err);
      }
    });
    const switchSlider = document.createElement("span");
    switchSlider.className = "switch-slider";
    switchLabel.appendChild(switchInput);
    switchLabel.appendChild(switchSlider);

    // Open in Dressing Room button
    const btnFit = document.createElement("button");
    btnFit.className = "btn btn-secondary";
    btnFit.style.fontSize = "10px";
    btnFit.style.padding = "2px 7px";
    btnFit.innerHTML = "🪞 Fit";
    btnFit.title = "Open in Dressing Room for large preview & precision positioning";
    btnFit.addEventListener("click", (e) => {
      e.stopPropagation();
      openDressingRoom(acc.id);
    });

    // Remove button
    const btnRemove = document.createElement("button");
    btnRemove.className = "btn btn-secondary";
    btnRemove.style.fontSize = "10px";
    btnRemove.style.padding = "2px 6px";
    btnRemove.textContent = "✕";
    btnRemove.title = "Delete accessory";
    btnRemove.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${acc.name || acc.file}"?`)) {
        try {
          await fetch("/api/accessories/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: acc.id })
          });
          openDrawers.delete(acc.id);
          await loadAccessories();
        } catch (err) {
          console.error("[Studio Tracker] Remove error:", err);
        }
      }
    });

    // Expand arrow
    const expandIcon = document.createElement("span");
    expandIcon.style.fontSize = "11px";
    expandIcon.style.color = "var(--text-muted)";
    expandIcon.textContent = isOpen ? "▲" : "▼";

    controls.appendChild(switchLabel);
    controls.appendChild(btnFit);
    controls.appendChild(btnRemove);
    controls.appendChild(expandIcon);

    header.appendChild(info);
    header.appendChild(controls);

    // Drawer for Position, Stretch, Rotation
    const drawer = document.createElement("div");
    drawer.className = `accessory-drawer ${isOpen ? "open" : ""}`;

    // Target, Order, and Expression row
    const targetRow = document.createElement("div");
    targetRow.style.display = "grid";
    targetRow.style.gridTemplateColumns = "1fr 1fr 1fr";
    targetRow.style.gap = "8px";

    const targetGroup = document.createElement("div");
    targetGroup.innerHTML = `
      <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Anchor Target</label>
      <select class="form-select acc-target-select" style="width: 100%; background: #191924; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; font-size: 12px;">
        <option value="layer_head">layer_head (Head Anchor)</option>
        <option value="head">head (Face Anchor)</option>
        <option value="root_svg">root_svg (Root Space)</option>
      </select>
    `;
    const targetSelect = targetGroup.querySelector("select");
    if (acc.target) {
      if (!["layer_head", "head", "root_svg"].includes(acc.target)) {
        const customOpt = document.createElement("option");
        customOpt.value = acc.target;
        customOpt.textContent = acc.target;
        targetSelect.appendChild(customOpt);
      }
      targetSelect.value = acc.target;
    }
    targetSelect.addEventListener("change", (e) => {
      acc.target = e.target.value;
      meta.textContent = `${acc.file} • ${acc.target}`;
      debounceSaveAccessory(acc);
    });

    const orderGroup = document.createElement("div");
    orderGroup.innerHTML = `
      <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Layer Order</label>
      <select class="form-select acc-order-select" style="width: 100%; background: #191924; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; font-size: 12px;">
        <option value="front">In Front (Foreground)</option>
        <option value="back">Behind (Background)</option>
      </select>
    `;
    const orderSelect = orderGroup.querySelector("select");
    orderSelect.value = acc.order || "front";
    orderSelect.addEventListener("change", (e) => {
      acc.order = e.target.value;
      debounceSaveAccessory(acc);
    });

    const exprGroup = document.createElement("div");
    exprGroup.innerHTML = `
      <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Expression Trigger</label>
      <select class="form-select acc-expr-select" style="width: 100%; background: #191924; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; font-size: 12px;">
      </select>
    `;
    const exprSelect = exprGroup.querySelector("select");
    populateExpressionSelect(exprSelect, acc.expression || "");
    exprSelect.addEventListener("change", (e) => {
      if (e.target.value === "__custom__") {
        const customName = prompt("Enter custom expression trigger name (e.g. sweat, crying, angry):");
        if (customName && customName.trim()) {
          const clean = customName.trim().toLowerCase();
          acc.expression = clean;
          populateExpressionSelect(exprSelect, clean);
          debounceSaveAccessory(acc);
          flashAccessorySaved();
        } else {
          exprSelect.value = acc.expression || "";
        }
        return;
      }
      acc.expression = e.target.value;
      debounceSaveAccessory(acc);
      flashAccessorySaved();
    });

    targetRow.appendChild(targetGroup);
    targetRow.appendChild(orderGroup);
    targetRow.appendChild(exprGroup);
    drawer.appendChild(targetRow);

    // Helper to build a slider row with linked numeric input
    function makeSliderRow(label, min, max, step, val, className, onChange) {
      const row = document.createElement("div");
      row.className = `slider-item ${className || ''}`;
      row.style.gridTemplateColumns = "110px 1fr 62px";

      const lbl = document.createElement("label");
      lbl.textContent = label;
      lbl.style.fontSize = "11px";

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(val);

      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.className = "slider-num-input";
      numInput.min = String(min);
      numInput.max = String(max);
      numInput.step = String(step);
      numInput.value = String(parseFloat(val).toFixed(step < 1 ? 2 : 0));

      input.addEventListener("input", (e) => {
        const num = parseFloat(e.target.value);
        numInput.value = num.toFixed(step < 1 ? 2 : 0);
        onChange(num);
      });

      numInput.addEventListener("input", (e) => {
        const num = parseFloat(e.target.value);
        if (!isNaN(num)) {
          input.value = String(num);
          onChange(num);
        }
      });

      row.appendChild(lbl);
      row.appendChild(input);
      row.appendChild(numInput);
      return { row, input, numInput };
    }

    // X Position: -1000px to +1000px
    const xCtrl = makeSliderRow("Position X (px)", -1000, 1000, 1, acc.x || 0, "ctrl-x", (val) => {
      acc.x = val;
      debounceSaveAccessory(acc);
    });
    drawer.appendChild(xCtrl.row);

    // Y Position: -1000px to +1000px
    const yCtrl = makeSliderRow("Position Y (px)", -1000, 1000, 1, acc.y || 0, "ctrl-y", (val) => {
      acc.y = val;
      debounceSaveAccessory(acc);
    });
    drawer.appendChild(yCtrl.row);

    // Scale X (Stretch Width): 0.05 to 5.0
    const scaleXCtrl = makeSliderRow("Scale X (Width)", 0.05, 5.0, 0.05, acc.scaleX !== undefined ? acc.scaleX : 1.0, "ctrl-sx", (val) => {
      acc.scaleX = val;
      debounceSaveAccessory(acc);
    });
    drawer.appendChild(scaleXCtrl.row);

    // Scale Y (Stretch Height): 0.05 to 5.0
    const scaleYCtrl = makeSliderRow("Scale Y (Height)", 0.05, 5.0, 0.05, acc.scaleY !== undefined ? acc.scaleY : 1.0, "ctrl-sy", (val) => {
      acc.scaleY = val;
      debounceSaveAccessory(acc);
    });
    drawer.appendChild(scaleYCtrl.row);

    // Rotation: -180 to +180 deg
    const rotCtrl = makeSliderRow("Rotation (°)", -180, 180, 1, acc.rotation || 0, "ctrl-rot", (val) => {
      acc.rotation = val;
      debounceSaveAccessory(acc);
    });
    drawer.appendChild(rotCtrl.row);

    // Reset Button Row
    const actionRow = document.createElement("div");
    actionRow.style.display = "flex";
    actionRow.style.justifyContent = "flex-end";
    actionRow.style.gap = "8px";
    actionRow.style.marginTop = "4px";

    const btnReset = document.createElement("button");
    btnReset.className = "btn btn-secondary";
    btnReset.style.fontSize = "10px";
    btnReset.style.padding = "3px 8px";
    btnReset.textContent = "Reset Transforms";
    btnReset.addEventListener("click", () => {
      acc.x = 0;
      acc.y = 0;
      acc.scaleX = 1.0;
      acc.scaleY = 1.0;
      acc.rotation = 0;
      xCtrl.input.value = "0";
      xCtrl.numInput.value = "0";
      yCtrl.input.value = "0";
      yCtrl.numInput.value = "0";
      scaleXCtrl.input.value = "1";
      scaleXCtrl.numInput.value = "1.00";
      scaleYCtrl.input.value = "1";
      scaleYCtrl.numInput.value = "1.00";
      rotCtrl.input.value = "0";
      rotCtrl.numInput.value = "0";
      debounceSaveAccessory(acc);
    });
    actionRow.appendChild(btnReset);
    drawer.appendChild(actionRow);

    // Toggle drawer on header click
    header.addEventListener("click", () => {
      if (openDrawers.has(acc.id)) {
        openDrawers.delete(acc.id);
        drawer.classList.remove("open");
        expandIcon.textContent = "▼";
      } else {
        openDrawers.add(acc.id);
        drawer.classList.add("open");
        expandIcon.textContent = "▲";
      }
    });

    card.appendChild(header);
    card.appendChild(drawer);
    accessoryListEl.appendChild(card);
  });
}

async function equipNewAccessory(filename) {
  const baseName = filename.replace(/\.svg$/i, "");
  const cleanId = baseName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const uniqueId = `${cleanId}_${Date.now().toString(36).slice(-4)}`;

  const displayName = baseName
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  const newAcc = {
    id: uniqueId,
    file: filename,
    name: displayName,
    target: "layer_head",
    x: 0,
    y: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    order: "front",
    enabled: true
  };

  openDrawers.add(uniqueId);
  try {
    const res = await fetch("/api/accessories/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAcc)
    });
    if (res.ok) {
      await loadAccessories();
      flashAccessorySaved();
    }
  } catch (err) {
    console.error("[Studio Tracker] Equip accessory error:", err);
  }
}

if (btnRefreshAccessories) {
  btnRefreshAccessories.addEventListener("click", async () => {
    btnRefreshAccessories.disabled = true;
    btnRefreshAccessories.textContent = "↻ ...";
    try {
      await loadAccessories();
    } finally {
      btnRefreshAccessories.disabled = false;
      btnRefreshAccessories.textContent = "↻ Refresh";
    }
  });
}

loadAccessories();

// ==========================================
// Dressing Room Modal Interactive Controller
// ==========================================
let activeModalAccId = null;
let currentNudgeStep = 1;

const dressingRoomModal = document.getElementById("dressing-room-modal");
const btnOpenDressingRoom = document.getElementById("btn-open-dressing-room");
const btnCloseDressingRoom = document.getElementById("btn-close-dressing-room");
const modalBtnDone = document.getElementById("modal-btn-done");
const modalBtnReset = document.getElementById("modal-btn-reset");
const modalSaveIndicator = document.getElementById("modal-save-indicator");

const modalAccessorySelect = document.getElementById("modal-accessory-select");
const modalAccessoryToggle = document.getElementById("modal-accessory-toggle");
const modalTargetSelect = document.getElementById("modal-target-select");
const modalOrderSelect = document.getElementById("modal-order-select");
const modalExpressionSelect = document.getElementById("modal-expression-select");

const modalSliderX = document.getElementById("modal-slider-x");
const modalNumX = document.getElementById("modal-num-x");
const modalSliderY = document.getElementById("modal-slider-y");
const modalNumY = document.getElementById("modal-num-y");
const modalSliderSX = document.getElementById("modal-slider-sx");
const modalNumSX = document.getElementById("modal-num-sx");
const modalSliderSY = document.getElementById("modal-slider-sy");
const modalNumSY = document.getElementById("modal-num-sy");
const modalSliderRot = document.getElementById("modal-slider-rot");
const modalNumRot = document.getElementById("modal-num-rot");
const modalLinkScale = document.getElementById("modal-link-scale");

const fittingFrame = document.getElementById("fitting-frame");
const fittingCrosshair = document.getElementById("fitting-crosshair");
const checkShowCrosshair = document.getElementById("check-show-crosshair");
const fittingZoomBadge = document.getElementById("fitting-zoom-badge");
const btnZoomReset = document.getElementById("btn-zoom-reset");
const btnZoomHead = document.getElementById("btn-zoom-head");
const btnZoomTight = document.getElementById("btn-zoom-tight");
const btnReloadFitting = document.getElementById("btn-reload-fitting");

const nudgeUp = document.getElementById("nudge-up");
const nudgeDown = document.getElementById("nudge-down");
const nudgeLeft = document.getElementById("nudge-left");
const nudgeRight = document.getElementById("nudge-right");
const nudgeCenter = document.getElementById("nudge-center");
const nudgeStepBtns = document.querySelectorAll(".nudge-step-btn");

const btnRotLeft = document.getElementById("btn-rot-left");
const btnRotZero = document.getElementById("btn-rot-zero");
const btnRotRight = document.getElementById("btn-rot-right");

function populateExpressionSelect(selectEl, selectedVal = "") {
  if (!selectEl) return;
  const currentVal = selectedVal || "";
  selectEl.innerHTML = "";

  const alwaysOpt = document.createElement("option");
  alwaysOpt.value = "";
  alwaysOpt.textContent = "Always Visible";
  selectEl.appendChild(alwaysOpt);

  const seen = new Set([""]);
  if (Array.isArray(availableExpressions)) {
    availableExpressions.forEach(expr => {
      if (!seen.has(expr)) {
        seen.add(expr);
        const opt = document.createElement("option");
        opt.value = expr;
        opt.textContent = `${expr.charAt(0).toUpperCase() + expr.slice(1)} (Expression Trigger)`;
        selectEl.appendChild(opt);
      }
    });
  }

  // If custom expression value is set and not in available list
  if (currentVal && !seen.has(currentVal)) {
    const customOpt = document.createElement("option");
    customOpt.value = currentVal;
    customOpt.textContent = `${customOpt.value} (Custom Expression)`;
    selectEl.appendChild(customOpt);
  }

  const addCustomOpt = document.createElement("option");
  addCustomOpt.value = "__custom__";
  addCustomOpt.textContent = "+ Custom Expression...";
  selectEl.appendChild(addCustomOpt);

  selectEl.value = currentVal;
}

function updateAllExpressionDropdowns() {
  if (modalExpressionSelect) {
    const acc = getActiveModalAcc();
    populateExpressionSelect(modalExpressionSelect, acc ? acc.expression : "");
  }
  const allCardSelects = document.querySelectorAll(".acc-expr-select");
  allCardSelects.forEach(sel => {
    const card = sel.closest(".accessory-card");
    if (card && card.dataset.accId) {
      const acc = configuredAccessories.find(a => a.id === card.dataset.accId);
      if (acc && document.activeElement !== sel) {
        populateExpressionSelect(sel, acc.expression || "");
      }
    }
  });
}

function flashModalSaved() {
  if (modalSaveIndicator) {
    modalSaveIndicator.style.opacity = "1";
    setTimeout(() => {
      modalSaveIndicator.style.opacity = "0";
    }, 1200);
  }
}

function getActiveModalAcc() {
  if (!activeModalAccId) return null;
  return configuredAccessories.find(a => a.id === activeModalAccId) || null;
}

function syncModalControlsFromAcc(acc) {
  if (!acc) {
    if (modalAccessorySelect) modalAccessorySelect.value = "";
    return;
  }

  if (modalAccessorySelect) modalAccessorySelect.value = acc.id;
  if (modalAccessoryToggle) modalAccessoryToggle.checked = Boolean(acc.enabled);

  if (modalTargetSelect) {
    if (!["layer_head", "head", "root_svg"].includes(acc.target)) {
      const customOpt = document.createElement("option");
      customOpt.value = acc.target;
      customOpt.textContent = acc.target;
      modalTargetSelect.appendChild(customOpt);
    }
    modalTargetSelect.value = acc.target || "layer_head";
  }

  if (modalOrderSelect) {
    modalOrderSelect.value = acc.order || "front";
  }

  if (modalExpressionSelect) {
    populateExpressionSelect(modalExpressionSelect, acc.expression || "");
  }

  const xVal = acc.x || 0;
  if (modalSliderX) modalSliderX.value = String(xVal);
  if (modalNumX) modalNumX.value = String(xVal);

  const yVal = acc.y || 0;
  if (modalSliderY) modalSliderY.value = String(yVal);
  if (modalNumY) modalNumY.value = String(yVal);

  const sxVal = acc.scaleX !== undefined ? acc.scaleX : 1.0;
  if (modalSliderSX) modalSliderSX.value = String(sxVal);
  if (modalNumSX) modalNumSX.value = String(parseFloat(sxVal).toFixed(2));

  const syVal = acc.scaleY !== undefined ? acc.scaleY : 1.0;
  if (modalSliderSY) modalSliderSY.value = String(syVal);
  if (modalNumSY) modalNumSY.value = String(parseFloat(syVal).toFixed(2));

  const rotVal = acc.rotation || 0;
  if (modalSliderRot) modalSliderRot.value = String(rotVal);
  if (modalNumRot) modalNumRot.value = String(rotVal);
}

function openDressingRoom(accId = null) {
  if (!dressingRoomModal) return;

  // Populate accessory select options
  if (modalAccessorySelect) {
    modalAccessorySelect.innerHTML = "";
    if (configuredAccessories.length === 0) {
      modalAccessorySelect.innerHTML = '<option value="">No accessories available</option>';
    } else {
      configuredAccessories.forEach(acc => {
        const opt = document.createElement("option");
        opt.value = acc.id;
        opt.textContent = `${acc.name || acc.file} (${acc.enabled ? "Equipped" : "Off"})`;
        modalAccessorySelect.appendChild(opt);
      });
    }
  }

  // Determine active accessory ID
  if (accId && configuredAccessories.some(a => a.id === accId)) {
    activeModalAccId = accId;
  } else if (configuredAccessories.length > 0) {
    activeModalAccId = configuredAccessories[0].id;
  } else {
    activeModalAccId = null;
  }

  syncModalControlsFromAcc(getActiveModalAcc());

  // Show modal
  dressingRoomModal.style.display = "flex";

  // Reload fitting mirror iframe
  if (fittingFrame) {
    fittingFrame.src = `/overlay?t=${Date.now()}`;
  }
}

function closeDressingRoom() {
  if (!dressingRoomModal) return;
  dressingRoomModal.style.display = "none";
  renderAccessoriesUI();
  reloadAvatarFrame();
}

if (btnOpenDressingRoom) {
  btnOpenDressingRoom.addEventListener("click", () => openDressingRoom());
}

if (btnCloseDressingRoom) {
  btnCloseDressingRoom.addEventListener("click", closeDressingRoom);
}

if (modalBtnDone) {
  modalBtnDone.addEventListener("click", closeDressingRoom);
}

// Close on backdrop click
if (dressingRoomModal) {
  dressingRoomModal.addEventListener("click", (e) => {
    if (e.target === dressingRoomModal) {
      closeDressingRoom();
    }
  });
}

// Close on Escape key & D-pad keyboard navigation
window.addEventListener("keydown", (e) => {
  if (!dressingRoomModal || dressingRoomModal.style.display === "none") return;

  if (e.key === "Escape") {
    closeDressingRoom();
    return;
  }

  // If focused inside a number or text input, allow normal typing
  if (e.target.tagName === "INPUT" && (e.target.type === "number" || e.target.type === "text")) {
    return;
  }

  const acc = getActiveModalAcc();
  if (!acc) return;

  const step = e.shiftKey ? currentNudgeStep * 10 : currentNudgeStep;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    acc.y = (acc.y || 0) - step;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    acc.y = (acc.y || 0) + step;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    acc.x = (acc.x || 0) - step;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    acc.x = (acc.x || 0) + step;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  }
});

// Accessory Switcher in Modal
if (modalAccessorySelect) {
  modalAccessorySelect.addEventListener("change", (e) => {
    activeModalAccId = e.target.value;
    syncModalControlsFromAcc(getActiveModalAcc());
  });
}

if (modalAccessoryToggle) {
  modalAccessoryToggle.addEventListener("change", async (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.enabled = modalAccessoryToggle.checked;
    try {
      await fetch("/api/accessories/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: acc.id })
      });
      flashModalSaved();
      flashAccessorySaved();
      if (modalAccessorySelect) {
        const opt = modalAccessorySelect.querySelector(`option[value="${acc.id}"]`);
        if (opt) opt.textContent = `${acc.name || acc.file} (${acc.enabled ? "Equipped" : "Off"})`;
      }
    } catch (err) {
      console.error("[Studio Tracker] Modal toggle error:", err);
    }
  });
}

if (modalTargetSelect) {
  modalTargetSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.target = e.target.value;
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

if (modalOrderSelect) {
  modalOrderSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.order = e.target.value;
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

if (modalExpressionSelect) {
  modalExpressionSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    if (e.target.value === "__custom__") {
      const customName = prompt("Enter custom expression trigger name (e.g. sweat, crying, angry):");
      if (customName && customName.trim()) {
        const clean = customName.trim().toLowerCase();
        acc.expression = clean;
        populateExpressionSelect(modalExpressionSelect, clean);
        debounceSaveAccessory(acc);
        flashModalSaved();
      } else {
        modalExpressionSelect.value = acc.expression || "";
      }
      return;
    }
    acc.expression = e.target.value;
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

// Modal Slider & Input Binding Helper
function bindModalSlider(sliderEl, numEl, onVal) {
  if (sliderEl && numEl) {
    sliderEl.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      numEl.value = val.toFixed(sliderEl.step < 1 ? 2 : 0);
      onVal(val);
    });
    numEl.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        sliderEl.value = String(val);
        onVal(val);
      }
    });
  }
}

bindModalSlider(modalSliderX, modalNumX, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.x = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});

bindModalSlider(modalSliderY, modalNumY, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.y = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});

bindModalSlider(modalSliderSX, modalNumSX, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.scaleX = val;
  if (modalLinkScale && modalLinkScale.checked) {
    acc.scaleY = val;
    if (modalSliderSY) modalSliderSY.value = String(val);
    if (modalNumSY) modalNumSY.value = val.toFixed(2);
  }
  debounceSaveAccessory(acc);
  flashModalSaved();
});

bindModalSlider(modalSliderSY, modalNumSY, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.scaleY = val;
  if (modalLinkScale && modalLinkScale.checked) {
    acc.scaleX = val;
    if (modalSliderSX) modalSliderSX.value = String(val);
    if (modalNumSX) modalNumSX.value = val.toFixed(2);
  }
  debounceSaveAccessory(acc);
  flashModalSaved();
});

bindModalSlider(modalSliderRot, modalNumRot, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.rotation = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});

// Quick Rotation Buttons
if (btnRotLeft) {
  btnRotLeft.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = (acc.rotation || 0) - 15;
    if (modalSliderRot) modalSliderRot.value = String(acc.rotation);
    if (modalNumRot) modalNumRot.value = String(acc.rotation);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

if (btnRotZero) {
  btnRotZero.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = 0;
    if (modalSliderRot) modalSliderRot.value = "0";
    if (modalNumRot) modalNumRot.value = "0";
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

if (btnRotRight) {
  btnRotRight.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = (acc.rotation || 0) + 15;
    if (modalSliderRot) modalSliderRot.value = String(acc.rotation);
    if (modalNumRot) modalNumRot.value = String(acc.rotation);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

// Reset Transforms in Modal
if (modalBtnReset) {
  modalBtnReset.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.x = 0;
    acc.y = 0;
    acc.scaleX = 1.0;
    acc.scaleY = 1.0;
    acc.rotation = 0;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

// Nudge Step Selection
nudgeStepBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    nudgeStepBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentNudgeStep = parseInt(btn.dataset.step, 10) || 1;
  });
});

// D-Pad Click Handlers
function applyNudge(dx, dy) {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.x = (acc.x || 0) + dx;
  acc.y = (acc.y || 0) + dy;
  if (modalSliderX) modalSliderX.value = String(acc.x);
  if (modalNumX) modalNumX.value = String(acc.x);
  if (modalSliderY) modalSliderY.value = String(acc.y);
  if (modalNumY) modalNumY.value = String(acc.y);
  debounceSaveAccessory(acc);
  flashModalSaved();
}

if (nudgeUp) nudgeUp.addEventListener("click", () => applyNudge(0, -currentNudgeStep));
if (nudgeDown) nudgeDown.addEventListener("click", () => applyNudge(0, currentNudgeStep));
if (nudgeLeft) nudgeLeft.addEventListener("click", () => applyNudge(-currentNudgeStep, 0));
if (nudgeRight) nudgeRight.addEventListener("click", () => applyNudge(currentNudgeStep, 0));
if (nudgeCenter) {
  nudgeCenter.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.x = 0;
    acc.y = 0;
    if (modalSliderX) modalSliderX.value = "0";
    if (modalNumX) modalNumX.value = "0";
    if (modalSliderY) modalSliderY.value = "0";
    if (modalNumY) modalNumY.value = "0";
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}

// Zoom & Mirror Controls
if (btnZoomReset) {
  btnZoomReset.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(1)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "1.0x Zoom";
  });
}
if (btnZoomHead) {
  btnZoomHead.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(1.5) translateY(12%)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "1.5x Head";
  });
}
if (btnZoomTight) {
  btnZoomTight.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(2.0) translateY(18%)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "2.0x Face";
  });
}
if (btnReloadFitting) {
  btnReloadFitting.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.src = `/overlay?t=${Date.now()}`;
  });
}
if (checkShowCrosshair) {
  checkShowCrosshair.addEventListener("change", (e) => {
    if (fittingCrosshair) {
      fittingCrosshair.style.display = e.target.checked ? "block" : "none";
    }
  });
}

