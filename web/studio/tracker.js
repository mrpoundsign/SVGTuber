/**
 * SVGTuber Studio MediaPipe Face Tracker & WebSocket Client
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

let faceLandmarker = null;
let runningMode = "VIDEO";
let webcamRunning = false;
let socket = null;
let reconnectTimer = null;
let lastVideoTime = -1;
let frameCount = 0;
let lastFpsTime = performance.now();
let drawingUtils = null;

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
    await populateCameraDevices();
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
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    btnToggleCamera.textContent = "Start Camera";
    btnToggleCamera.classList.remove("btn-danger");
    updateStatus("Camera Stopped", "status-warn");
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
      requestAnimationFrame(predictLoop);
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
  // Column-major indices:
  // m00: 0, m10: 1, m20: 2, m30: 3
  // m01: 4, m11: 5, m21: 6, m31: 7
  // m02: 8, m12: 9, m22: 10, m32: 11
  // m03: 12, m13: 13, m23: 14, m33: 15
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

// Main Detection Loop
function predictLoop() {
  if (!webcamRunning) return;

  const now = performance.now();
  if (video.currentTime !== lastVideoTime && faceLandmarker) {
    lastVideoTime = video.currentTime;
    const results = faceLandmarker.detectForVideo(video, now);

    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // Draw mesh wireframe
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: "#6366f140",
        lineWidth: 1
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#38bdf8" });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#38bdf8" });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#f43f5e" });

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

      // Send to Go server
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
          blendshapes: blendshapes
        };
        socket.send(JSON.stringify(frame));
      }

      // Update UI Meters
      updateGauges(pose, blendshapes);
      updateStatus("Tracking Face", "status-ok");
    } else {
      sendTrackingLoss();
      updateStatus("No Face Detected", "status-warn");
    }

    // FPS calculation
    frameCount++;
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      fpsDisplay.textContent = `${fps} FPS`;
      frameCount = 0;
      lastFpsTime = now;
    }
  }

  requestAnimationFrame(predictLoop);
}

function sendTrackingLoss() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      timestamp: performance.now(),
      present: false
    }));
  }
}

function updateGauges(pose, blendshapes) {
  valYaw.textContent = `${pose.yaw.toFixed(1)}°`;
  valPitch.textContent = `${pose.pitch.toFixed(1)}°`;
  valRoll.textContent = `${pose.roll.toFixed(1)}°`;

  // Normalize [-30, 30] to [0%, 100%]
  gaugeYaw.style.width = `${Math.max(0, Math.min(100, ((pose.yaw + 30) / 60) * 100))}%`;
  gaugePitch.style.width = `${Math.max(0, Math.min(100, ((pose.pitch + 30) / 60) * 100))}%`;
  gaugeRoll.style.width = `${Math.max(0, Math.min(100, ((pose.roll + 30) / 60) * 100))}%`;

  const blinkL = blendshapes.eyeBlinkLeft || 0;
  const blinkR = blendshapes.eyeBlinkRight || 0;
  const mouthOpen = blendshapes.jawOpen || 0;
  const smile = ((blendshapes.mouthSmileLeft || 0) + (blendshapes.mouthSmileRight || 0)) / 2;

  gaugeBlinkL.style.width = `${Math.round(blinkL * 100)}%`;
  gaugeBlinkR.style.width = `${Math.round(blinkR * 100)}%`;
  gaugeMouthOpen.style.width = `${Math.round(mouthOpen * 100)}%`;
  gaugeSmile.style.width = `${Math.round(smile * 100)}%`;
}

// Calibrate Neutral Pose Button
btnCalibrate.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "calibrate" }));
  }
});

btnToggleCamera.addEventListener("click", toggleCamera);

// Setup on load
connectWebSocket();
initMediaPipe();
