// web/src/studio/index.ts
import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// web/src/studio/pose.ts
function extractEulerAngles(matrix) {
  if (!matrix || matrix.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  }
  const m00 = matrix[0], m10 = matrix[1], m20 = matrix[2];
  const m01 = matrix[4], m11 = matrix[5], m21 = matrix[6];
  const m02 = matrix[8], m12 = matrix[9], m22 = matrix[10];
  const m03 = matrix[12], m13 = matrix[13], m23 = matrix[14];
  const pitchRad = Math.asin(-Math.max(-1, Math.min(1, m12)));
  const yawRad = Math.atan2(m02, m22);
  const rollRad = Math.atan2(m10, m11);
  const radToDeg = 180 / Math.PI;
  const normalizeZero = (v) => Math.abs(v) < 1e-9 ? 0 : v;
  return {
    yaw: normalizeZero(yawRad * radToDeg),
    pitch: normalizeZero(pitchRad * radToDeg),
    roll: normalizeZero(rollRad * radToDeg),
    x: normalizeZero(m03),
    y: normalizeZero(m13),
    z: normalizeZero(m23)
  };
}

// web/src/studio/audio.ts
function calculateRMS(data) {
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}
function stepAudioVolume(currentSmoothed, rms, decay = 0.1) {
  if (rms > currentSmoothed) {
    return rms;
  }
  return currentSmoothed * (1 - decay) + rms * decay;
}
function evaluateSpeechGate(volume, micGain = 1.5, noiseGate = 0.04) {
  return volume * micGain >= noiseGate;
}

// web/src/studio/settings.ts
function createDebouncedSaver(saveFn, delayMs = 80) {
  let timer = null;
  return (payload) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveFn(payload).catch((err) => {
        console.error("[Settings] Auto-save error:", err);
      });
    }, delayMs);
  };
}

// web/src/studio/expressions.ts
function shouldIgnoreHotkey(targetTagName) {
  if (!targetTagName) return false;
  const upper = targetTagName.toUpperCase();
  return upper === "INPUT" || upper === "TEXTAREA" || upper === "SELECT";
}
function resolveHotkeyIndex(key, availableExpressions2) {
  const keyNum = parseInt(key, 10);
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
    const idx = keyNum - 1;
    if (availableExpressions2 && availableExpressions2[idx]) {
      return availableExpressions2[idx];
    }
  }
  return null;
}

// web/src/studio/dressing-room.ts
function nudgePosition(x, y, dx, dy, step = 1) {
  return {
    x: Math.round((x + dx * step) * 100) / 100,
    y: Math.round((y + dy * step) * 100) / 100
  };
}
function nudgeRotation(currentRot, deltaRot) {
  let rot = (currentRot + deltaRot) % 360;
  if (rot > 180) rot -= 360;
  if (rot < -180) rot += 360;
  return rot;
}
function computeLinkedScale(newScale, isLinked, axis, currentSX, currentSY) {
  if (isLinked) {
    return { scaleX: newScale, scaleY: newScale };
  }
  return {
    scaleX: axis === "x" ? newScale : currentSX,
    scaleY: axis === "y" ? newScale : currentSY
  };
}
function formatFittingMirrorUrl(isFrozen) {
  const freezeParam = isFrozen ? "&freeze=1" : "";
  return `/overlay?t=${Date.now()}${freezeParam}`;
}

// web/src/studio/index.ts
var video = document.getElementById("webcam");
var canvas = document.getElementById("landmark-canvas");
var canvasCtx = canvas ? canvas.getContext("2d") : null;
var cameraSelect = document.getElementById("camera-select");
var btnToggleCamera = document.getElementById("btn-toggle-camera");
var btnCalibrate = document.getElementById("btn-calibrate");
var trackingStatus = document.getElementById("tracking-status");
var fpsDisplay = document.getElementById("fps-display");
var micSelect = document.getElementById("mic-select");
var btnToggleMic = document.getElementById("btn-toggle-mic");
var modeSelect = document.getElementById("mode-select");
var settingsModeSelect = document.getElementById("settings-mode-select");
var vuMeterBar = document.getElementById("vu-meter-bar");
var noiseGateMarker = document.getElementById("noise-gate-marker");
var valVuMeter = document.getElementById("val-vu-meter");
var gaugeYaw = document.getElementById("gauge-yaw");
var gaugePitch = document.getElementById("gauge-pitch");
var gaugeRoll = document.getElementById("gauge-roll");
var valYaw = document.getElementById("val-yaw");
var valPitch = document.getElementById("val-pitch");
var valRoll = document.getElementById("val-roll");
var gaugeBlinkL = document.getElementById("gauge-blink-l");
var gaugeBlinkR = document.getElementById("gauge-blink-r");
var valBlinkL = document.getElementById("val-blink-l");
var valBlinkR = document.getElementById("val-blink-r");
var blinkThresholdMarkerL = document.getElementById("blink-threshold-marker-l");
var blinkThresholdMarkerR = document.getElementById("blink-threshold-marker-r");
var gaugeMouthOpen = document.getElementById("gauge-mouth-open");
var gaugeSmile = document.getElementById("gauge-smile");
var valSmile = document.getElementById("val-smile");
var smileThresholdMarker = document.getElementById("smile-threshold-marker");
var sliderMouthGain = document.getElementById("slider-mouth-gain");
var sliderMouthThreshold = document.getElementById("slider-mouth-threshold");
var checkboxEnableSmile = document.getElementById("check-enable-smile");
var sliderSmileThreshold = document.getElementById("slider-smile-threshold");
var checkboxWinkIsBlink = document.getElementById("check-wink-is-blink");
var checkboxAutoBlink = document.getElementById("check-auto-blink");
var selectAutoBlinkMode = document.getElementById("select-auto-blink-mode");
var sliderAutoBlinkInterval = document.getElementById("slider-auto-blink-interval");
var valAutoBlinkInterval = document.getElementById("val-auto-blink-interval");
var checkboxAutoGaze = document.getElementById("check-auto-gaze");
var selectAutoGazeMode = document.getElementById("select-auto-gaze-mode");
var sliderAutoGazeRange = document.getElementById("slider-auto-gaze-range");
var valAutoGazeRange = document.getElementById("val-auto-gaze-range");
var checkboxAutoTilt = document.getElementById("check-auto-tilt");
var selectAutoTiltMode = document.getElementById("select-auto-tilt-mode");
var sliderAutoTiltAmount = document.getElementById("slider-auto-tilt-amount");
var valAutoTiltAmount = document.getElementById("val-auto-tilt-amount");
var checkboxPhysicsEnabled = document.getElementById("check-physics-enabled");
var sliderPhysicsAmount = document.getElementById("slider-physics-amount");
var valPhysicsAmount = document.getElementById("val-physics-amount");
var sliderBlinkThresholdL = document.getElementById("slider-blink-threshold-l");
var sliderBlinkThresholdR = document.getElementById("slider-blink-threshold-r");
var sliderBlinkSyncDelay = document.getElementById("slider-blink-sync-delay");
var sliderEyeGain = document.getElementById("slider-eye-gain");
var sliderYawMultiplier = document.getElementById("slider-yaw-multiplier");
var sliderPitchMultiplier = document.getElementById("slider-pitch-multiplier");
var sliderMicGain = document.getElementById("slider-mic-gain");
var sliderNoiseGate = document.getElementById("slider-noise-gate");
var sliderDecaySmooth = document.getElementById("slider-decay-smooth");
var sliderBounceAmount = document.getElementById("slider-bounce-amount");
var valMicGain = document.getElementById("val-mic-gain");
var valNoiseGate = document.getElementById("val-noise-gate");
var valDecaySmooth = document.getElementById("val-decay-smooth");
var valBounceAmount = document.getElementById("val-bounce-amount");
var valMouthGain = document.getElementById("val-mouth-gain");
var valMouthThreshold = document.getElementById("val-mouth-threshold");
var valSmileThreshold = document.getElementById("val-smile-threshold");
var valBlinkThresholdL = document.getElementById("val-blink-threshold-l");
var valBlinkThresholdR = document.getElementById("val-blink-threshold-r");
var valBlinkSyncDelay = document.getElementById("val-blink-sync-delay");
var valEyeGain = document.getElementById("val-eye-gain");
var valYawMultiplier = document.getElementById("val-yaw-multiplier");
var valPitchMultiplier = document.getElementById("val-pitch-multiplier");
var btnSaveSettings = document.getElementById("btn-save-settings");
var btnResetSettings = document.getElementById("btn-reset-settings");
var saveStatus = document.getElementById("save-status");
var configPathDisplay = document.getElementById("config-path-display");
var faceLandmarker = null;
var webcamRunning = false;
var socket = null;
var reconnectTimer = null;
var lastVideoTime = -1;
var frameCount = 0;
var lastFpsTime = performance.now();
var drawingUtils = null;
var isProcessing = false;
var animFrameId = null;
var tickerWorker = null;
var audioContext = null;
var micStream = null;
var micSource = null;
var analyserNode = null;
var audioDataArray = null;
var micRunning = false;
var smoothedAudioVol = 0;
var latestRawPose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
var latestRawBlendshapes = {};
function initTickerWorker() {
  if (tickerWorker) return;
  try {
    const workerBlob = new Blob(
      [
        `
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
    `
      ],
      { type: "application/javascript" }
    );
    tickerWorker = new Worker(URL.createObjectURL(workerBlob));
    tickerWorker.onmessage = () => {
      if (webcamRunning) {
        if (document.hidden) {
          processFrame(false);
        }
      } else {
        if (document.hidden) {
          processCameraOffFrame(false);
        }
      }
    };
    tickerWorker.postMessage("start");
  } catch (err) {
    console.warn("[Studio Tracker] Could not initialize background worker ticker:", err);
  }
}
function getOrCreateAudioContext() {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
  } catch (e) {
    console.warn("[Studio Tracker] Web Audio keep-alive error:", e);
  }
  return audioContext;
}
async function populateAudioDevices() {
  try {
    const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
    const currentVal = micSelect && micSelect.value ? micSelect.value : savedMic;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter((d) => d.kind === "audioinput");
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
async function toggleMic() {
  if (micRunning) {
    stopMic();
    return;
  }
  await startMic();
}
async function startMic() {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
  const deviceId = micSelect && micSelect.value ? micSelect.value : savedMic;
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
      tickerWorker.postMessage("start");
    }
    if (!webcamRunning) {
      startCameraOffLoop();
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
    try {
      micSource.disconnect();
    } catch (e) {
    }
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
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
    startCameraOffLoop();
  }
}
function sampleAudio() {
  if (!micRunning || !analyserNode || !audioDataArray) {
    return null;
  }
  analyserNode.getFloatTimeDomainData(audioDataArray);
  const rms = calculateRMS(audioDataArray);
  const decay = parseFloat(sliderDecaySmooth?.value || "0.10");
  smoothedAudioVol = stepAudioVolume(smoothedAudioVol, rms, decay);
  const micGain = parseFloat(sliderMicGain?.value || "1.5");
  const noiseGate = parseFloat(sliderNoiseGate?.value || "0.04");
  const isSpeaking = evaluateSpeechGate(smoothedAudioVol, micGain, noiseGate);
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
  const micGain = parseFloat(sliderMicGain?.value || "1.5");
  const noiseGate = parseFloat(sliderNoiseGate?.value || "0.04");
  const displayPercent = Math.min(100, Math.round(audioState.volume * micGain * 100));
  vuMeterBar.style.width = `${displayPercent}%`;
  valVuMeter.textContent = `${displayPercent}%`;
  if (audioState.isSpeaking) {
    vuMeterBar.style.background = "#22c55e";
  } else {
    vuMeterBar.style.background = "#4b5563";
  }
  if (noiseGateMarker) {
    const gatePercent = Math.min(100, Math.round(noiseGate * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}
var cameraOffAnimId = null;
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
    } catch (e) {
    }
  };
  socket.onclose = () => {
    updateStatus("Server Disconnected", "status-error");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2e3);
    }
  };
  socket.onerror = (err) => {
    console.error("[Studio Tracker] WebSocket error:", err);
    socket?.close();
  };
}
function updateStatus(text, className) {
  if (trackingStatus) {
    trackingStatus.textContent = text;
    trackingStatus.className = `status-badge ${className}`;
  }
}
function showCalibratedFlash() {
  if (btnCalibrate) {
    btnCalibrate.textContent = "\u2713 Calibrated!";
    btnCalibrate.style.background = "#22c55e";
    setTimeout(() => {
      btnCalibrate.textContent = "Set Neutral Pose";
      btnCalibrate.style.background = "";
    }, 1200);
  }
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
          el.title = `Commit: ${data.commit}
Built: ${data.date || "unknown"}`;
        }
      }
    }
  } catch (err) {
    console.debug("[Studio] Could not fetch /api/version:", err);
  }
}
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
    if (canvasCtx) {
      drawingUtils = new DrawingUtils(canvasCtx);
    }
    console.log("[Studio Tracker] MediaPipe FaceLandmarker initialized.");
    updateStatus("Model Ready. Start Camera.", "status-ok");
    if (btnToggleCamera) btnToggleCamera.disabled = false;
    initTickerWorker();
    fetchAppVersion();
    await populateCameraDevices();
    await populateAudioDevices();
    const cameraActive = localStorage.getItem("svgtuber_camera_active");
    if (cameraActive === "true" || cameraActive === null) {
      console.log("[Studio Tracker] Auto-starting camera stream on load...");
      startCamera().catch((e) => {
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
    const currentVal = cameraSelect && cameraSelect.value ? cameraSelect.value : savedCam;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
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
async function startCamera(deviceId = null) {
  if (!video) return;
  if (video.srcObject) {
    try {
      video.srcObject.getTracks().forEach((t) => t.stop());
    } catch (e) {
    }
    video.srcObject = null;
  }
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  const savedCam = localStorage.getItem("svgtuber_camera_id") || "";
  const targetId = deviceId || cameraSelect && cameraSelect.value || savedCam;
  let stream;
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
    const effectiveId = targetId || cameraSelect && cameraSelect.value;
    if (effectiveId) {
      localStorage.setItem("svgtuber_camera_id", effectiveId);
      if (cameraSelect) cameraSelect.value = effectiveId;
    }
    if (btnToggleCamera) {
      btnToggleCamera.textContent = "Stop Camera";
      btnToggleCamera.classList.add("btn-danger");
    }
    updateStatus("Tracking Active", "status-ok");
    if (canvas && video) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }
    populateCameraDevices();
    populateAudioDevices();
    getOrCreateAudioContext();
    if (tickerWorker) {
      tickerWorker.postMessage("start");
    }
    const micActive = localStorage.getItem("svgtuber_mic_active");
    if (micActive === "true" && !micRunning) {
      startMic().catch((e) => console.warn("[Studio Tracker] Auto-restore mic:", e));
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
function stopCamera() {
  webcamRunning = false;
  localStorage.setItem("svgtuber_camera_active", "false");
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  startCameraOffLoop();
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (btnToggleCamera) {
    btnToggleCamera.textContent = "Start Camera";
    btnToggleCamera.classList.remove("btn-danger");
  }
  updateStatus(micRunning ? "Camera Off (Face Lost) - Audio Active" : "Camera Off (Face Lost)", "status-warn");
  if (canvasCtx && canvas) {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
  resetTrackingGauges();
  sendTrackingLoss();
}
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
function processFrame(renderUI = true) {
  if (!webcamRunning || !faceLandmarker || isProcessing || !video) return;
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
      const blendshapes = {};
      if (results.faceBlendshapes && results.faceBlendshapes[0]) {
        results.faceBlendshapes[0].categories.forEach((c) => {
          blendshapes[c.categoryName] = c.score;
        });
      }
      let pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes[0]) {
        pose = extractEulerAngles(results.facialTransformationMatrixes[0].data);
      }
      const audioState = sampleAudio();
      if (renderUI) {
        updateAudioUI(audioState);
      }
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
          blendshapes,
          audio: audioState || void 0
        };
        socket.send(JSON.stringify(frame));
      }
      latestRawPose = pose;
      latestRawBlendshapes = blendshapes;
      if (renderUI) {
        updateTrackingGauges(pose, blendshapes);
        drawLandmarks(landmarks);
      }
    } else {
      const audioState = sampleAudio();
      if (renderUI) {
        updateAudioUI(audioState);
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        const frame = {
          timestamp: now,
          present: false,
          audio: audioState || void 0
        };
        socket.send(JSON.stringify(frame));
      }
      if (renderUI) {
        if (canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        resetTrackingGauges();
      }
    }
  } catch (err) {
    console.error("[Studio Tracker] Detection error:", err);
  } finally {
    isProcessing = false;
  }
}
function predictLoop() {
  if (!webcamRunning) return;
  processFrame(true);
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1e3) {
    const fps = Math.round(frameCount * 1e3 / (now - lastFpsTime));
    if (fpsDisplay) fpsDisplay.textContent = `${fps} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }
  animFrameId = requestAnimationFrame(predictLoop);
}
function drawLandmarks(landmarks) {
  if (!canvasCtx || !canvas || !drawingUtils) return;
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#38bdf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#38bdf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, { color: "#818cf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, { color: "#818cf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#f43f5e", lineWidth: 1.5 });
  canvasCtx.restore();
}
function updateTrackingGauges(pose, blendshapes) {
  if (valYaw) valYaw.textContent = `${pose.yaw > 0 ? "+" : ""}${pose.yaw.toFixed(1)}\xB0`;
  if (valPitch) valPitch.textContent = `${pose.pitch > 0 ? "+" : ""}${pose.pitch.toFixed(1)}\xB0`;
  if (valRoll) valRoll.textContent = `${pose.roll > 0 ? "+" : ""}${pose.roll.toFixed(1)}\xB0`;
  const blinkL = blendshapes.eyeBlinkLeft || 0;
  const blinkR = blendshapes.eyeBlinkRight || 0;
  if (valBlinkL) valBlinkL.textContent = `${Math.round(blinkL * 100)}%`;
  if (valBlinkR) valBlinkR.textContent = `${Math.round(blinkR * 100)}%`;
  if (gaugeBlinkL) gaugeBlinkL.style.width = `${Math.min(100, Math.round(blinkL * 100))}%`;
  if (gaugeBlinkR) gaugeBlinkR.style.width = `${Math.min(100, Math.round(blinkR * 100))}%`;
  const jawOpen = blendshapes.jawOpen || 0;
  if (gaugeMouthOpen) gaugeMouthOpen.style.width = `${Math.min(100, Math.round(jawOpen * 100))}%`;
  const smile = Math.max(blendshapes.mouthSmileLeft || 0, blendshapes.mouthSmileRight || 0);
  if (valSmile) valSmile.textContent = `${Math.round(smile * 100)}%`;
  if (gaugeSmile) gaugeSmile.style.width = `${Math.min(100, Math.round(smile * 100))}%`;
}
function resetTrackingGauges() {
  if (valYaw) valYaw.textContent = "0.0\xB0";
  if (valPitch) valPitch.textContent = "0.0\xB0";
  if (valRoll) valRoll.textContent = "0.0\xB0";
  if (valBlinkL) valBlinkL.textContent = "0%";
  if (valBlinkR) valBlinkR.textContent = "0%";
  if (gaugeBlinkL) gaugeBlinkL.style.width = "0%";
  if (gaugeBlinkR) gaugeBlinkR.style.width = "0%";
  if (gaugeMouthOpen) gaugeMouthOpen.style.width = "0%";
  if (valSmile) valSmile.textContent = "0%";
  if (gaugeSmile) gaugeSmile.style.width = "0%";
}
function sendTrackingLoss() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        timestamp: performance.now(),
        present: false
      })
    );
  }
}
if (btnCalibrate) {
  btnCalibrate.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "calibrate" }));
    }
  });
}
if (btnToggleCamera) {
  btnToggleCamera.addEventListener("click", toggleCamera);
}
if (btnToggleMic) {
  btnToggleMic.addEventListener("click", toggleMic);
}
if (cameraSelect) {
  cameraSelect.addEventListener("change", (e) => {
    const targetId = e.target.value;
    startCamera(targetId);
  });
}
if (micSelect) {
  micSelect.addEventListener("change", (e) => {
    const targetId = e.target.value;
    localStorage.setItem("svgtuber_mic_id", targetId);
    if (micRunning) {
      stopMic();
      startMic();
    }
  });
}
var activeSettings = null;
var debouncedSaveSettings = createDebouncedSaver(async (settings) => {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    if (res.ok && saveStatus) {
      saveStatus.textContent = "\u2713 Saved!";
      saveStatus.style.opacity = "1";
      setTimeout(() => {
        saveStatus.style.opacity = "0";
      }, 1500);
    }
  } catch (err) {
    console.error("[Studio Tracker] Error saving settings:", err);
  }
}, 80);
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
    if (sliderMouthGain) sliderMouthGain.value = String(t.mouthGain || 1.4);
    if (sliderMouthThreshold) sliderMouthThreshold.value = String(t.mouthThreshold || 0.08);
    if (checkboxEnableSmile) checkboxEnableSmile.checked = t.enableSmile !== false;
    if (sliderSmileThreshold) sliderSmileThreshold.value = String(t.smileThreshold || 0.5);
    if (checkboxWinkIsBlink) checkboxWinkIsBlink.checked = Boolean(t.winkIsBlink);
    if (checkboxAutoBlink) checkboxAutoBlink.checked = t.autoBlink !== false;
    if (selectAutoBlinkMode) selectAutoBlinkMode.value = t.autoBlinkMode || "always";
    if (sliderAutoBlinkInterval) sliderAutoBlinkInterval.value = String(t.autoBlinkIntervalSec || 4);
    if (checkboxAutoGaze) checkboxAutoGaze.checked = t.autoGaze !== false;
    if (selectAutoGazeMode) selectAutoGazeMode.value = t.autoGazeMode || "always";
    if (sliderAutoGazeRange) sliderAutoGazeRange.value = String(t.autoGazeRange || 1);
    if (checkboxAutoTilt) checkboxAutoTilt.checked = t.autoTilt !== false;
    if (selectAutoTiltMode) selectAutoTiltMode.value = t.autoTiltMode || "always";
    if (sliderAutoTiltAmount) sliderAutoTiltAmount.value = String(t.autoTiltAmount || 1);
    if (checkboxPhysicsEnabled) checkboxPhysicsEnabled.checked = t.physicsEnabled !== false;
    if (sliderPhysicsAmount)
      sliderPhysicsAmount.value = String(t.physicsAmount !== void 0 ? t.physicsAmount : 1);
    if (sliderBlinkThresholdL)
      sliderBlinkThresholdL.value = String(t.blinkThresholdL || t.blinkThreshold || 0.45);
    if (sliderBlinkThresholdR)
      sliderBlinkThresholdR.value = String(t.blinkThresholdR || t.blinkThreshold || 0.45);
    if (sliderBlinkSyncDelay)
      sliderBlinkSyncDelay.value = String(t.blinkSyncDelayMs !== void 0 ? t.blinkSyncDelayMs : 50);
    if (sliderEyeGain) sliderEyeGain.value = String(t.eyeGazeGain || 1);
    if (sliderYawMultiplier) sliderYawMultiplier.value = String(t.yawMultiplier || 1);
    if (sliderPitchMultiplier) sliderPitchMultiplier.value = String(t.pitchMultiplier || 1);
  }
  if (s.audio) {
    const a = s.audio;
    const mode = a.mode || "hybrid";
    if (modeSelect) modeSelect.value = mode;
    if (settingsModeSelect) settingsModeSelect.value = mode;
    if (sliderMicGain) sliderMicGain.value = String(a.micGain || 1.5);
    if (sliderNoiseGate) sliderNoiseGate.value = String(a.noiseGate || 0.04);
    if (sliderDecaySmooth) sliderDecaySmooth.value = String(a.decaySmooth || 0.1);
    if (sliderBounceAmount)
      sliderBounceAmount.value = String(a.bounceAmount !== void 0 ? a.bounceAmount : 1);
  }
  updateSliderLabels();
}
function updateSliderLabels() {
  if (valMouthGain && sliderMouthGain)
    valMouthGain.textContent = `${parseFloat(sliderMouthGain.value).toFixed(2)}x`;
  if (valMouthThreshold && sliderMouthThreshold)
    valMouthThreshold.textContent = parseFloat(sliderMouthThreshold.value).toFixed(2);
  if (valSmileThreshold && sliderSmileThreshold)
    valSmileThreshold.textContent = parseFloat(sliderSmileThreshold.value).toFixed(2);
  if (valBlinkThresholdL && sliderBlinkThresholdL)
    valBlinkThresholdL.textContent = parseFloat(sliderBlinkThresholdL.value).toFixed(2);
  if (valBlinkThresholdR && sliderBlinkThresholdR)
    valBlinkThresholdR.textContent = parseFloat(sliderBlinkThresholdR.value).toFixed(2);
  if (valBlinkSyncDelay && sliderBlinkSyncDelay)
    valBlinkSyncDelay.textContent = `${sliderBlinkSyncDelay.value}ms`;
  if (valAutoBlinkInterval && sliderAutoBlinkInterval)
    valAutoBlinkInterval.textContent = `${parseFloat(sliderAutoBlinkInterval.value).toFixed(1)}s`;
  if (valAutoGazeRange && sliderAutoGazeRange)
    valAutoGazeRange.textContent = `${parseFloat(sliderAutoGazeRange.value).toFixed(1)}x`;
  if (valAutoTiltAmount && sliderAutoTiltAmount)
    valAutoTiltAmount.textContent = `${parseFloat(sliderAutoTiltAmount.value).toFixed(1)}x`;
  if (valPhysicsAmount && sliderPhysicsAmount)
    valPhysicsAmount.textContent = `${parseFloat(sliderPhysicsAmount.value).toFixed(1)}x`;
  if (valEyeGain && sliderEyeGain)
    valEyeGain.textContent = `${parseFloat(sliderEyeGain.value).toFixed(1)}x`;
  if (valYawMultiplier && sliderYawMultiplier)
    valYawMultiplier.textContent = `${parseFloat(sliderYawMultiplier.value).toFixed(1)}x`;
  if (valPitchMultiplier && sliderPitchMultiplier)
    valPitchMultiplier.textContent = `${parseFloat(sliderPitchMultiplier.value).toFixed(1)}x`;
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
  if (valMicGain && sliderMicGain)
    valMicGain.textContent = `${parseFloat(sliderMicGain.value).toFixed(1)}x`;
  if (valNoiseGate && sliderNoiseGate)
    valNoiseGate.textContent = parseFloat(sliderNoiseGate.value).toFixed(2);
  if (valDecaySmooth && sliderDecaySmooth)
    valDecaySmooth.textContent = parseFloat(sliderDecaySmooth.value).toFixed(2);
  if (valBounceAmount && sliderBounceAmount)
    valBounceAmount.textContent = `${parseFloat(sliderBounceAmount.value).toFixed(1)}x`;
  if (noiseGateMarker && sliderNoiseGate) {
    const gatePercent = Math.min(100, Math.round(parseFloat(sliderNoiseGate.value) * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}
function collectSettingsFromUI() {
  return {
    version: 1,
    tracking: {
      mouthGain: parseFloat(sliderMouthGain?.value || "1.4"),
      mouthThreshold: parseFloat(sliderMouthThreshold?.value || "0.08"),
      enableSmile: checkboxEnableSmile ? checkboxEnableSmile.checked : true,
      smileThreshold: parseFloat(sliderSmileThreshold?.value || "0.50"),
      blinkThreshold: parseFloat(sliderBlinkThresholdL?.value || "0.45"),
      blinkThresholdL: parseFloat(sliderBlinkThresholdL?.value || "0.45"),
      blinkThresholdR: parseFloat(sliderBlinkThresholdR?.value || "0.45"),
      blinkSyncDelayMs: parseFloat(sliderBlinkSyncDelay?.value || "50"),
      winkIsBlink: checkboxWinkIsBlink ? checkboxWinkIsBlink.checked : false,
      autoBlink: checkboxAutoBlink ? checkboxAutoBlink.checked : true,
      autoBlinkMode: selectAutoBlinkMode ? selectAutoBlinkMode.value : "always",
      autoBlinkIntervalSec: parseFloat(sliderAutoBlinkInterval?.value || "4.0"),
      autoGaze: checkboxAutoGaze ? checkboxAutoGaze.checked : true,
      autoGazeMode: selectAutoGazeMode ? selectAutoGazeMode.value : "always",
      autoGazeRange: parseFloat(sliderAutoGazeRange?.value || "1.0"),
      autoTilt: checkboxAutoTilt ? checkboxAutoTilt.checked : true,
      autoTiltMode: selectAutoTiltMode ? selectAutoTiltMode.value : "always",
      autoTiltAmount: parseFloat(sliderAutoTiltAmount?.value || "1.0"),
      physicsEnabled: checkboxPhysicsEnabled ? checkboxPhysicsEnabled.checked : true,
      physicsAmount: parseFloat(
        sliderPhysicsAmount?.value !== void 0 ? sliderPhysicsAmount.value : "1.0"
      ),
      eyeGazeGain: parseFloat(sliderEyeGain?.value || "1.0"),
      yawMultiplier: parseFloat(sliderYawMultiplier?.value || "1.0"),
      pitchMultiplier: parseFloat(sliderPitchMultiplier?.value || "1.0"),
      rollMultiplier: 1,
      poseSmoothing: 1
    },
    audio: {
      mode: settingsModeSelect?.value || modeSelect?.value || "hybrid",
      micGain: parseFloat(sliderMicGain?.value || "1.5"),
      noiseGate: parseFloat(sliderNoiseGate?.value || "0.04"),
      decaySmooth: parseFloat(sliderDecaySmooth?.value || "0.10"),
      bounceAmount: parseFloat(
        sliderBounceAmount?.value !== void 0 ? sliderBounceAmount.value : "1.0"
      )
    }
  };
}
function onSliderInput() {
  updateSliderLabels();
  const current = collectSettingsFromUI();
  debouncedSaveSettings(current);
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
].forEach((slider) => {
  if (slider) {
    slider.addEventListener("input", onSliderInput);
  }
});
function onModeChange(e) {
  const newMode = e.target.value;
  if (modeSelect) modeSelect.value = newMode;
  if (settingsModeSelect) settingsModeSelect.value = newMode;
  const current = collectSettingsFromUI();
  debouncedSaveSettings(current);
}
if (modeSelect) modeSelect.addEventListener("change", onModeChange);
if (settingsModeSelect) settingsModeSelect.addEventListener("change", onModeChange);
[
  checkboxEnableSmile,
  checkboxWinkIsBlink,
  checkboxAutoBlink,
  checkboxAutoGaze,
  checkboxAutoTilt,
  checkboxPhysicsEnabled
].forEach((cb) => {
  if (cb) cb.addEventListener("change", onSliderInput);
});
[selectAutoBlinkMode, selectAutoGazeMode, selectAutoTiltMode].forEach((sel) => {
  if (sel) sel.addEventListener("change", onSliderInput);
});
if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", () => {
    debouncedSaveSettings(collectSettingsFromUI());
  });
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
          saveStatus.textContent = "\u2713 Defaults Reset!";
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
var availableExpressions = [];
var avatarExpressions = [];
var activeExpressions = {};
var expressionsContainer = document.getElementById("expressions-container");
var btnClearExpressions = document.getElementById("btn-clear-expressions");
var expressionCountBadge = document.getElementById("expression-count-badge");
var expressionStatus = document.getElementById("expression-status");
async function loadExpressions() {
  try {
    const res = await fetch("/api/expressions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    activeExpressions = data.active || {};
    availableExpressions = data.available || [];
    avatarExpressions = data.avatarExpressions || [];
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
    expressionCountBadge.textContent = String(availableExpressions.length);
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
    copyBtn.textContent = "\u{1F4CB}";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const apiUrl = `${location.origin}/api/expressions/toggle?name=${encodeURIComponent(name)}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(apiUrl).then(() => {
          if (expressionStatus) {
            expressionStatus.textContent = `Copied URL for "${name}"!`;
            setTimeout(() => {
              expressionStatus.textContent = "";
            }, 2e3);
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
  if (expressionsContainer) {
    const buttons = expressionsContainer.querySelectorAll(".expr-btn");
    buttons.forEach((btn) => {
      const name = btn.dataset.name || "";
      if (activeExpressions[name]) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }
  const acc = getActiveModalAcc();
  if (acc) {
    renderModalExpressionPreview(acc);
  }
}
async function toggleExpression(name) {
  try {
    const res = await fetch(`/api/expressions/toggle?name=${encodeURIComponent(name)}`, {
      method: "POST"
    });
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
var btnReloadAvatar = document.getElementById("btn-reload-avatar");
if (btnReloadAvatar) {
  btnReloadAvatar.addEventListener("click", async () => {
    btnReloadAvatar.disabled = true;
    btnReloadAvatar.textContent = "Reloading...";
    try {
      await fetch("/api/avatar/reload", { method: "POST" });
      await loadExpressions();
      if (expressionStatus) {
        expressionStatus.textContent = "Avatar rig reloaded!";
        setTimeout(() => {
          expressionStatus.textContent = "";
        }, 2e3);
      }
    } catch (e) {
      console.error("[Studio Tracker] Reload rig error:", e);
    } finally {
      btnReloadAvatar.disabled = false;
      btnReloadAvatar.textContent = "\u21BB Reload Rig";
    }
  });
}
window.addEventListener("keydown", (e) => {
  const targetTag = e.target?.tagName;
  if (shouldIgnoreHotkey(targetTag)) return;
  const match = resolveHotkeyIndex(e.key, availableExpressions);
  if (match) {
    e.preventDefault();
    toggleExpression(match);
  }
});
var avatarSelect = document.getElementById("avatar-select");
var avatarDirLabel = document.getElementById("avatar-dir-label");
var btnRefreshAvatars = document.getElementById("btn-refresh-avatars");
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
      avatarDirLabel.textContent = `\u{1F4C1} ${dir}`;
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
      if (!res.ok) throw new Error(`Failed to switch avatar: ${res.statusText}`);
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
      btnRefreshAvatars.textContent = "\u21BB Scan Folder";
    }
  });
}
var availableAccessoryFiles = [];
var configuredAccessories = [];
var accessoryFileExpressions = {};
var accessoryDebounceMap = /* @__PURE__ */ new Map();
var accessoryCountBadge = document.getElementById("accessory-count-badge");
var accessoryListEl = document.getElementById("accessory-list");
var availableAccessoriesChipsEl = document.getElementById("available-accessories-chips");
var accessorySaveIndicator = document.getElementById("accessory-save-indicator");
var btnRefreshAccessories = document.getElementById("btn-refresh-accessories");
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
    accessoryFileExpressions = data.fileExpressions || {};
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
    const activeCount = configuredAccessories.filter((a) => a.enabled).length;
    accessoryCountBadge.textContent = `${activeCount}/${configuredAccessories.length}`;
  }
  if (availableAccessoriesChipsEl) {
    const currentChipsKey = availableAccessoriesChipsEl.dataset.files || "";
    const newChipsKey = availableAccessoryFiles.join(",");
    if (currentChipsKey !== newChipsKey) {
      availableAccessoriesChipsEl.dataset.files = newChipsKey;
      availableAccessoriesChipsEl.innerHTML = "";
      if (availableAccessoryFiles.length === 0) {
        availableAccessoriesChipsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No .svg files in avatar accessories/ folder</span>';
      } else {
        availableAccessoryFiles.forEach((file) => {
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
  const firstChild = accessoryListEl.firstElementChild;
  if (firstChild && !firstChild.classList.contains("accessory-card")) {
    accessoryListEl.innerHTML = "";
  }
  const currentIds = new Set(configuredAccessories.map((a) => a.id));
  Array.from(accessoryListEl.children).forEach((child) => {
    if (child.dataset && child.dataset.accId && !currentIds.has(child.dataset.accId)) {
      child.remove();
    }
  });
  configuredAccessories.forEach((acc) => {
    let card = accessoryListEl.querySelector(
      `.accessory-card[data-acc-id="${CSS.escape(acc.id)}"]`
    );
    const exprText = acc.expression ? ` \u2022 Trigger: ${acc.expression}` : "";
    const metaText = `${acc.file} \u2022 ${acc.target || "layer_head"}${exprText}`;
    if (card) {
      const meta2 = card.querySelector(".accessory-meta");
      if (meta2) meta2.textContent = metaText;
      const switchInput2 = card.querySelector(".switch input");
      if (switchInput2 && document.activeElement !== switchInput2) {
        switchInput2.checked = Boolean(acc.enabled);
      }
      return;
    }
    card = document.createElement("div");
    card.className = "accessory-card";
    card.dataset.accId = acc.id;
    const header = document.createElement("div");
    header.className = "accessory-header";
    const info = document.createElement("div");
    info.className = "accessory-info";
    const title = document.createElement("div");
    title.className = "accessory-title";
    title.textContent = acc.name || acc.file;
    const meta = document.createElement("div");
    meta.className = "accessory-meta";
    meta.textContent = `${acc.file} \u2022 ${acc.target || "layer_head"}`;
    info.appendChild(title);
    info.appendChild(meta);
    const controls = document.createElement("div");
    controls.className = "accessory-controls";
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
          const activeCount = configuredAccessories.filter((a) => a.enabled).length;
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
    const btnFit = document.createElement("button");
    btnFit.className = "btn btn-secondary";
    btnFit.style.fontSize = "10px";
    btnFit.style.padding = "2px 7px";
    btnFit.innerHTML = "\u{1FA9E} Fit";
    btnFit.title = "Open in Dressing Room for large preview & precision positioning";
    btnFit.addEventListener("click", (e) => {
      e.stopPropagation();
      openDressingRoom(acc.id);
    });
    const btnRemove = document.createElement("button");
    btnRemove.className = "btn btn-secondary";
    btnRemove.style.fontSize = "10px";
    btnRemove.style.padding = "2px 6px";
    btnRemove.textContent = "\u2715";
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
          await loadAccessories();
        } catch (err) {
          console.error("[Studio Tracker] Remove error:", err);
        }
      }
    });
    controls.appendChild(switchLabel);
    controls.appendChild(btnFit);
    controls.appendChild(btnRemove);
    header.style.cursor = "pointer";
    header.title = "Click to fit in Dressing Room";
    header.addEventListener("click", () => {
      openDressingRoom(acc.id);
    });
    header.appendChild(info);
    header.appendChild(controls);
    card.appendChild(header);
    accessoryListEl.appendChild(card);
  });
  renderModalDiscoveredAccessoriesChips();
}
var modalDiscoveredAccessoriesChipsEl = document.getElementById(
  "modal-discovered-accessories-chips"
);
var modalBtnRefreshAccessories = document.getElementById(
  "modal-btn-refresh-accessories"
);
function renderModalDiscoveredAccessoriesChips() {
  if (!modalDiscoveredAccessoriesChipsEl) return;
  modalDiscoveredAccessoriesChipsEl.innerHTML = "";
  if (availableAccessoryFiles.length === 0) {
    modalDiscoveredAccessoriesChipsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No .svg files found in accessories directory.</span>';
    return;
  }
  const activeAcc = getActiveModalAcc();
  availableAccessoryFiles.forEach((file) => {
    const isEquipped = configuredAccessories.some((a) => a.file === file);
    const isSelected = activeAcc && activeAcc.file === file;
    const chip = document.createElement("button");
    chip.className = `acc-chip ${isSelected ? "active-modal-chip" : ""}`;
    chip.style.fontSize = "11px";
    chip.style.padding = "3px 8px";
    chip.style.display = "inline-flex";
    chip.style.alignItems = "center";
    chip.style.gap = "5px";
    if (isEquipped) {
      chip.title = `${file} is equipped. Click to select & adjust in Dressing Room.`;
      chip.innerHTML = `<span style="color: var(--success); font-weight: bold;">\u2713</span> <span>${file}</span>`;
      chip.addEventListener("click", () => {
        const acc = configuredAccessories.find((a) => a.file === file);
        if (acc) {
          activeModalAccId = acc.id;
          if (modalAccessorySelect) modalAccessorySelect.value = acc.id;
          syncModalControlsFromAcc(acc);
          renderModalExpressionPreview(acc);
          renderModalDiscoveredAccessoriesChips();
        }
      });
    } else {
      chip.title = `Click to equip ${file} to avatar`;
      chip.innerHTML = `<span style="color: var(--accent); font-weight: bold;">+</span> <span>${file}</span>`;
      chip.addEventListener("click", async () => {
        await equipNewAccessory(file);
      });
    }
    modalDiscoveredAccessoriesChipsEl.appendChild(chip);
  });
}
if (modalBtnRefreshAccessories) {
  modalBtnRefreshAccessories.addEventListener("click", async () => {
    modalBtnRefreshAccessories.disabled = true;
    modalBtnRefreshAccessories.textContent = "\u21BB ...";
    try {
      await loadAccessories();
    } finally {
      modalBtnRefreshAccessories.disabled = false;
      modalBtnRefreshAccessories.textContent = "\u21BB Refresh";
    }
  });
}
async function equipNewAccessory(filename) {
  const baseName = filename.replace(/\.svg$/i, "");
  const cleanId = baseName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const uniqueId = `${cleanId}_${Date.now().toString(36).slice(-4)}`;
  const displayName = baseName.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const defaultExprs = accessoryFileExpressions[filename] || [];
  const initialExpr = defaultExprs.length > 0 ? defaultExprs[0] : "";
  const newAcc = {
    id: uniqueId,
    file: filename,
    name: displayName,
    target: "layer_head",
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    order: "front",
    enabled: true,
    expression: initialExpr
  };
  try {
    const res = await fetch("/api/accessories/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAcc)
    });
    if (res.ok) {
      await loadAccessories();
      flashAccessorySaved();
      openDressingRoom(uniqueId);
    }
  } catch (err) {
    console.error("[Studio Tracker] Equip accessory error:", err);
  }
}
if (btnRefreshAccessories) {
  btnRefreshAccessories.addEventListener("click", async () => {
    btnRefreshAccessories.disabled = true;
    btnRefreshAccessories.textContent = "\u21BB ...";
    try {
      await loadAccessories();
    } finally {
      btnRefreshAccessories.disabled = false;
      btnRefreshAccessories.textContent = "\u21BB Refresh";
    }
  });
}
var activeModalAccId = null;
var currentNudgeStep = 1;
var dressingRoomModal = document.getElementById("dressing-room-modal");
var btnOpenDressingRoom = document.getElementById("btn-open-dressing-room");
var btnCloseDressingRoom = document.getElementById("btn-close-dressing-room");
var modalBtnDone = document.getElementById("modal-btn-done");
var modalBtnReset = document.getElementById("modal-btn-reset");
var modalSaveIndicator = document.getElementById("modal-save-indicator");
var modalAccessorySelect = document.getElementById("modal-accessory-select");
var modalAccessoryToggle = document.getElementById("modal-accessory-toggle");
var modalTargetSelect = document.getElementById("modal-target-select");
var modalOrderSelect = document.getElementById("modal-order-select");
var modalExpressionSelect = document.getElementById("modal-expression-select");
var modalSliderX = document.getElementById("modal-slider-x");
var modalNumX = document.getElementById("modal-num-x");
var modalSliderY = document.getElementById("modal-slider-y");
var modalNumY = document.getElementById("modal-num-y");
var modalSliderSX = document.getElementById("modal-slider-sx");
var modalNumSX = document.getElementById("modal-num-sx");
var modalSliderSY = document.getElementById("modal-slider-sy");
var modalNumSY = document.getElementById("modal-num-sy");
var modalSliderRot = document.getElementById("modal-slider-rot");
var modalNumRot = document.getElementById("modal-num-rot");
var modalLinkScale = document.getElementById("modal-link-scale");
var fittingFrame = document.getElementById("fitting-frame");
var fittingCrosshair = document.getElementById("fitting-crosshair");
var checkShowCrosshair = document.getElementById("check-show-crosshair");
var fittingZoomBadge = document.getElementById("fitting-zoom-badge");
var btnZoomReset = document.getElementById("btn-zoom-reset");
var btnZoomHead = document.getElementById("btn-zoom-head");
var btnZoomTight = document.getElementById("btn-zoom-tight");
var btnReloadFitting = document.getElementById("btn-reload-fitting");
var btnFittingFreeze = document.getElementById("btn-fitting-freeze");
var fittingMirrorFrozen = true;
var nudgeUp = document.getElementById("nudge-up");
var nudgeDown = document.getElementById("nudge-down");
var nudgeLeft = document.getElementById("nudge-left");
var nudgeRight = document.getElementById("nudge-right");
var nudgeCenter = document.getElementById("nudge-center");
var nudgeStepBtns = document.querySelectorAll(".nudge-step-btn");
var btnRotLeft = document.getElementById("btn-rot-left");
var btnRotZero = document.getElementById("btn-rot-zero");
var btnRotRight = document.getElementById("btn-rot-right");
function populateExpressionSelect(selectEl, selectedVal = "") {
  const currentVal = selectedVal || "";
  selectEl.innerHTML = "";
  const alwaysOpt = document.createElement("option");
  alwaysOpt.value = "";
  alwaysOpt.textContent = "Always Visible";
  selectEl.appendChild(alwaysOpt);
  const seen = /* @__PURE__ */ new Set([""]);
  if (Array.isArray(availableExpressions)) {
    availableExpressions.forEach((expr) => {
      if (!seen.has(expr)) {
        seen.add(expr);
        const opt = document.createElement("option");
        opt.value = expr;
        opt.textContent = `${expr.charAt(0).toUpperCase() + expr.slice(1)} (Expression Trigger)`;
        selectEl.appendChild(opt);
      }
    });
  }
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
}
var modalExprAlert = document.getElementById("modal-expr-alert");
var modalExprAlertText = document.getElementById("modal-expr-alert-text");
var modalBtnEnableExpr = document.getElementById("modal-btn-enable-expr");
var modalAccessoryExprCard = document.getElementById("modal-accessory-expr-card");
var modalAccessoryExpressionChips = document.getElementById(
  "modal-accessory-expression-chips"
);
var modalAccessoryExprStatus = document.getElementById("modal-accessory-expr-status");
var modalAvatarExpressionChips = document.getElementById("modal-avatar-expression-chips");
function renderModalExpressionPreview(acc) {
  if (modalAvatarExpressionChips) {
    modalAvatarExpressionChips.innerHTML = "";
    const avatarList = Array.isArray(avatarExpressions) && avatarExpressions.length > 0 ? avatarExpressions : availableExpressions.filter((name) => {
      for (const file in accessoryFileExpressions) {
        if (accessoryFileExpressions[file]?.includes(name)) return false;
      }
      return true;
    });
    if (avatarList.length > 0) {
      avatarList.forEach((name) => {
        const isActive = Boolean(activeExpressions[name]);
        const pill = document.createElement("button");
        pill.className = `btn ${isActive ? "btn-primary" : "btn-secondary"}`;
        pill.style.fontSize = "10px";
        pill.style.padding = "2px 7px";
        pill.style.opacity = isActive ? "1" : "0.75";
        pill.textContent = `${name}: ${isActive ? "ON" : "OFF"}`;
        pill.title = `Toggle ${name} on avatar`;
        pill.addEventListener("click", () => {
          toggleExpression(name);
        });
        modalAvatarExpressionChips.appendChild(pill);
      });
    } else {
      const noneSpan = document.createElement("span");
      noneSpan.style.fontSize = "10px";
      noneSpan.style.color = "var(--text-muted)";
      noneSpan.textContent = "None defined in avatar SVG";
      modalAvatarExpressionChips.appendChild(noneSpan);
    }
  }
  const triggerExpr = acc && acc.expression && acc.expression.trim().toLowerCase() || "";
  if (modalExprAlert && modalExprAlertText && modalBtnEnableExpr) {
    if (triggerExpr && !activeExpressions[triggerExpr]) {
      modalExprAlert.style.display = "flex";
      modalExprAlertText.textContent = `Visibility Trigger "${triggerExpr}" is OFF (accessory is hidden in mirror).`;
      modalBtnEnableExpr.textContent = `Turn ON "${triggerExpr}"`;
      modalBtnEnableExpr.onclick = async () => {
        await toggleExpression(triggerExpr);
      };
    } else {
      modalExprAlert.style.display = "none";
    }
  }
  if (modalAccessoryExprCard && modalAccessoryExpressionChips) {
    const accFile = acc ? acc.file : "";
    const specificExprs = accFile && accessoryFileExpressions[accFile] || [];
    if (specificExprs.length === 0) {
      modalAccessoryExprCard.style.display = "none";
      modalAccessoryExpressionChips.innerHTML = "";
    } else {
      modalAccessoryExprCard.style.display = "block";
      if (modalAccessoryExprStatus) {
        modalAccessoryExprStatus.textContent = `Defined in ${accFile}`;
      }
      modalAccessoryExpressionChips.innerHTML = "";
      specificExprs.forEach((name) => {
        const isActive = Boolean(activeExpressions[name]);
        const btn = document.createElement("button");
        btn.className = `btn ${isActive ? "btn-primary" : "btn-secondary"}`;
        btn.style.fontSize = "11px";
        btn.style.padding = "4px 10px";
        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.gap = "6px";
        btn.title = `Click to ${isActive ? "turn OFF" : "turn ON"} "${name}" in mirror`;
        const dot = document.createElement("span");
        dot.style.fontSize = "9px";
        dot.textContent = isActive ? "\u{1F7E2}" : "\u26AA";
        const label = document.createElement("span");
        label.textContent = `${name.charAt(0).toUpperCase() + name.slice(1)}: ${isActive ? "ON" : "OFF"}`;
        btn.appendChild(dot);
        btn.appendChild(label);
        btn.addEventListener("click", () => {
          toggleExpression(name);
        });
        modalAccessoryExpressionChips.appendChild(btn);
      });
    }
  }
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
  return configuredAccessories.find((a) => a.id === activeModalAccId) || null;
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
      customOpt.textContent = customOpt.value;
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
  const sxVal = acc.scaleX !== void 0 ? acc.scaleX : 1;
  if (modalSliderSX) modalSliderSX.value = String(sxVal);
  if (modalNumSX) modalNumSX.value = String(parseFloat(String(sxVal)).toFixed(2));
  const syVal = acc.scaleY !== void 0 ? acc.scaleY : 1;
  if (modalSliderSY) modalSliderSY.value = String(syVal);
  if (modalNumSY) modalNumSY.value = String(parseFloat(String(syVal)).toFixed(2));
  const rotVal = acc.rotation || 0;
  if (modalSliderRot) modalSliderRot.value = String(rotVal);
  if (modalNumRot) modalNumRot.value = String(rotVal);
  renderModalExpressionPreview(acc);
}
function updateFittingMirrorSrc() {
  if (!fittingFrame) return;
  fittingFrame.src = formatFittingMirrorUrl(fittingMirrorFrozen);
  if (btnFittingFreeze) {
    btnFittingFreeze.textContent = fittingMirrorFrozen ? "\u{1F9D8} Rest Pose" : "\u{1F3A5} Live Motion";
    btnFittingFreeze.title = fittingMirrorFrozen ? "Mirror is in Rest Pose (Click for Live Motion)" : "Mirror is following Live Motion (Click for Rest Pose)";
    btnFittingFreeze.classList.toggle("btn-primary", !fittingMirrorFrozen);
    btnFittingFreeze.classList.toggle("btn-secondary", fittingMirrorFrozen);
  }
}
function openDressingRoom(accId = null) {
  if (!dressingRoomModal) return;
  if (modalAccessorySelect) {
    modalAccessorySelect.innerHTML = "";
    if (configuredAccessories.length === 0) {
      modalAccessorySelect.innerHTML = '<option value="">No accessories equipped (click a file below to equip)</option>';
    } else {
      configuredAccessories.forEach((acc) => {
        const opt = document.createElement("option");
        opt.value = acc.id;
        opt.textContent = `${acc.name || acc.file} (${acc.enabled ? "Equipped" : "Off"})`;
        modalAccessorySelect.appendChild(opt);
      });
    }
  }
  if (accId && configuredAccessories.some((a) => a.id === accId)) {
    activeModalAccId = accId;
  } else if (configuredAccessories.length > 0) {
    activeModalAccId = configuredAccessories[0].id;
  } else {
    activeModalAccId = null;
  }
  syncModalControlsFromAcc(getActiveModalAcc());
  dressingRoomModal.style.display = "flex";
  renderModalDiscoveredAccessoriesChips();
  renderModalExpressionPreview(getActiveModalAcc());
  updateFittingMirrorSrc();
}
function closeDressingRoom() {
  if (!dressingRoomModal) return;
  dressingRoomModal.style.display = "none";
  renderAccessoriesUI();
  reloadAvatarFrame();
}
if (btnOpenDressingRoom) btnOpenDressingRoom.addEventListener("click", () => openDressingRoom());
if (btnCloseDressingRoom) btnCloseDressingRoom.addEventListener("click", closeDressingRoom);
if (modalBtnDone) modalBtnDone.addEventListener("click", closeDressingRoom);
if (dressingRoomModal) {
  dressingRoomModal.addEventListener("click", (e) => {
    if (e.target === dressingRoomModal) {
      closeDressingRoom();
    }
  });
}
window.addEventListener("keydown", (e) => {
  if (!dressingRoomModal || dressingRoomModal.style.display === "none") return;
  if (e.key === "Escape") {
    closeDressingRoom();
    return;
  }
  const target = e.target;
  if (target.tagName === "INPUT" && (target.type === "number" || target.type === "text")) {
    return;
  }
  const acc = getActiveModalAcc();
  if (!acc) return;
  const step = e.shiftKey ? currentNudgeStep * 10 : currentNudgeStep;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 0, -1, step);
    acc.y = np.y;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 0, 1, step);
    acc.y = np.y;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, -1, 0, step);
    acc.x = np.x;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 1, 0, step);
    acc.x = np.x;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  }
});
if (modalAccessorySelect) {
  modalAccessorySelect.addEventListener("change", (e) => {
    activeModalAccId = e.target.value;
    syncModalControlsFromAcc(getActiveModalAcc());
    renderModalExpressionPreview(getActiveModalAcc());
    renderModalDiscoveredAccessoriesChips();
  });
}
if (modalAccessoryToggle) {
  modalAccessoryToggle.addEventListener("change", async () => {
    const acc = getActiveModalAcc();
    if (!acc || !modalAccessoryToggle) return;
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
    const val = e.target.value;
    if (val === "__custom__") {
      const customName = prompt("Enter custom expression trigger name (e.g. sweat, crying, angry):");
      if (customName && customName.trim()) {
        const clean = customName.trim().toLowerCase();
        acc.expression = clean;
        populateExpressionSelect(modalExpressionSelect, clean);
        renderModalExpressionPreview(acc);
        debounceSaveAccessory(acc);
        flashModalSaved();
      } else {
        modalExpressionSelect.value = acc.expression || "";
      }
      return;
    }
    acc.expression = val;
    renderModalExpressionPreview(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
function bindModalSlider(sliderEl, numEl, onVal) {
  if (sliderEl && numEl) {
    sliderEl.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      numEl.value = val.toFixed(parseFloat(sliderEl.step) < 1 ? 2 : 0);
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
  const isLinked = Boolean(modalLinkScale && modalLinkScale.checked);
  const scales = computeLinkedScale(val, isLinked, "x", acc.scaleX, acc.scaleY);
  acc.scaleX = scales.scaleX;
  acc.scaleY = scales.scaleY;
  if (isLinked) {
    if (modalSliderSY) modalSliderSY.value = String(val);
    if (modalNumSY) modalNumSY.value = val.toFixed(2);
  }
  debounceSaveAccessory(acc);
  flashModalSaved();
});
bindModalSlider(modalSliderSY, modalNumSY, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  const isLinked = Boolean(modalLinkScale && modalLinkScale.checked);
  const scales = computeLinkedScale(val, isLinked, "y", acc.scaleX, acc.scaleY);
  acc.scaleX = scales.scaleX;
  acc.scaleY = scales.scaleY;
  if (isLinked) {
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
if (btnRotLeft) {
  btnRotLeft.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = nudgeRotation(acc.rotation || 0, -15);
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
    acc.rotation = nudgeRotation(acc.rotation || 0, 15);
    if (modalSliderRot) modalSliderRot.value = String(acc.rotation);
    if (modalNumRot) modalNumRot.value = String(acc.rotation);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (modalBtnReset) {
  modalBtnReset.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.x = 0;
    acc.y = 0;
    acc.scaleX = 1;
    acc.scaleY = 1;
    acc.rotation = 0;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
nudgeStepBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    nudgeStepBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentNudgeStep = parseInt(btn.dataset.step || "1", 10) || 1;
  });
});
function applyNudge(dx, dy) {
  const acc = getActiveModalAcc();
  if (!acc) return;
  const np = nudgePosition(acc.x || 0, acc.y || 0, dx, dy, currentNudgeStep);
  acc.x = np.x;
  acc.y = np.y;
  if (modalSliderX) modalSliderX.value = String(acc.x);
  if (modalNumX) modalNumX.value = String(acc.x);
  if (modalSliderY) modalSliderY.value = String(acc.y);
  if (modalNumY) modalNumY.value = String(acc.y);
  debounceSaveAccessory(acc);
  flashModalSaved();
}
if (nudgeUp) nudgeUp.addEventListener("click", () => applyNudge(0, -1));
if (nudgeDown) nudgeDown.addEventListener("click", () => applyNudge(0, 1));
if (nudgeLeft) nudgeLeft.addEventListener("click", () => applyNudge(-1, 0));
if (nudgeRight) nudgeRight.addEventListener("click", () => applyNudge(1, 0));
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
if (btnFittingFreeze) {
  btnFittingFreeze.addEventListener("click", () => {
    fittingMirrorFrozen = !fittingMirrorFrozen;
    updateFittingMirrorSrc();
  });
}
if (btnReloadFitting) {
  btnReloadFitting.addEventListener("click", () => {
    updateFittingMirrorSrc();
  });
}
if (checkShowCrosshair) {
  checkShowCrosshair.addEventListener("change", (e) => {
    if (fittingCrosshair) {
      fittingCrosshair.style.display = e.target.checked ? "block" : "none";
    }
  });
}
connectWebSocket();
initMediaPipe();
loadSettings();
loadExpressions();
loadAvatars();
loadAccessories();
