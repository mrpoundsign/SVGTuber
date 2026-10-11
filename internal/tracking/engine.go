package tracking

import (
	"math"
	"math/rand"
	"sync"

	"github.com/mrpoundsign/SVGTuber/internal/config"
)

// Engine orchestrates pose calibration, One-Euro filtering, and parameter extraction.
type Engine struct {
	mu           sync.RWMutex
	calibrated   bool
	neutralYaw   float64
	neutralPitch float64
	neutralRoll  float64
	neutralX     float64
	neutralY     float64
	neutralZ     float64
	neutralSmile float64
	neutralMouth float64
	filter       *PoseFilter
	lastRaw      FaceFrame
	configMgr    *config.Manager

	// Blink synchronization & wink detection state
	pendingCloseL    bool
	pendingCloseR    bool
	pendingOpenL     bool
	pendingOpenR     bool
	closeTimeL       float64
	closeTimeR       float64
	openTimeL        float64
	openTimeR        float64
	inBilateralBlink bool
	exprProvider     func() map[string]bool

	// Auto-blink state
	lastBlinkTime         float64
	nextAutoBlinkInterval float64
	autoBlinkActive       bool
	autoBlinkStart        float64

	// Autonomous gaze (saccade) state
	lastSaccadeTime     float64
	nextSaccadeInterval float64
	saccadeX            float64
	saccadeY            float64

	// Autonomous head tilt / sway state
	lastTiltTime     float64
	nextTiltInterval float64
	targetTiltRoll   float64
	targetTiltPitch  float64
	targetTiltYaw    float64
	currentTiltRoll  float64
	currentTiltPitch float64
	currentTiltYaw   float64
}

// NewEngine creates a new tracking Engine.
func NewEngine(cfg ...*config.Manager) *Engine {
	var cm *config.Manager
	if len(cfg) > 0 {
		cm = cfg[0]
	}
	return &Engine{
		filter:    NewPoseFilter(),
		configMgr: cm,
	}
}

// SetConfigManager updates the configuration manager.
func (e *Engine) SetConfigManager(cm *config.Manager) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.configMgr = cm
}

// SetExpressionProvider sets a callback that returns currently active custom expressions.
func (e *Engine) SetExpressionProvider(provider func() map[string]bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.exprProvider = provider
}

// Calibrate records the latest raw face pose as the neutral (zeroed) reference.
func (e *Engine) Calibrate() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.neutralYaw = e.lastRaw.Yaw
	e.neutralPitch = e.lastRaw.Pitch
	e.neutralRoll = e.lastRaw.Roll
	e.neutralX = e.lastRaw.X
	e.neutralY = e.lastRaw.Y
	e.neutralZ = e.lastRaw.Z
	if bs := e.lastRaw.Blendshapes; bs != nil {
		e.neutralSmile = (bs["mouthSmileLeft"] + bs["mouthSmileRight"]) / 2.0
		e.neutralMouth = bs["jawOpen"]
	}
	e.calibrated = true
	e.filter.Reset()
}

// ResetCalibration clears calibrated neutral offsets.
func (e *Engine) ResetCalibration() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.neutralYaw = 0
	e.neutralPitch = 0
	e.neutralRoll = 0
	e.neutralX = 0
	e.neutralY = 0
	e.neutralZ = 0
	e.neutralSmile = 0
	e.neutralMouth = 0
	e.calibrated = false
	e.pendingCloseL = false
	e.pendingCloseR = false
	e.pendingOpenL = false
	e.pendingOpenR = false
	e.closeTimeL = 0
	e.closeTimeR = 0
	e.openTimeL = 0
	e.openTimeR = 0
	e.inBilateralBlink = false
	e.autoBlinkActive = false
	e.lastBlinkTime = 0
	e.nextAutoBlinkInterval = 0
	e.lastSaccadeTime = 0
	e.nextSaccadeInterval = 0
	e.saccadeX = 0
	e.saccadeY = 0
	e.lastTiltTime = 0
	e.nextTiltInterval = 0
	e.targetTiltRoll = 0
	e.targetTiltPitch = 0
	e.targetTiltYaw = 0
	e.currentTiltRoll = 0
	e.currentTiltPitch = 0
	e.currentTiltYaw = 0
	e.filter.Reset()
}

// Process transforms a raw FaceFrame from Studio into a smoothed, calibrated ParamFrame.
func (e *Engine) Process(raw FaceFrame) ParamFrame {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.lastRaw = raw

	var activeExprs map[string]bool
	if e.exprProvider != nil {
		activeExprs = e.exprProvider()
	}

	// Time in seconds for filter calculation
	tSec := raw.Timestamp / 1000.0
	if tSec <= 0 {
		tSec = 1.0
	}

	var ts config.TrackingSettings
	var as config.AudioSettings
	if e.configMgr != nil {
		s := e.configMgr.Get()
		ts = s.Tracking
		as = s.Audio
	} else {
		def := config.DefaultSettings()
		ts = def.Tracking
		as = def.Audio
	}

	threshL := ts.BlinkThresholdL
	if threshL <= 0 {
		threshL = ts.BlinkThreshold
	}
	if threshL <= 0 {
		threshL = 0.45
	}

	threshR := ts.BlinkThresholdR
	if threshR <= 0 {
		threshR = ts.BlinkThreshold
	}
	if threshR <= 0 {
		threshR = 0.45
	}

	syncDelay := ts.BlinkSyncDelayMs
	if syncDelay < 0 {
		syncDelay = 0
	} else if syncDelay == 0 && ts.BlinkThresholdL == 0 {
		syncDelay = 50.0
	}

	mode := as.Mode
	if mode == "" {
		mode = "hybrid"
	}
	bounceAmount := as.BounceAmount
	if bounceAmount < 0 {
		bounceAmount = 1.0
	}

	// Compute audio volume and speech state
	var audioMouth float64
	var isSpeaking bool
	var audioVolume float64
	hasActiveAudio := raw.Audio != nil && (raw.Audio.Active || raw.Audio.Volume > 0 || raw.Audio.IsSpeaking)
	if hasActiveAudio {
		audioVolume = raw.Audio.Volume
		gainVol := raw.Audio.Volume * as.MicGain
		if gainVol >= as.NoiseGate {
			audioMouth = math.Min(1.0, (gainVol-as.NoiseGate)/(1.0-as.NoiseGate))
			isSpeaking = true
		}
	}

	// Audio-driven mode without camera present
	if !raw.Present && (mode == "audio" || (mode == "hybrid" && isSpeaking)) {
		filtMouth := e.filter.mouthOpen.Filter(audioMouth, tSec)
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		autoActive, autoBlink := e.computeAutoBlink(ts, raw.Timestamp, false, false)
		saccadeX, saccadeY := e.computeSaccade(ts, raw.Timestamp, false)
		tiltYaw, tiltPitch, tiltRoll := e.computeTilt(ts, raw.Timestamp, tSec, false)
		filtBlinkL := e.filter.blinkL.Filter(autoBlink, tSec)
		filtBlinkR := e.filter.blinkR.Filter(autoBlink, tSec)
		isAutoClosed := autoActive && (autoBlink >= ts.BlinkThreshold)

		e.pendingOpenR = false
		e.inBilateralBlink = isAutoClosed
		return ParamFrame{
			Type:             "param_frame",
			T:                raw.Timestamp,
			Present:          false,
			HeadYaw:          e.filter.yaw.Filter(tiltYaw, tSec),
			HeadPitch:        e.filter.pitch.Filter(tiltPitch, tSec),
			HeadRoll:         e.filter.roll.Filter(tiltRoll, tSec),
			HeadX:            e.filter.x.Filter(0, tSec),
			HeadY:            e.filter.y.Filter(-audioMouth*4.0, tSec), // subtle speech bob
			HeadZ:            e.filter.z.Filter(0, tSec),
			EyeX:             e.filter.eyeX.Filter(saccadeX, tSec),
			EyeY:             e.filter.eyeY.Filter(saccadeY, tSec),
			BlinkL:           filtBlinkL,
			BlinkR:           filtBlinkR,
			MouthOpen:        filtMouth,
			Smile:            e.filter.smile.Filter(0, tSec),
			BrowUp:           e.filter.browUp.Filter(0, tSec),
			MouthThreshold:   ts.MouthThreshold,
			BlinkThreshold:   ts.BlinkThreshold,
			BlinkThresholdL:  threshL,
			BlinkThresholdR:  threshR,
			BlinkSyncDelayMs: syncDelay,
			WinkIsBlink:      ts.WinkIsBlink,
			SmileThreshold:   ts.SmileThreshold,
			AudioVolume:      audioVolume,
			BounceAmount:     bounceAmount,
			IsSpeaking:       isSpeaking,
			IsBlinkL:         isAutoClosed,
			IsBlinkR:         isAutoClosed,
			AutoBlink:        autoActive,
			IsMouthOpen:      filtMouth >= ts.MouthThreshold,
			IsSmiling:        false,
			Expressions:      activeExprs,
		}
	}

	if !raw.Present {
		autoActive, autoBlink := e.computeAutoBlink(ts, raw.Timestamp, false, false)
		saccadeX, saccadeY := e.computeSaccade(ts, raw.Timestamp, false)
		tiltYaw, tiltPitch, tiltRoll := e.computeTilt(ts, raw.Timestamp, tSec, false)
		filtBlinkL := e.filter.blinkL.Filter(autoBlink, tSec)
		filtBlinkR := e.filter.blinkR.Filter(autoBlink, tSec)
		isAutoClosed := autoActive && (autoBlink >= ts.BlinkThreshold)

		// Face lost: smoothly filter down toward neutral (0)
		filtMouth := e.filter.mouthOpen.Filter(0, tSec)
		filtSmile := e.filter.smile.Filter(0, tSec)
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.inBilateralBlink = isAutoClosed
		return ParamFrame{
			Type:             "param_frame",
			T:                raw.Timestamp,
			Present:          false,
			HeadYaw:          e.filter.yaw.Filter(tiltYaw, tSec),
			HeadPitch:        e.filter.pitch.Filter(tiltPitch, tSec),
			HeadRoll:         e.filter.roll.Filter(tiltRoll, tSec),
			HeadX:            e.filter.x.Filter(0, tSec),
			HeadY:            e.filter.y.Filter(0, tSec),
			HeadZ:            e.filter.z.Filter(0, tSec),
			EyeX:             e.filter.eyeX.Filter(saccadeX, tSec),
			EyeY:             e.filter.eyeY.Filter(saccadeY, tSec),
			BlinkL:           filtBlinkL,
			BlinkR:           filtBlinkR,
			MouthOpen:        filtMouth,
			Smile:            filtSmile,
			BrowUp:           e.filter.browUp.Filter(0, tSec),
			MouthThreshold:   ts.MouthThreshold,
			BlinkThreshold:   ts.BlinkThreshold,
			BlinkThresholdL:  threshL,
			BlinkThresholdR:  threshR,
			BlinkSyncDelayMs: syncDelay,
			WinkIsBlink:      ts.WinkIsBlink,
			SmileThreshold:   ts.SmileThreshold,
			AudioVolume:      audioVolume,
			BounceAmount:     bounceAmount,
			IsSpeaking:       isSpeaking,
			IsBlinkL:         isAutoClosed,
			IsBlinkR:         isAutoClosed,
			AutoBlink:        autoActive,
			IsMouthOpen:      false,
			IsSmiling:        false,
			Expressions:      activeExprs,
		}
	}

	// Calibrate angles and translation, scaled by tunable multipliers
	yaw := (raw.Yaw - e.neutralYaw) * ts.YawMultiplier
	pitch := (raw.Pitch - e.neutralPitch) * ts.PitchMultiplier
	roll := (raw.Roll - e.neutralRoll) * ts.RollMultiplier
	x := raw.X - e.neutralX
	y := raw.Y - e.neutralY
	z := raw.Z - e.neutralZ

	// Extract standard ARKit facial blendshapes
	var blinkL, blinkR, opticalMouth, smile, browUp, eyeX, eyeY float64
	if bs := raw.Blendshapes; bs != nil {
		blinkL = bs["eyeBlinkLeft"]
		blinkR = bs["eyeBlinkRight"]

		rawJaw := bs["jawOpen"]
		if e.calibrated && e.neutralMouth > 0 {
			if rawJaw > e.neutralMouth {
				denom := 1.0 - e.neutralMouth
				if denom > 0.05 {
					rawJaw = (rawJaw - e.neutralMouth) / denom
				}
			} else {
				rawJaw = 0.0
			}
		}
		opticalMouth = math.Min(1.0, rawJaw*ts.MouthGain)

		if ts.EnableSmile {
			rawSmile := (bs["mouthSmileLeft"] + bs["mouthSmileRight"]) / 2.0
			if e.calibrated && e.neutralSmile > 0 {
				if rawSmile > e.neutralSmile {
					denom := 1.0 - e.neutralSmile
					if denom > 0.05 {
						smile = (rawSmile - e.neutralSmile) / denom
					} else {
						smile = rawSmile - e.neutralSmile
					}
				} else {
					smile = 0.0
				}
			} else {
				smile = rawSmile
			}
		} else {
			smile = 0.0
		}

		browInner := bs["browInnerUp"]
		browOuterL := bs["browOuterUpLeft"]
		browOuterR := bs["browOuterUpRight"]
		browUp = (browInner + browOuterL + browOuterR) / 3.0

		// Gaze horizontal (mirrored for VTuber / webcam perspective):
		// When user looks left, pupils move screen-left (-X).
		// When user looks right, pupils move screen-right (+X).
		lookRight := (bs["eyeLookInLeft"] + bs["eyeLookOutRight"]) / 2.0
		lookLeft := (bs["eyeLookOutLeft"] + bs["eyeLookInRight"]) / 2.0
		eyeX = (lookLeft - lookRight) * ts.EyeGazeGain

		// Gaze vertical: SVG Y is downwards, so looking down is +Y, looking up is -Y
		lookUp := (bs["eyeLookUpLeft"] + bs["eyeLookUpRight"]) / 2.0
		lookDown := (bs["eyeLookDownLeft"] + bs["eyeLookDownRight"]) / 2.0
		eyeY = (lookDown - lookUp) * ts.EyeGazeGain
	}

	// Determine final mouth open based on active tracking mode
	var finalMouth float64
	switch mode {
	case "camera":
		finalMouth = opticalMouth
	case "audio":
		finalMouth = audioMouth
	case "hybrid":
		fallthrough
	default:
		if hasActiveAudio {
			if isSpeaking {
				// Voice detected: drive mouth with audio or wide optical expression
				finalMouth = math.Max(audioMouth, opticalMouth)
			} else if opticalMouth > ts.MouthThreshold {
				// Deliberate wide mouth opening even if silent (gasp, yawn, silent expression)
				finalMouth = opticalMouth
			} else {
				// Silent and mouth is near neutral: suppress camera optical jitter
				finalMouth = 0.0
			}
		} else {
			// No mic active: purely optical camera tracking
			finalMouth = opticalMouth
		}
	}

	filtBlinkL := e.filter.blinkL.Filter(blinkL, tSec)
	filtBlinkR := e.filter.blinkR.Filter(blinkR, tSec)
	filtMouth := e.filter.mouthOpen.Filter(finalMouth, tSec)
	filtSmile := e.filter.smile.Filter(smile, tSec)

	var isBlinkL, isBlinkR bool
	if ts.WinkIsBlink {
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		closed := (blinkL >= threshL) || (blinkR >= threshR)
		isBlinkL = closed
		isBlinkR = closed
		e.inBilateralBlink = closed
		maxBlink := math.Max(filtBlinkL, filtBlinkR)
		filtBlinkL = maxBlink
		filtBlinkR = maxBlink
	} else {
		isBlinkL, isBlinkR = e.evaluateBlinks(blinkL, blinkR, threshL, threshR, syncDelay, raw.Timestamp)
	}

	naturalBlink := isBlinkL || isBlinkR || (blinkL >= threshL) || (blinkR >= threshR)
	autoActive, autoBlink := e.computeAutoBlink(ts, raw.Timestamp, true, naturalBlink)
	if autoActive {
		filtBlinkL = math.Max(filtBlinkL, autoBlink)
		filtBlinkR = math.Max(filtBlinkR, autoBlink)
		if autoBlink >= threshL {
			isBlinkL = true
		}
		if autoBlink >= threshR {
			isBlinkR = true
		}
	}

	saccadeX, saccadeY := e.computeSaccade(ts, raw.Timestamp, true)
	tiltYaw, tiltPitch, tiltRoll := e.computeTilt(ts, raw.Timestamp, tSec, true)

	return ParamFrame{
		Type:             "param_frame",
		T:                raw.Timestamp,
		Present:          true,
		HeadYaw:          e.filter.yaw.Filter(yaw+tiltYaw, tSec),
		HeadPitch:        e.filter.pitch.Filter(pitch+tiltPitch, tSec),
		HeadRoll:         e.filter.roll.Filter(roll+tiltRoll, tSec),
		HeadX:            e.filter.x.Filter(x, tSec),
		HeadY:            e.filter.y.Filter(y, tSec),
		HeadZ:            e.filter.z.Filter(z, tSec),
		EyeX:             e.filter.eyeX.Filter(eyeX+saccadeX, tSec),
		EyeY:             e.filter.eyeY.Filter(eyeY+saccadeY, tSec),
		BlinkL:           filtBlinkL,
		BlinkR:           filtBlinkR,
		MouthOpen:        filtMouth,
		Smile:            filtSmile,
		BrowUp:           e.filter.browUp.Filter(browUp, tSec),
		MouthThreshold:   ts.MouthThreshold,
		BlinkThreshold:   ts.BlinkThreshold,
		BlinkThresholdL:  threshL,
		BlinkThresholdR:  threshR,
		BlinkSyncDelayMs: syncDelay,
		WinkIsBlink:      ts.WinkIsBlink,
		SmileThreshold:   ts.SmileThreshold,
		AudioVolume:      audioVolume,
		BounceAmount:     bounceAmount,
		IsSpeaking:       isSpeaking,
		IsBlinkL:         isBlinkL,
		IsBlinkR:         isBlinkR,
		AutoBlink:        autoActive,
		IsMouthOpen:      filtMouth >= ts.MouthThreshold,
		IsSmiling:        filtSmile >= ts.SmileThreshold,
		Expressions:      activeExprs,
		Raw:              raw.Blendshapes,
	}
}

// evaluateBlinks applies independent thresholds and a synchronization delay window to
// discriminate between natural bilateral blinks and intentional unilateral winks.
func (e *Engine) evaluateBlinks(filtL, filtR, threshL, threshR, syncDelay, nowMs float64) (bool, bool) {
	rawL := filtL >= threshL
	rawR := filtR >= threshR

	if syncDelay <= 0 {
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.inBilateralBlink = rawL && rawR
		return rawL, rawR
	}

	// Guard against non-monotonic or wildly erratic timestamps
	if e.pendingCloseL && (nowMs < e.closeTimeL || nowMs-e.closeTimeL > 2000) {
		e.pendingCloseL = false
	}
	if e.pendingCloseR && (nowMs < e.closeTimeR || nowMs-e.closeTimeR > 2000) {
		e.pendingCloseR = false
	}
	if e.pendingOpenL && (nowMs < e.openTimeL || nowMs-e.openTimeL > 2000) {
		e.pendingOpenL = false
	}
	if e.pendingOpenR && (nowMs < e.openTimeR || nowMs-e.openTimeR > 2000) {
		e.pendingOpenR = false
	}

	// Case 1: Both eyes closed simultaneously
	if rawL && rawR {
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.inBilateralBlink = true
		return true, true
	}

	// Case 2: Both eyes open simultaneously
	if !rawL && !rawR {
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.inBilateralBlink = false
		return false, false
	}

	// Case 3: Reopening from an existing bilateral blink.
	// If one eye opens slightly ahead of the other during a normal blink release,
	// hold both closed for the syncDelay window to prevent exit winking flutter.
	if e.inBilateralBlink {
		if !rawL && rawR {
			if !e.pendingOpenL {
				e.pendingOpenL = true
				e.openTimeL = nowMs
			}
			if nowMs-e.openTimeL < syncDelay && nowMs >= e.openTimeL {
				return true, true
			}
			// Delay expired: intentional wink hold
			e.inBilateralBlink = false
			e.pendingOpenL = false
			return false, true
		}
		if rawL && !rawR {
			if !e.pendingOpenR {
				e.pendingOpenR = true
				e.openTimeR = nowMs
			}
			if nowMs-e.openTimeR < syncDelay && nowMs >= e.openTimeR {
				return true, true
			}
			// Delay expired: intentional wink hold
			e.inBilateralBlink = false
			e.pendingOpenR = false
			return true, false
		}
	}

	// Case 4: Eye closure initiation.
	// When one eye crosses threshold, delay unilateral wink output by syncDelay
	// to give the second eye an opportunity to close for a clean bilateral blink.
	if rawL && !rawR {
		e.pendingCloseR = false
		if !e.pendingCloseL {
			e.pendingCloseL = true
			e.closeTimeL = nowMs
		}
		if nowMs-e.closeTimeL < syncDelay && nowMs >= e.closeTimeL {
			return false, false
		}
		// Delay expired: intentional Left wink
		return true, false
	}

	if !rawL && rawR {
		e.pendingCloseL = false
		if !e.pendingCloseR {
			e.pendingCloseR = true
			e.closeTimeR = nowMs
		}
		if nowMs-e.closeTimeR < syncDelay && nowMs >= e.closeTimeR {
			return false, false
		}
		// Delay expired: intentional Right wink
		return false, true
	}

	return rawL, rawR
}

// isAutomationEnabled checks if an automation should run based on its configured mode and current tracking state.
func isAutomationEnabled(enabled bool, mode string, facePresent bool) bool {
	if !enabled {
		return false
	}
	switch mode {
	case "face_lost_only":
		return !facePresent
	case "tracked_only":
		return facePresent
	case "always":
		fallthrough
	default:
		return true
	}
}

// computeAutoBlink evaluates autonomous natural blinks when tracking is idle, in audio mode, or face lost.
func (e *Engine) computeAutoBlink(ts config.TrackingSettings, timestamp float64, facePresent bool, naturalBlink bool) (bool, float64) {
	if !isAutomationEnabled(ts.AutoBlink, ts.AutoBlinkMode, facePresent) {
		e.autoBlinkActive = false
		return false, 0
	}

	baseIntervalMs := ts.AutoBlinkIntervalSec * 1000.0
	if baseIntervalMs <= 500 {
		baseIntervalMs = 4000.0
	}

	if naturalBlink {
		e.lastBlinkTime = timestamp
		e.autoBlinkActive = false
		e.nextAutoBlinkInterval = baseIntervalMs * (0.8 + rand.Float64()*0.4)
		return false, 0
	}

	if e.lastBlinkTime == 0 {
		e.lastBlinkTime = timestamp
		e.nextAutoBlinkInterval = baseIntervalMs * (0.8 + rand.Float64()*0.4)
	}

	const blinkDurationMs = 140.0 // 140ms natural blink duration

	if !e.autoBlinkActive {
		if timestamp-e.lastBlinkTime >= e.nextAutoBlinkInterval {
			e.autoBlinkActive = true
			e.autoBlinkStart = timestamp
		}
	}

	if e.autoBlinkActive {
		elapsed := timestamp - e.autoBlinkStart
		if elapsed >= blinkDurationMs {
			e.autoBlinkActive = false
			e.lastBlinkTime = timestamp
			e.nextAutoBlinkInterval = baseIntervalMs * (0.8 + rand.Float64()*0.4)
			return false, 0
		}
		// Smooth sine bell curve from 0.0 to 1.0 back to 0.0
		progress := elapsed / blinkDurationMs
		blinkVal := math.Sin(progress * math.Pi)
		return true, blinkVal
	}

	return false, 0
}

// computeSaccade generates subtle autonomous micro-darts of eye gaze (saccades).
func (e *Engine) computeSaccade(ts config.TrackingSettings, timestamp float64, facePresent bool) (float64, float64) {
	if !isAutomationEnabled(ts.AutoGaze, ts.AutoGazeMode, facePresent) {
		e.saccadeX = 0
		e.saccadeY = 0
		return 0, 0
	}

	if e.lastSaccadeTime == 0 {
		e.lastSaccadeTime = timestamp
		e.nextSaccadeInterval = 1800.0 + rand.Float64()*2200.0 // 1.8s - 4.0s
	}

	if timestamp-e.lastSaccadeTime >= e.nextSaccadeInterval {
		e.lastSaccadeTime = timestamp
		e.nextSaccadeInterval = 1800.0 + rand.Float64()*2200.0

		// 45% chance: return to neutral center (0, 0)
		// 55% chance: subtle glance around (+/- 0.16 horizontal, +/- 0.08 vertical)
		if rand.Float64() < 0.45 {
			e.saccadeX = 0.0
			e.saccadeY = 0.0
		} else {
			e.saccadeX = (rand.Float64() - 0.5) * 0.32
			e.saccadeY = (rand.Float64() - 0.5) * 0.16
		}
	}

	rangeMult := ts.AutoGazeRange
	if rangeMult <= 0 {
		rangeMult = 1.0
	}
	return e.saccadeX * rangeMult, e.saccadeY * rangeMult
}

// computeTilt generates gentle autonomous head tilts and breathing posture sway.
func (e *Engine) computeTilt(ts config.TrackingSettings, timestamp float64, tSec float64, facePresent bool) (yaw, pitch, roll float64) {
	if !isAutomationEnabled(ts.AutoTilt, ts.AutoTiltMode, facePresent) {
		e.currentTiltRoll = 0
		e.currentTiltPitch = 0
		e.currentTiltYaw = 0
		return 0, 0, 0
	}

	amount := ts.AutoTiltAmount
	if amount <= 0 {
		amount = 1.0
	}

	// 1. Slow, soothing continuous breathing posture sway (period ~6.5 seconds)
	breathingPhase := tSec * (2.0 * math.Pi / 6.5)
	swayRoll := math.Sin(breathingPhase) * 0.8 * amount
	swayPitch := math.Cos(breathingPhase*0.7) * 0.5 * amount

	// 2. Occasional spontaneous head tilt adjustment (every 3.5s - 7.0s)
	if e.lastTiltTime == 0 {
		e.lastTiltTime = timestamp
		e.nextTiltInterval = 3500.0 + rand.Float64()*3500.0
	}

	if timestamp-e.lastTiltTime >= e.nextTiltInterval {
		e.lastTiltTime = timestamp
		e.nextTiltInterval = 3500.0 + rand.Float64()*3500.0

		// 40% return to neutral, 60% gentle posture tilt
		if rand.Float64() < 0.40 {
			e.targetTiltRoll = 0.0
			e.targetTiltPitch = 0.0
			e.targetTiltYaw = 0.0
		} else {
			e.targetTiltRoll = (rand.Float64() - 0.5) * 3.5 * amount
			e.targetTiltPitch = (rand.Float64() - 0.5) * 1.8 * amount
			e.targetTiltYaw = (rand.Float64() - 0.5) * 2.2 * amount
		}
	}

	// Smoothly interpolate toward target posture tilt (exponential ease)
	lerpRate := 0.04
	e.currentTiltRoll += (e.targetTiltRoll - e.currentTiltRoll) * lerpRate
	e.currentTiltPitch += (e.targetTiltPitch - e.currentTiltPitch) * lerpRate
	e.currentTiltYaw += (e.targetTiltYaw - e.currentTiltYaw) * lerpRate

	return e.currentTiltYaw, swayPitch + e.currentTiltPitch, swayRoll + e.currentTiltRoll
}
