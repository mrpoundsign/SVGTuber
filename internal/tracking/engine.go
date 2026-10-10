package tracking

import (
	"math"
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
		e.pendingOpenR = false
		e.inBilateralBlink = false
		return ParamFrame{
			Type:             "param_frame",
			T:                raw.Timestamp,
			Present:          true,
			HeadYaw:          e.filter.yaw.Filter(0, tSec),
			HeadPitch:        e.filter.pitch.Filter(0, tSec),
			HeadRoll:         e.filter.roll.Filter(0, tSec),
			HeadX:            e.filter.x.Filter(0, tSec),
			HeadY:            e.filter.y.Filter(-audioMouth*4.0, tSec), // subtle speech bob
			HeadZ:            e.filter.z.Filter(0, tSec),
			EyeX:             e.filter.eyeX.Filter(0, tSec),
			EyeY:             e.filter.eyeY.Filter(0, tSec),
			BlinkL:           e.filter.blinkL.Filter(0, tSec),
			BlinkR:           e.filter.blinkR.Filter(0, tSec),
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
			IsSpeaking:       isSpeaking,
			IsBlinkL:         false,
			IsBlinkR:         false,
			IsMouthOpen:      filtMouth >= ts.MouthThreshold,
			IsSmiling:        false,
			Expressions:      activeExprs,
		}
	}

	if !raw.Present {
		// Face lost: smoothly filter down toward neutral (0)
		filtBlinkL := e.filter.blinkL.Filter(0, tSec)
		filtBlinkR := e.filter.blinkR.Filter(0, tSec)
		filtMouth := e.filter.mouthOpen.Filter(0, tSec)
		filtSmile := e.filter.smile.Filter(0, tSec)
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.inBilateralBlink = false
		return ParamFrame{
			Type:             "param_frame",
			T:                raw.Timestamp,
			Present:          false,
			HeadYaw:          e.filter.yaw.Filter(0, tSec),
			HeadPitch:        e.filter.pitch.Filter(0, tSec),
			HeadRoll:         e.filter.roll.Filter(0, tSec),
			HeadX:            e.filter.x.Filter(0, tSec),
			HeadY:            e.filter.y.Filter(0, tSec),
			HeadZ:            e.filter.z.Filter(0, tSec),
			EyeX:             e.filter.eyeX.Filter(0, tSec),
			EyeY:             e.filter.eyeY.Filter(0, tSec),
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
			IsSpeaking:       isSpeaking,
			IsBlinkL:         filtBlinkL >= threshL,
			IsBlinkR:         filtBlinkR >= threshR,
			IsMouthOpen:      filtMouth >= ts.MouthThreshold,
			IsSmiling:        filtSmile >= ts.SmileThreshold,
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

	return ParamFrame{
		Type:             "param_frame",
		T:                raw.Timestamp,
		Present:          true,
		HeadYaw:          e.filter.yaw.Filter(yaw, tSec),
		HeadPitch:        e.filter.pitch.Filter(pitch, tSec),
		HeadRoll:         e.filter.roll.Filter(roll, tSec),
		HeadX:            e.filter.x.Filter(x, tSec),
		HeadY:            e.filter.y.Filter(y, tSec),
		HeadZ:            e.filter.z.Filter(z, tSec),
		EyeX:             e.filter.eyeX.Filter(eyeX, tSec),
		EyeY:             e.filter.eyeY.Filter(eyeY, tSec),
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
		IsSpeaking:       isSpeaking,
		IsBlinkL:         isBlinkL,
		IsBlinkR:         isBlinkR,
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
