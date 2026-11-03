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
	neutralSmile     float64
	neutralMouth     float64
	neutralBrowL     float64
	neutralBrowR     float64
	neutralEyeX      float64
	neutralEyeY      float64
	neutralPucker    float64
	neutralFrown     float64
	neutralCheekPuff float64
	neutralNoseSneer float64
	neutralJawX      float64
	neutralSquintL   float64
	neutralSquintR   float64
	neutralPitchHz   float64
	blinkOpenL       float64
	blinkOpenR       float64
	blinkClosedL     float64
	blinkClosedR     float64
	glareAssist      bool
	smileWeightL     float64
	smileWeightR     float64
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
	eyeClosedL       bool
	eyeClosedR       bool
	lastCloseTimeL   float64
	lastCloseTimeR   float64
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
		blinkClosedL: 1.0,
		blinkClosedR: 1.0,
		smileWeightL: 0.5,
		smileWeightR: 0.5,
		filter:       NewPoseFilter(),
		configMgr:    cm,
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

// Calibrate records the latest raw face pose as the neutral (zeroed) reference,
// capturing resting open-eye floor and neutral gaze while preserving any guided closed-eye ceiling.
func (e *Engine) Calibrate() {
	e.mu.Lock()

	e.neutralYaw = e.lastRaw.Yaw
	e.neutralPitch = e.lastRaw.Pitch
	e.neutralRoll = e.lastRaw.Roll
	e.neutralX = e.lastRaw.X
	e.neutralY = e.lastRaw.Y
	e.neutralZ = e.lastRaw.Z
	if bs := e.lastRaw.Blendshapes; bs != nil {
		wL, wR := e.smileWeightL, e.smileWeightR
		if wL <= 0 && wR <= 0 {
			wL, wR = 0.5, 0.5
		}
		e.neutralSmile = bs["mouthSmileLeft"]*wL + bs["mouthSmileRight"]*wR
		e.neutralMouth = bs["jawOpen"]
		e.neutralBrowL, e.neutralBrowR, _ = extractRawBrows(bs)
		e.neutralEyeX, e.neutralEyeY = extractRawGaze(bs)
		e.neutralPucker = extractRawPucker(bs)
		e.neutralFrown = bs["mouthFrownLeft"]*wL + bs["mouthFrownRight"]*wR
		e.neutralCheekPuff = bs["cheekPuff"]
		e.neutralNoseSneer = bs["noseSneerLeft"]*wL + bs["noseSneerRight"]*wR
		e.neutralJawX = bs["jawRight"] - bs["jawLeft"]
		e.neutralSquintL = bs["eyeSquintLeft"]
		e.neutralSquintR = bs["eyeSquintRight"]

		earL, hasEarL := bs["earBlinkLeft"]
		earR, hasEarR := bs["earBlinkRight"]
		rawL := FuseBlinkScore(bs["eyeBlinkLeft"], earL, hasEarL)
		rawR := FuseBlinkScore(bs["eyeBlinkRight"], earR, hasEarR)
		// Guard against calibrating while mid-blink: clamp open floor to <= 0.45
		e.blinkOpenL = math.Max(0.0, math.Min(0.45, rawL))
		e.blinkOpenR = math.Max(0.0, math.Min(0.45, rawR))
	}
	if e.blinkClosedL <= e.blinkOpenL+0.08 {
		e.blinkClosedL = 1.0
	}
	if e.blinkClosedR <= e.blinkOpenR+0.08 {
		e.blinkClosedR = 1.0
	}
	e.calibrated = true
	e.filter.Reset()

	cm := e.configMgr
	var calProfile config.CalibrationProfile
	if cm != nil {
		existing := cm.Get().Tracking.Calibration
		if existing.BlinkClosedL > e.blinkOpenL+0.08 && existing.BlinkClosedL < 1.0 {
			e.blinkClosedL = existing.BlinkClosedL
		}
		if existing.BlinkClosedR > e.blinkOpenR+0.08 && existing.BlinkClosedR < 1.0 {
			e.blinkClosedR = existing.BlinkClosedR
		}
		e.glareAssist = existing.GlareAssist
		if existing.SmileWeightL > 0 || existing.SmileWeightR > 0 {
			e.smileWeightL = existing.SmileWeightL
			e.smileWeightR = existing.SmileWeightR
		}
		if existing.NeutralPitchHz > 0 {
			e.neutralPitchHz = existing.NeutralPitchHz
		}
		calProfile = config.CalibrationProfile{
			Calibrated:       true,
			NeutralYaw:       e.neutralYaw,
			NeutralPitch:     e.neutralPitch,
			NeutralRoll:      e.neutralRoll,
			NeutralX:         e.neutralX,
			NeutralY:         e.neutralY,
			NeutralZ:         e.neutralZ,
			NeutralEyeX:      e.neutralEyeX,
			NeutralEyeY:      e.neutralEyeY,
			NeutralSmile:     e.neutralSmile,
			NeutralMouth:     e.neutralMouth,
			NeutralBrowL:     e.neutralBrowL,
			NeutralBrowR:     e.neutralBrowR,
			NeutralPucker:    e.neutralPucker,
			NeutralFrown:     e.neutralFrown,
			NeutralCheekPuff: e.neutralCheekPuff,
			NeutralNoseSneer: e.neutralNoseSneer,
			NeutralJawX:      e.neutralJawX,
			NeutralSquintL:   e.neutralSquintL,
			NeutralSquintR:   e.neutralSquintR,
			NeutralPitchHz:   e.neutralPitchHz,
			BlinkOpenL:       e.blinkOpenL,
			BlinkOpenR:       e.blinkOpenR,
			BlinkClosedL:     e.blinkClosedL,
			BlinkClosedR:     e.blinkClosedR,
			GlareAssist:      e.glareAssist,
			SmileWeightL:     e.smileWeightL,
			SmileWeightR:     e.smileWeightR,
		}
	}
	e.mu.Unlock()

	if cm != nil {
		_ = cm.SetCalibration(calProfile)
	}
}

func extractRawGaze(bs map[string]float64) (rawX, rawY float64) {
	if bs == nil {
		return 0, 0
	}
	lookRight := (bs["eyeLookInLeft"] + bs["eyeLookOutRight"]) / 2.0
	lookLeft := (bs["eyeLookOutLeft"] + bs["eyeLookInRight"]) / 2.0
	rawX = lookLeft - lookRight

	lookUp := (bs["eyeLookUpLeft"] + bs["eyeLookUpRight"]) / 2.0
	lookDown := (bs["eyeLookDownLeft"] + bs["eyeLookDownRight"]) / 2.0
	rawY = lookDown - lookUp
	return rawX, rawY
}

// FuseBlinkScore combines MediaPipe's ARKit texture blendshape score with geometric 3D landmark
// Eye Aspect Ratio (EAR) closure so lens glare on glasses does not blind blink detection.
func FuseBlinkScore(blendshapeBlink, earBlink float64, hasEAR bool) float64 {
	return FuseBlinkScoreWithSquint(blendshapeBlink, earBlink, hasEAR, 0, 0)
}

// FuseBlinkScoreWithSquint extends FuseBlinkScore with smile/cheek-squint disambiguation:
// 1) When a big smile/laugh pushes the cheeks up (eyeSquint/cheekSquint >= 0.25 && smile >= 0.35),
//    MediaPipe's 2D eyeBlink texture blendshape often spikes even though the eyelids are open.
//    When 3D landmark EAR confirms the eye is open (earBlink < blendshapeBlink - 0.08), we weight
//    geometric EAR higher to prevent false smile-induced blinks behind glasses.
// 2) Conversely, when NOT smiling (smile < 0.20), unilateral recruitment of eyeSquint/cheekSquint
//    (orbicularis oculi) helps rescue solo winks compressed by lens glare.
func FuseBlinkScoreWithSquint(blendshapeBlink, earBlink float64, hasEAR bool, eyeSquint, smile float64) float64 {
	b := math.Max(0.0, math.Min(1.0, blendshapeBlink))
	if !hasEAR {
		if smile >= 0.40 && eyeSquint >= 0.30 && b < 0.72 {
			// Gentle cheek-raise attenuation when 3D EAR is not present
			b = math.Max(0.0, b-math.Min(0.14, (smile-0.35)*(eyeSquint)*0.35))
		} else if smile < 0.18 && eyeSquint >= 0.35 && b >= 0.22 {
			// Non-smile orbicularis oculi recruitment boosts glare-compressed winks
			b = math.Min(1.0, b+eyeSquint*0.14)
		}
		return b
	}
	e := math.Max(0.0, math.Min(1.0, earBlink))
	// Smile/Laugh Cheek-Raise Guard: if smiling/squinting and 3D EAR shows the eye is open,
	// trust 3D EAR so cheek compression doesn't false-trigger a blink.
	if smile >= 0.35 && eyeSquint >= 0.25 && e < b-0.08 {
		return math.Max(0.0, math.Min(1.0, e*0.75+b*0.25))
	}
	blended := b*0.65 + e*0.35
	// If lens glare washes out the pixel blendshape while the 3D mesh eyelid closes,
	// allow geometric EAR closure to rescue the blink signal.
	if e > b+0.12 {
		blended = math.Max(blended, e*0.90)
	}
	// Non-smile cheek/lower-lid squint synergy: rescues solo winks behind glasses glare
	if smile < 0.18 && eyeSquint >= 0.35 && blended >= 0.22 {
		blended = math.Min(1.0, blended+eyeSquint*0.12)
	}
	return math.Max(0.0, math.Min(1.0, blended))
}

func extractRawPucker(bs map[string]float64) float64 {
	if bs == nil {
		return 0
	}
	return math.Max(bs["mouthPucker"], bs["mouthFunnel"]*0.75)
}

func extractRawFrown(bs map[string]float64, wL, wR, rawSmile, rawPucker float64) float64 {
	if bs == nil {
		return 0
	}
	bsFrown := bs["mouthFrownLeft"]*wL + bs["mouthFrownRight"]*wR
	geoFrown := bs["geoFrownLeft"]*wL + bs["geoFrownRight"]*wR
	// MediaPipe's mouthFrownLeft/Right has a low raw ceiling (~0.15-0.30) on RGB webcams,
	// whereas pouting/frowning strongly activates mouthShrugLower + mouthRollLower.
	// Gate by non-smile, non-pucker, and closed/semi-closed jaw so speaking or smiling never triggers frown.
	nonSmileGate := math.Max(0.0, 1.0-rawSmile*2.5) * math.Max(0.0, 1.0-rawPucker*1.8) * math.Max(0.0, 1.0-bs["jawOpen"]*2.2)
	shrugPout := (bs["mouthShrugLower"]*0.65 + bs["mouthRollLower"]*0.35) * nonSmileGate
	combined := math.Max(bsFrown, math.Max(geoFrown*0.85, shrugPout))
	return math.Max(0.0, math.Min(1.0, combined))
}

func calibrateUnipolar(raw, neutral float64, calibrated bool) float64 {
	raw = math.Max(0.0, math.Min(1.0, raw))
	if !calibrated || neutral <= 0 {
		return raw
	}
	if raw <= neutral {
		return 0.0
	}
	denom := 1.0 - neutral
	if denom < 0.10 {
		denom = 0.10
	}
	return math.Max(0.0, math.Min(1.0, (raw-neutral)/denom))
}

// RemapBlink normalizes a raw eyelid closure score from the user's calibrated [openFloor .. closedCeiling]
// range into standard [0.0 .. 1.0] avatar closure space.
func RemapBlink(raw, openFloor, closedCeiling float64) float64 {
	raw = math.Max(0.0, math.Min(1.0, raw))
	if openFloor <= 0 && (closedCeiling <= 0 || closedCeiling >= 0.999) {
		return raw
	}
	if closedCeiling <= 0 {
		closedCeiling = 1.0
	}
	span := closedCeiling - openFloor
	if span < 0.08 {
		span = 0.08
	}
	norm := (raw - openFloor) / span
	return math.Max(0.0, math.Min(1.0, norm))
}

// ApplyGazeDeadzone suppresses micro-jitter near zero (caused by lens reflections on glasses)
// while smoothly scaling values beyond the deadzone.
func ApplyGazeDeadzone(val, deadzone float64) float64 {
	if deadzone <= 0 {
		return val
	}
	absVal := math.Abs(val)
	if absVal <= deadzone {
		return 0
	}
	denom := 1.0 - deadzone
	if denom <= 0.05 {
		denom = 0.05
	}
	scaled := (absVal - deadzone) / denom
	if val < 0 {
		return -scaled
	}
	return scaled
}

// extractRawBrows computes signed left/right brow signals (-1.0 furrowed to +1.0 raised)
// and combined upward brow lift from standard ARKit blendshapes.
func extractRawBrows(bs map[string]float64) (rawL, rawR, rawUp float64) {
	if bs == nil {
		return 0, 0, 0
	}
	browInner := bs["browInnerUp"]
	browOuterL := bs["browOuterUpLeft"]
	browOuterR := bs["browOuterUpRight"]
	browDownL := bs["browDownLeft"]
	browDownR := bs["browDownRight"]
	rawUp = (browInner + browOuterL + browOuterR) / 3.0
	upL := math.Max(browOuterL, browInner)
	upR := math.Max(browOuterR, browInner)
	rawL = upL - browDownL
	rawR = upR - browDownR
	return rawL, rawR, rawUp
}

// ResetCalibration clears calibrated neutral offsets.
func (e *Engine) ResetCalibration() {
	e.mu.Lock()

	e.neutralYaw = 0
	e.neutralPitch = 0
	e.neutralRoll = 0
	e.neutralX = 0
	e.neutralY = 0
	e.neutralZ = 0
	e.neutralSmile = 0
	e.neutralMouth = 0
	e.neutralBrowL = 0
	e.neutralBrowR = 0
	e.neutralEyeX = 0
	e.neutralEyeY = 0
	e.neutralPucker = 0
	e.neutralFrown = 0
	e.neutralCheekPuff = 0
	e.neutralNoseSneer = 0
	e.neutralJawX = 0
	e.neutralSquintL = 0
	e.neutralSquintR = 0
	e.neutralPitchHz = 0
	e.blinkOpenL = 0
	e.blinkOpenR = 0
	e.blinkClosedL = 1.0
	e.blinkClosedR = 1.0
	e.glareAssist = false
	e.smileWeightL = 0.5
	e.smileWeightR = 0.5
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
	e.eyeClosedL = false
	e.eyeClosedR = false
	e.lastCloseTimeL = 0
	e.lastCloseTimeR = 0
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
	cm := e.configMgr
	e.mu.Unlock()

	if cm != nil {
		_ = cm.ResetCalibration()
	}
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
		if ts.Calibration.Calibrated || ts.Calibration.BlinkClosedL < 0.999 || ts.Calibration.BlinkClosedR < 0.999 || ts.Calibration.BlinkOpenL > 0 || ts.Calibration.BlinkOpenR > 0 {
			e.calibrated = ts.Calibration.Calibrated
			e.neutralYaw = ts.Calibration.NeutralYaw
			e.neutralPitch = ts.Calibration.NeutralPitch
			e.neutralRoll = ts.Calibration.NeutralRoll
			e.neutralX = ts.Calibration.NeutralX
			e.neutralY = ts.Calibration.NeutralY
			e.neutralZ = ts.Calibration.NeutralZ
			e.neutralEyeX = ts.Calibration.NeutralEyeX
			e.neutralEyeY = ts.Calibration.NeutralEyeY
			e.neutralSmile = ts.Calibration.NeutralSmile
			e.neutralMouth = ts.Calibration.NeutralMouth
			e.neutralBrowL = ts.Calibration.NeutralBrowL
			e.neutralBrowR = ts.Calibration.NeutralBrowR
			e.neutralPucker = ts.Calibration.NeutralPucker
			e.neutralFrown = ts.Calibration.NeutralFrown
			e.neutralCheekPuff = ts.Calibration.NeutralCheekPuff
			e.neutralNoseSneer = ts.Calibration.NeutralNoseSneer
			e.neutralJawX = ts.Calibration.NeutralJawX
			e.neutralSquintL = ts.Calibration.NeutralSquintL
			e.neutralSquintR = ts.Calibration.NeutralSquintR
			e.neutralPitchHz = ts.Calibration.NeutralPitchHz
			e.blinkOpenL = ts.Calibration.BlinkOpenL
			e.blinkOpenR = ts.Calibration.BlinkOpenR
			e.blinkClosedL = ts.Calibration.BlinkClosedL
			e.blinkClosedR = ts.Calibration.BlinkClosedR
			e.glareAssist = ts.Calibration.GlareAssist
			e.smileWeightL = ts.Calibration.SmileWeightL
			e.smileWeightR = ts.Calibration.SmileWeightR
		}
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
	physicsEnabled := ts.PhysicsEnabled
	physicsAmount := ts.PhysicsAmount
	if !physicsEnabled && physicsAmount <= 0 {
		physicsEnabled = true
		physicsAmount = 1.0
	} else if physicsEnabled && physicsAmount <= 0 {
		physicsAmount = 1.0
	}

	stabilizeBlink := ts.StabilizeBlink
	maxYawDeg := ts.BlinkMaxHeadYaw
	if !stabilizeBlink && maxYawDeg <= 0 {
		stabilizeBlink = true
		maxYawDeg = 25.0
	} else if maxYawDeg <= 0 {
		maxYawDeg = 25.0
	}

	// Compute audio volume, vowel visemes, voice pitch, and speech/shout/laugh state
	var audioMouth float64
	var isSpeaking, isShouting, isLaughing bool
	var audioVolume, rawAudioPitch, rawVisemeA, rawVisemeI, rawVisemeU, rawVisemeE, rawVisemeO float64
	rawViseme := "sil"
	hasActiveAudio := raw.Audio != nil && (raw.Audio.Active || raw.Audio.Volume > 0 || raw.Audio.IsSpeaking)
	if hasActiveAudio {
		audioVolume = raw.Audio.Volume
		gainVol := raw.Audio.Volume * as.MicGain
		if gainVol >= as.NoiseGate {
			audioMouth = math.Min(1.0, (gainVol-as.NoiseGate)/(1.0-as.NoiseGate))
			isSpeaking = true
		}
		isShouting = raw.Audio.IsShouting || (isSpeaking && gainVol >= 0.82)
		isLaughing = raw.Audio.IsLaughing
		if isSpeaking {
			if raw.Audio.PitchHz > 0 && e.neutralPitchHz >= 75 && e.neutralPitchHz <= 400 {
				rawAudioPitch = math.Max(0.0, math.Min(1.0, 0.5+(raw.Audio.PitchHz-e.neutralPitchHz)/160.0))
			} else {
				rawAudioPitch = math.Max(0.0, math.Min(1.0, raw.Audio.Pitch))
			}
			rawVisemeA = math.Max(0.0, math.Min(1.0, raw.Audio.VisemeA))
			rawVisemeI = math.Max(0.0, math.Min(1.0, raw.Audio.VisemeI))
			rawVisemeU = math.Max(0.0, math.Min(1.0, raw.Audio.VisemeU))
			rawVisemeE = math.Max(0.0, math.Min(1.0, raw.Audio.VisemeE))
			rawVisemeO = math.Max(0.0, math.Min(1.0, raw.Audio.VisemeO))
			if raw.Audio.Viseme != "" {
				rawViseme = raw.Audio.Viseme
			}
		}
	}

	filtAudioPitch := e.filter.audioPitch.Filter(rawAudioPitch, tSec)
	filtVisemeA := e.filter.visemeA.Filter(rawVisemeA, tSec)
	filtVisemeI := e.filter.visemeI.Filter(rawVisemeI, tSec)
	filtVisemeU := e.filter.visemeU.Filter(rawVisemeU, tSec)
	filtVisemeE := e.filter.visemeE.Filter(rawVisemeE, tSec)
	filtVisemeO := e.filter.visemeO.Filter(rawVisemeO, tSec)

	// Audio-driven mode without camera present
	if !raw.Present && (mode == "audio" || (mode == "hybrid" && isSpeaking)) {
		filtMouth := e.filter.mouthOpen.Filter(audioMouth, tSec)
		audioSmile := 0.0
		if isLaughing && ts.EnableSmile {
			audioSmile = 0.65
		}
		filtAudioSmile := e.filter.smile.Filter(audioSmile, tSec)
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		autoActive, autoBlink := e.computeAutoBlink(ts, raw.Timestamp)
		saccadeX, saccadeY := e.computeSaccade(ts, raw.Timestamp, false)
		tiltYaw, tiltPitch, tiltRoll := e.computeTilt(ts, raw.Timestamp, tSec, false)
		filtBlinkL := autoBlink
		filtBlinkR := autoBlink
		isAutoClosed := autoActive && (autoBlink >= 0.5)

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
			Smile:            filtAudioSmile,
			BrowUp:           e.filter.browUp.Filter(0, tSec),
			BrowL:            e.filter.browL.Filter(0, tSec),
			BrowR:            e.filter.browR.Filter(0, tSec),
			MouthThreshold:   ts.MouthThreshold,
			BlinkThreshold:   ts.BlinkThreshold,
			BlinkThresholdL:  threshL,
			BlinkThresholdR:  threshR,
			BlinkSyncDelayMs: syncDelay,
			WinkIsBlink:      ts.WinkIsBlink,
			StabilizeBlink:   stabilizeBlink,
			BlinkMaxHeadYaw:  maxYawDeg,
			SmileThreshold:   ts.SmileThreshold,
			AudioVolume:      audioVolume,
			AudioPitch:       filtAudioPitch,
			Viseme:           rawViseme,
			VisemeA:          filtVisemeA,
			VisemeI:          filtVisemeI,
			VisemeU:          filtVisemeU,
			VisemeE:          filtVisemeE,
			VisemeO:          filtVisemeO,
			BounceAmount:     bounceAmount,
			PhysicsEnabled:   physicsEnabled,
			PhysicsAmount:    physicsAmount,
			DepthZoomAmount:  ts.DepthZoomAmount,
			IsSpeaking:       isSpeaking,
			IsShouting:       isShouting,
			IsLaughing:       isLaughing,
			IsBlinkL:         isAutoClosed,
			IsBlinkR:         isAutoClosed,
			AutoBlink:        autoActive,
			IsMouthOpen:      filtMouth >= ts.MouthThreshold,
			IsSmiling:        filtAudioSmile >= ts.SmileThreshold,
			Expressions:      activeExprs,
		}
	}

	if !raw.Present {
		autoActive, autoBlink := e.computeAutoBlink(ts, raw.Timestamp)
		saccadeX, saccadeY := e.computeSaccade(ts, raw.Timestamp, false)
		tiltYaw, tiltPitch, tiltRoll := e.computeTilt(ts, raw.Timestamp, tSec, false)
		filtBlinkL := autoBlink
		filtBlinkR := autoBlink
		isAutoClosed := autoActive && (autoBlink >= 0.5)

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
			BrowL:            e.filter.browL.Filter(0, tSec),
			BrowR:            e.filter.browR.Filter(0, tSec),
			MouthThreshold:   ts.MouthThreshold,
			BlinkThreshold:   ts.BlinkThreshold,
			BlinkThresholdL:  threshL,
			BlinkThresholdR:  threshR,
			BlinkSyncDelayMs: syncDelay,
			WinkIsBlink:      ts.WinkIsBlink,
			StabilizeBlink:   stabilizeBlink,
			BlinkMaxHeadYaw:  maxYawDeg,
			SmileThreshold:   ts.SmileThreshold,
			AudioVolume:      audioVolume,
			BounceAmount:     bounceAmount,
			PhysicsEnabled:   physicsEnabled,
			PhysicsAmount:    physicsAmount,
			DepthZoomAmount:  ts.DepthZoomAmount,
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
	calYawDeg := raw.Yaw - e.neutralYaw
	yaw := calYawDeg * ts.YawMultiplier
	pitch := (raw.Pitch - e.neutralPitch) * ts.PitchMultiplier
	roll := (raw.Roll - e.neutralRoll) * ts.RollMultiplier
	x := raw.X - e.neutralX
	y := raw.Y - e.neutralY
	if e.neutralZ == 0 && math.Abs(raw.Z) > 2.0 {
		e.neutralZ = raw.Z
	}
	z := raw.Z - e.neutralZ
	if math.Abs(raw.Z) > 2.0 || math.Abs(e.neutralZ) > 2.0 {
		z = math.Max(-1.0, math.Min(1.0, z/25.0))
	} else {
		z = math.Max(-1.0, math.Min(1.0, z))
	}

	// Extract standard ARKit facial blendshapes + 3D Landmark EAR fusion & glasses calibration
	var rawBlinkL, rawBlinkR, blinkL, blinkR, opticalMouth, smile, browUp, browL, browR, eyeX, eyeY float64
	var cheekPuff, mouthPucker, tongueOut, frown, jawX, noseSneer, eyeSquintL, eyeSquintR float64
	if bs := raw.Blendshapes; bs != nil {
		wL, wR := e.smileWeightL, e.smileWeightR
		if wL <= 0 && wR <= 0 {
			wL, wR = 0.5, 0.5
		}

		// Compute smile (with Duchenne cheekSquint synergy) and eyeSquint/cheekSquint first
		// so FuseBlinkScoreWithSquint can guard against smile-induced cheek blink spikes
		// and boost non-smile unilateral winks.
		rawSmile := bs["mouthSmileLeft"]*wL + bs["mouthSmileRight"]*wR
		cheekSmile := bs["cheekSquintLeft"]*wL + bs["cheekSquintRight"]*wR
		if rawSmile > 0.10 && cheekSmile > 0.10 {
			rawSmile = math.Min(1.0, rawSmile+cheekSmile*0.18)
		}
		if ts.EnableSmile {
			smile = calibrateUnipolar(rawSmile, e.neutralSmile, e.calibrated)
		} else {
			smile = 0.0
		}

		eyeSquintL = calibrateUnipolar(math.Max(bs["eyeSquintLeft"], bs["cheekSquintLeft"]*0.85), e.neutralSquintL, e.calibrated)
		eyeSquintR = calibrateUnipolar(math.Max(bs["eyeSquintRight"], bs["cheekSquintRight"]*0.85), e.neutralSquintR, e.calibrated)

		earL, hasEarL := bs["earBlinkLeft"]
		earR, hasEarR := bs["earBlinkRight"]
		fusedL := FuseBlinkScoreWithSquint(bs["eyeBlinkLeft"], earL, hasEarL, eyeSquintL, smile)
		fusedR := FuseBlinkScoreWithSquint(bs["eyeBlinkRight"], earR, hasEarR, eyeSquintR, smile)
		// If the user actively widens the opposite open eye (e.g., while winking the other eye),
		// dampen sympathetic blink bleed on the widened eye.
		if bs["eyeWideLeft"] >= 0.20 && fusedL < 0.55 {
			fusedL = math.Max(0.0, fusedL-bs["eyeWideLeft"]*0.22)
		}
		if bs["eyeWideRight"] >= 0.20 && fusedR < 0.55 {
			fusedR = math.Max(0.0, fusedR-bs["eyeWideRight"]*0.22)
		}

		openL, closedL := e.blinkOpenL, e.blinkClosedL
		openR, closedR := e.blinkOpenR, e.blinkClosedR
		if closedL <= 0 {
			closedL = 1.0
		}
		if closedR <= 0 {
			closedR = 1.0
		}
		rawBlinkL = RemapBlink(fusedL, openL, closedL)
		rawBlinkR = RemapBlink(fusedR, openR, closedR)
		blinkL = rawBlinkL
		blinkR = rawBlinkR
		if stabilizeBlink {
			blinkL, blinkR = StabilizeBlinkWithConfig(rawBlinkL, rawBlinkR, calYawDeg, ts.WinkIsBlink, e.glareAssist, maxYawDeg, threshL, threshR)
			if math.Abs(calYawDeg) > maxYawDeg || e.glareAssist {
				rawBlinkL, rawBlinkR = blinkL, blinkR
			}
		}

		rawJaw := calibrateUnipolar(bs["jawOpen"], e.neutralMouth, e.calibrated)
		opticalMouth = math.Min(1.0, rawJaw*ts.MouthGain)

		// Phase 2 ARKit Expressive Facial Detections (calibrated against Step 1 neutral baseline & Step 4 boom-mic weights)
		rawPucker := extractRawPucker(bs)
		cheekPuff = math.Min(1.0, calibrateUnipolar(bs["cheekPuff"], e.neutralCheekPuff, e.calibrated)*1.8)
		mouthPucker = calibrateUnipolar(rawPucker, e.neutralPucker, e.calibrated)
		tongueOut = math.Max(0.0, math.Min(1.0, bs["tongueOut"]))
		rawFrown := extractRawFrown(bs, wL, wR, rawSmile, rawPucker)
		frown = math.Min(1.0, calibrateUnipolar(rawFrown, e.neutralFrown, e.calibrated)*2.4)
		rawSneer := bs["noseSneerLeft"]*wL + bs["noseSneerRight"]*wR
		noseSneer = math.Min(1.0, calibrateUnipolar(rawSneer, e.neutralNoseSneer, e.calibrated)*1.8)
		rawJawX := bs["jawRight"] - bs["jawLeft"]
		if e.calibrated {
			rawJawX -= e.neutralJawX
		}
		jawX = math.Max(-1.0, math.Min(1.0, rawJawX*2.0))

		rawBrowL, rawBrowR, rawBrowUp := extractRawBrows(bs)
		browUp = rawBrowUp
		if e.calibrated {
			rawBrowL -= e.neutralBrowL
			rawBrowR -= e.neutralBrowR
		}
		// Sympathetic brow furrow when frowning (unless actively raising eyebrows)
		if frown > 0.15 && rawBrowUp < 0.25 {
			rawBrowL -= frown * 0.28
			rawBrowR -= frown * 0.28
		}
		browGain := ts.BrowGain
		if browGain < 0 {
			browGain = 1.5
		} else if browGain == 0 && ts.EyeGazeGain <= 0 {
			browGain = 1.5
		}
		browL = math.Max(-1.0, math.Min(1.0, rawBrowL*browGain))
		browR = math.Max(-1.0, math.Min(1.0, rawBrowR*browGain))

		// Gaze horizontal & vertical with neutral prism calibration and lens-glare deadzone
		rawGazeX, rawGazeY := extractRawGaze(bs)
		if e.calibrated {
			rawGazeX -= e.neutralEyeX
			rawGazeY -= e.neutralEyeY
		}
		deadzone := ts.GazeDeadzone
		if deadzone < 0 {
			deadzone = 0
		}
		eyeX = ApplyGazeDeadzone(rawGazeX, deadzone) * ts.EyeGazeGain
		eyeY = ApplyGazeDeadzone(rawGazeY, deadzone) * ts.EyeGazeGain
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
			switch {
			case isSpeaking:
				// Voice detected: drive mouth with audio or wide optical expression
				finalMouth = math.Max(audioMouth, opticalMouth)
			case opticalMouth > ts.MouthThreshold:
				// Deliberate wide mouth opening even if silent (gasp, yawn, silent expression)
				finalMouth = opticalMouth
			default:
				// Silent and mouth is near neutral: suppress camera optical jitter
				finalMouth = 0.0
			}
		} else {
			// No mic active: purely optical camera tracking
			finalMouth = opticalMouth
		}
	}

	if isLaughing && ts.EnableSmile {
		smile = math.Max(smile, math.Max(ts.SmileThreshold+0.05, 0.55))
	}

	filtBlinkL := e.filter.blinkL.Filter(blinkL, tSec)
	filtBlinkR := e.filter.blinkR.Filter(blinkR, tSec)
	filtMouth := e.filter.mouthOpen.Filter(finalMouth, tSec)
	filtSmile := e.filter.smile.Filter(smile, tSec)
	filtCheekPuff := e.filter.cheekPuff.Filter(cheekPuff, tSec)
	filtMouthPucker := e.filter.mouthPucker.Filter(mouthPucker, tSec)
	filtTongueOut := e.filter.tongueOut.Filter(tongueOut, tSec)
	filtFrown := e.filter.frown.Filter(frown, tSec)
	filtJawX := e.filter.jawX.Filter(jawX, tSec)
	filtNoseSneer := e.filter.noseSneer.Filter(noseSneer, tSec)
	filtSquintL := e.filter.eyeSquintL.Filter(eyeSquintL, tSec)
	filtSquintR := e.filter.eyeSquintR.Filter(eyeSquintR, tSec)
	filtSquint := (filtSquintL + filtSquintR) / 2.0

	var isBlinkL, isBlinkR bool
	if ts.WinkIsBlink {
		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		closed := (rawBlinkL >= threshL) || (rawBlinkR >= threshR)
		isBlinkL = closed
		isBlinkR = closed
		e.inBilateralBlink = closed
		maxBlink := math.Max(filtBlinkL, filtBlinkR)
		filtBlinkL = maxBlink
		filtBlinkR = maxBlink
	} else {
		evalThreshL := threshL
		evalThreshR := threshR
		if stabilizeBlink {
			if calYawDeg > maxYawDeg {
				evalThreshL = threshR
			} else if calYawDeg < -maxYawDeg {
				evalThreshR = threshL
			}
		}
		isBlinkL, isBlinkR = e.evaluateBlinks(rawBlinkL, rawBlinkR, evalThreshL, evalThreshR, syncDelay, raw.Timestamp)
	}

	// Auto-blink is strictly for when camera or face is not detected.
	// When camera detects face, blinks are driven purely by optical tracking.
	e.autoBlinkActive = false
	e.lastBlinkTime = raw.Timestamp

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
		BrowL:            e.filter.browL.Filter(browL, tSec),
		BrowR:            e.filter.browR.Filter(browR, tSec),
		CheekPuff:        filtCheekPuff,
		MouthPucker:      filtMouthPucker,
		TongueOut:        filtTongueOut,
		Frown:            filtFrown,
		JawX:             filtJawX,
		NoseSneer:        filtNoseSneer,
		EyeSquintL:       filtSquintL,
		EyeSquintR:       filtSquintR,
		EyeSquint:        filtSquint,
		MouthThreshold:   ts.MouthThreshold,
		BlinkThreshold:   ts.BlinkThreshold,
		BlinkThresholdL:  threshL,
		BlinkThresholdR:  threshR,
		BlinkSyncDelayMs: syncDelay,
		WinkIsBlink:      ts.WinkIsBlink,
		StabilizeBlink:   stabilizeBlink,
		BlinkMaxHeadYaw:  maxYawDeg,
		SmileThreshold:   ts.SmileThreshold,
		AudioVolume:      audioVolume,
		AudioPitch:       filtAudioPitch,
		Viseme:           rawViseme,
		VisemeA:          filtVisemeA,
		VisemeI:          filtVisemeI,
		VisemeU:          filtVisemeU,
		VisemeE:          filtVisemeE,
		VisemeO:          filtVisemeO,
		BounceAmount:     bounceAmount,
		PhysicsEnabled:   physicsEnabled,
		PhysicsAmount:    physicsAmount,
		DepthZoomAmount:  ts.DepthZoomAmount,
		IsSpeaking:       isSpeaking,
		IsShouting:       isShouting,
		IsLaughing:       isLaughing,
		IsBlinkL:         isBlinkL,
		IsBlinkR:         isBlinkR,
		AutoBlink:        false,
		IsMouthOpen:      filtMouth >= ts.MouthThreshold,
		IsSmiling:        filtSmile >= ts.SmileThreshold,
		IsCheekPuff:      filtCheekPuff >= 0.35,
		IsMouthPucker:    filtMouthPucker >= 0.35,
		IsTongueOut:      filtTongueOut >= 0.35,
		IsFrowning:       filtFrown >= 0.35,
		IsSneering:       filtNoseSneer >= 0.35,
		Expressions:      activeExprs,
		Raw:              raw.Blendshapes,
	}
}

// StabilizeBlink stabilizes left and right eyelid closure values [0.0=open, 1.0=closed],
// suppressing false winks during head turns (when one eye is foreshortened/occluded by the nose bridge)
// and coupling bilateral eyelid jitter while preserving intentional frontal winks.
// Adapted from yeemachine/kalidokit (src/FaceSolver/calcEyes.ts:stabilizeBlink) for ARKit closure convention.
func StabilizeBlink(blinkL, blinkR, calYawDeg float64, winkIsBlink bool, maxYawDeg float64) (float64, float64) {
	return StabilizeBlinkWithConfig(blinkL, blinkR, calYawDeg, winkIsBlink, false, maxYawDeg, 0.45, 0.45)
}

// StabilizeBlinkWithConfig extends StabilizeBlink with relative user thresholds and GlareAssist
// (which couples a glare-weakened eye to the clearer eye during bilateral blinks behind glasses).
func StabilizeBlinkWithConfig(blinkL, blinkR, calYawDeg float64, winkIsBlink, glareAssist bool, maxYawDeg, threshL, threshR float64) (float64, float64) {
	blinkL = math.Max(0.0, math.Min(1.0, blinkL))
	blinkR = math.Max(0.0, math.Min(1.0, blinkR))
	if maxYawDeg <= 0 {
		maxYawDeg = 25.0
	}
	if threshL <= 0 {
		threshL = 0.45
	}
	if threshR <= 0 {
		threshR = 0.45
	}

	// 1. Head-turn occlusion override:
	// When head turns toward screen-right (+calYawDeg > maxYawDeg), Left eye is turned away / occluded -> mirror Right eye.
	if calYawDeg > maxYawDeg {
		return blinkR, blinkR
	}
	// When head turns toward screen-left (calYawDeg < -maxYawDeg), Right eye is turned away / occluded -> mirror Left eye.
	if calYawDeg < -maxYawDeg {
		return blinkL, blinkL
	}

	// 2. Frontal bilateral coupling vs intentional wink disambiguation:
	minBlink := math.Min(blinkL, blinkR)
	maxBlink := math.Max(blinkL, blinkR)
	winkOnsetL := threshL * 0.78
	winkOnsetR := threshR * 0.78
	closingL := threshL * 0.88
	closingR := threshR * 0.88

	// When WinkIsBlink is active, any single-eye closure couples both eyes closed
	if winkIsBlink && (blinkL >= winkOnsetL || blinkR >= winkOnsetR) {
		return maxBlink, maxBlink
	}

	// GlareAssist (for glasses where one lens has severe reflection blindness):
	// If one eye cleanly crosses its blink threshold while the glare-weakened eye shows
	// substantial bilateral closure (>= 55% of its threshold), couple both eyes closed.
	if glareAssist {
		if (blinkL >= threshL && blinkR >= threshR*0.55) || (blinkR >= threshR && blinkL >= threshL*0.55) {
			coupled := minBlink*0.10 + maxBlink*0.90
			return coupled, coupled
		}
	}

	// Both eyes closing in a bilateral blink: couple toward the more closed eye so both close evenly
	bothClosing := blinkL >= closingL && blinkR >= closingR
	if bothClosing {
		coupled := minBlink*0.05 + maxBlink*0.95
		return coupled, coupled
	}

	// One eye closing/winking while the other is open: preserve independent values so face-on
	// winks and blink onsets are never suppressed (evaluateBlinks handles the syncDelay window).
	if blinkL >= winkOnsetL || blinkR >= winkOnsetR {
		return blinkL, blinkR
	}

	// Both eyes resting open: gently couple minor resting eyelid jitter toward open
	coupled := minBlink*0.95 + maxBlink*0.05
	return coupled, coupled
}

// evaluateBlinks applies independent thresholds and a synchronization delay window to
// discriminate between natural bilateral blinks and intentional unilateral winks.
func (e *Engine) evaluateBlinks(filtL, filtR, threshL, threshR, syncDelay, nowMs float64) (bool, bool) {
	// Apply generous hysteresis (15%) to prevent threshold-edge flutter behind glasses
	const hysteresis = 0.15

	reopenL := math.Max(0.12, threshL-hysteresis)
	reopenR := math.Max(0.12, threshR-hysteresis)

	if !e.eyeClosedL {
		if filtL >= threshL {
			e.eyeClosedL = true
		}
	} else {
		if filtL < reopenL {
			e.eyeClosedL = false
		}
	}

	if !e.eyeClosedR {
		if filtR >= threshR {
			e.eyeClosedR = true
		}
	} else {
		if filtR < reopenR {
			e.eyeClosedR = false
		}
	}

	rawL := e.eyeClosedL
	rawR := e.eyeClosedR

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
		e.lastCloseTimeL = 0
		e.lastCloseTimeR = 0
		e.inBilateralBlink = true
		return true, true
	}

	// Case 2: Both eyes open simultaneously
	if !rawL && !rawR {
		// Anti-flutter hold for confirmed unilateral winks: if a lens reflection causes a brief
		// 1-2 frame (< 45ms) mid-squint dip (>= 0.16) while holding a wink, do not drop the wink
		// or reset the syncDelay timer.
		winkHoldWindow := math.Min(45.0, syncDelay)
		if !e.inBilateralBlink && e.lastCloseTimeL > 0 && nowMs >= e.lastCloseTimeL && nowMs-e.lastCloseTimeL <= winkHoldWindow && filtL >= 0.16 {
			e.eyeClosedL = true
			return true, false
		}
		if !e.inBilateralBlink && e.lastCloseTimeR > 0 && nowMs >= e.lastCloseTimeR && nowMs-e.lastCloseTimeR <= winkHoldWindow && filtR >= 0.16 {
			e.eyeClosedR = true
			return false, true
		}

		e.pendingCloseL = false
		e.pendingCloseR = false
		e.pendingOpenL = false
		e.pendingOpenR = false
		e.lastCloseTimeL = 0
		e.lastCloseTimeR = 0
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
			e.lastCloseTimeR = nowMs
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
			e.lastCloseTimeL = nowMs
			return true, false
		}
	}

	// Case 4: Eye closure initiation.
	// When one eye crosses threshold, delay unilateral wink output by syncDelay
	// to give the second eye an opportunity to close for a clean bilateral blink.
	if rawL && !rawR {
		e.pendingCloseR = false
		e.lastCloseTimeR = 0
		if !e.pendingCloseL {
			e.pendingCloseL = true
			e.closeTimeL = nowMs
		}
		if nowMs-e.closeTimeL < syncDelay && nowMs >= e.closeTimeL {
			return false, false
		}
		// Delay expired: intentional Left wink
		e.lastCloseTimeL = nowMs
		return true, false
	}

	if !rawL && rawR {
		e.pendingCloseL = false
		e.lastCloseTimeL = 0
		if !e.pendingCloseR {
			e.pendingCloseR = true
			e.closeTimeR = nowMs
		}
		if nowMs-e.closeTimeR < syncDelay && nowMs >= e.closeTimeR {
			return false, false
		}
		// Delay expired: intentional Right wink
		e.lastCloseTimeR = nowMs
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

// computeAutoBlink evaluates autonomous natural blinks when camera or face is not detected.
// Auto-blink uses strictly AutoBlinkIntervalSec and is independent of camera optical thresholds.
func (e *Engine) computeAutoBlink(ts config.TrackingSettings, timestamp float64) (bool, float64) {
	if !ts.AutoBlink {
		e.autoBlinkActive = false
		return false, 0
	}

	baseIntervalMs := ts.AutoBlinkIntervalSec * 1000.0
	if baseIntervalMs <= 500 {
		baseIntervalMs = 4000.0
	}

	if e.lastBlinkTime == 0 || e.nextAutoBlinkInterval <= 0 {
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
