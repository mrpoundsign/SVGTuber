package tracking

import (
	"sync"
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
}

// NewEngine creates a new tracking Engine.
func NewEngine() *Engine {
	return &Engine{
		filter: NewPoseFilter(),
	}
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

	if !raw.Present {
		// Face lost: smoothly filter down toward neutral (0)
		return ParamFrame{
			Type:      "param_frame",
			T:         raw.Timestamp,
			Present:   false,
			HeadYaw:   e.filter.yaw.Filter(0, tSec),
			HeadPitch: e.filter.pitch.Filter(0, tSec),
			HeadRoll:  e.filter.roll.Filter(0, tSec),
			HeadX:     e.filter.x.Filter(0, tSec),
			HeadY:     e.filter.y.Filter(0, tSec),
			HeadZ:     e.filter.z.Filter(0, tSec),
			BlinkL:    e.filter.blinkL.Filter(0, tSec),
			BlinkR:    e.filter.blinkR.Filter(0, tSec),
			MouthOpen: e.filter.mouthOpen.Filter(0, tSec),
			Smile:     e.filter.smile.Filter(0, tSec),
			BrowUp:    e.filter.browUp.Filter(0, tSec),
		}
	}

	// Calibrate angles and translation
	yaw := raw.Yaw - e.neutralYaw
	pitch := raw.Pitch - e.neutralPitch
	roll := raw.Roll - e.neutralRoll
	x := raw.X - e.neutralX
	y := raw.Y - e.neutralY
	z := raw.Z - e.neutralZ

	// Extract standard ARKit facial blendshapes
	var blinkL, blinkR, mouthOpen, smile, browUp float64
	if bs := raw.Blendshapes; bs != nil {
		blinkL = bs["eyeBlinkLeft"]
		blinkR = bs["eyeBlinkRight"]
		mouthOpen = bs["jawOpen"]

		smileLeft := bs["mouthSmileLeft"]
		smileRight := bs["mouthSmileRight"]
		smile = (smileLeft + smileRight) / 2.0

		browInner := bs["browInnerUp"]
		browOuterL := bs["browOuterUpLeft"]
		browOuterR := bs["browOuterUpRight"]
		browUp = (browInner + browOuterL + browOuterR) / 3.0
	}

	return ParamFrame{
		Type:      "param_frame",
		T:         raw.Timestamp,
		Present:   true,
		HeadYaw:   e.filter.yaw.Filter(yaw, tSec),
		HeadPitch: e.filter.pitch.Filter(pitch, tSec),
		HeadRoll:  e.filter.roll.Filter(roll, tSec),
		HeadX:     e.filter.x.Filter(x, tSec),
		HeadY:     e.filter.y.Filter(y, tSec),
		HeadZ:     e.filter.z.Filter(z, tSec),
		BlinkL:    e.filter.blinkL.Filter(blinkL, tSec),
		BlinkR:    e.filter.blinkR.Filter(blinkR, tSec),
		MouthOpen: e.filter.mouthOpen.Filter(mouthOpen, tSec),
		Smile:     e.filter.smile.Filter(smile, tSec),
		BrowUp:    e.filter.browUp.Filter(browUp, tSec),
		Raw:       raw.Blendshapes,
	}
}
