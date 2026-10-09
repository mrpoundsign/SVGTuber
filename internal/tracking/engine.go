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
	filter       *PoseFilter
	lastRaw      FaceFrame
	configMgr    *config.Manager
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
	e.calibrated = false
	e.filter.Reset()
}

// Process transforms a raw FaceFrame from Studio into a smoothed, calibrated ParamFrame.
func (e *Engine) Process(raw FaceFrame) ParamFrame {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.lastRaw = raw

	// Time in seconds for filter calculation
	tSec := raw.Timestamp / 1000.0
	if tSec <= 0 {
		tSec = 1.0
	}

	var ts config.TrackingSettings
	if e.configMgr != nil {
		ts = e.configMgr.Get().Tracking
	} else {
		ts = config.DefaultSettings().Tracking
	}

	if !raw.Present {
		// Face lost: smoothly filter down toward neutral (0)
		return ParamFrame{
			Type:           "param_frame",
			T:              raw.Timestamp,
			Present:        false,
			HeadYaw:        e.filter.yaw.Filter(0, tSec),
			HeadPitch:      e.filter.pitch.Filter(0, tSec),
			HeadRoll:       e.filter.roll.Filter(0, tSec),
			HeadX:          e.filter.x.Filter(0, tSec),
			HeadY:          e.filter.y.Filter(0, tSec),
			HeadZ:          e.filter.z.Filter(0, tSec),
			EyeX:           e.filter.eyeX.Filter(0, tSec),
			EyeY:           e.filter.eyeY.Filter(0, tSec),
			BlinkL:         e.filter.blinkL.Filter(0, tSec),
			BlinkR:         e.filter.blinkR.Filter(0, tSec),
			MouthOpen:      e.filter.mouthOpen.Filter(0, tSec),
			Smile:          e.filter.smile.Filter(0, tSec),
			BrowUp:         e.filter.browUp.Filter(0, tSec),
			MouthThreshold: ts.MouthThreshold,
			BlinkThreshold: ts.BlinkThreshold,
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
	var blinkL, blinkR, mouthOpen, smile, browUp, eyeX, eyeY float64
	if bs := raw.Blendshapes; bs != nil {
		blinkL = bs["eyeBlinkLeft"]
		blinkR = bs["eyeBlinkRight"]
		mouthOpen = math.Min(1.0, bs["jawOpen"]*ts.MouthGain)

		smileLeft := bs["mouthSmileLeft"]
		smileRight := bs["mouthSmileRight"]
		smile = (smileLeft + smileRight) / 2.0

		browInner := bs["browInnerUp"]
		browOuterL := bs["browOuterUpLeft"]
		browOuterR := bs["browOuterUpRight"]
		browUp = (browInner + browOuterL + browOuterR) / 3.0

		// Gaze horizontal: looking right is +X, looking left is -X
		lookRight := (bs["eyeLookInLeft"] + bs["eyeLookOutRight"]) / 2.0
		lookLeft := (bs["eyeLookOutLeft"] + bs["eyeLookInRight"]) / 2.0
		eyeX = (lookRight - lookLeft) * ts.EyeGazeGain

		// Gaze vertical: SVG Y is downwards, so looking down is +Y, looking up is -Y
		lookUp := (bs["eyeLookUpLeft"] + bs["eyeLookUpRight"]) / 2.0
		lookDown := (bs["eyeLookDownLeft"] + bs["eyeLookDownRight"]) / 2.0
		eyeY = (lookDown - lookUp) * ts.EyeGazeGain
	}

	return ParamFrame{
		Type:           "param_frame",
		T:              raw.Timestamp,
		Present:        true,
		HeadYaw:        e.filter.yaw.Filter(yaw, tSec),
		HeadPitch:      e.filter.pitch.Filter(pitch, tSec),
		HeadRoll:       e.filter.roll.Filter(roll, tSec),
		HeadX:          e.filter.x.Filter(x, tSec),
		HeadY:          e.filter.y.Filter(y, tSec),
		HeadZ:          e.filter.z.Filter(z, tSec),
		EyeX:           e.filter.eyeX.Filter(eyeX, tSec),
		EyeY:           e.filter.eyeY.Filter(eyeY, tSec),
		BlinkL:         e.filter.blinkL.Filter(blinkL, tSec),
		BlinkR:         e.filter.blinkR.Filter(blinkR, tSec),
		MouthOpen:      e.filter.mouthOpen.Filter(mouthOpen, tSec),
		Smile:          e.filter.smile.Filter(smile, tSec),
		BrowUp:         e.filter.browUp.Filter(browUp, tSec),
		MouthThreshold: ts.MouthThreshold,
		BlinkThreshold: ts.BlinkThreshold,
		Raw:            raw.Blendshapes,
	}
}
