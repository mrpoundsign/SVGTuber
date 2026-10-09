package tracking

import (
	"math"
	"math/rand"
	"path/filepath"
	"testing"

	"github.com/mrpoundsign/SVGTuber/internal/config"
)

func TestOneEuroFilter_NoiseReduction(t *testing.T) {
	f := NewOneEuroFilter(1.0, 0.005, 1.0)

	const steps = 100
	const dt = 0.016 // ~60 Hz
	const trueVal = 10.0

	var rawSum, rawSqSum float64
	var filtSum, filtSqSum float64

	rng := rand.New(rand.NewSource(42))

	for i := 0; i < steps; i++ {
		tSec := float64(i) * dt
		noise := (rng.Float64() - 0.5) * 2.0 // +/- 1.0 noise
		x := trueVal + noise

		filtered := f.Filter(x, tSec)

		rawSum += noise
		rawSqSum += noise * noise

		filtDiff := filtered - trueVal
		filtSum += filtDiff
		filtSqSum += filtDiff * filtDiff
	}

	rawVar := (rawSqSum / steps) - math.Pow(rawSum/steps, 2)
	filtVar := (filtSqSum / steps) - math.Pow(filtSum/steps, 2)

	if filtVar >= rawVar {
		t.Errorf("Expected filtered variance (%f) to be less than raw variance (%f)", filtVar, rawVar)
	}
}

func TestEngine_Calibration(t *testing.T) {
	eng := NewEngine()

	// Feed frame with tilted head
	f1 := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Yaw:       15.0,
		Pitch:     -8.0,
		Roll:      2.0,
		Blendshapes: map[string]float64{
			"jawOpen": 0.4,
		},
	}

	_ = eng.Process(f1)
	// Now calibrate neutral pose at this head position
	eng.Calibrate()

	// Process same position again
	f2 := FaceFrame{
		Timestamp: 1016,
		Present:   true,
		Yaw:       15.0,
		Pitch:     -8.0,
		Roll:      2.0,
		Blendshapes: map[string]float64{
			"jawOpen": 0.4,
		},
	}

	out := eng.Process(f2)

	// Since raw yaw matches calibrated neutral yaw (15.0), calibrated yaw should be near 0
	if math.Abs(out.HeadYaw) > 1.0 {
		t.Errorf("Expected HeadYaw near 0 after calibration, got %f", out.HeadYaw)
	}
	if math.Abs(out.HeadPitch) > 1.0 {
		t.Errorf("Expected HeadPitch near 0 after calibration, got %f", out.HeadPitch)
	}
}

func TestEngine_TrackingLoss(t *testing.T) {
	eng := NewEngine()

	fPresent := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Yaw:       20.0,
	}
	_ = eng.Process(fPresent)

	// Face lost frame
	fLost := FaceFrame{
		Timestamp: 1050,
		Present:   false,
	}
	outLost := eng.Process(fLost)

	if outLost.Present != false {
		t.Errorf("Expected Present=false when tracking is lost")
	}

	// Should be decaying towards 0
	if outLost.HeadYaw >= 20.0 {
		t.Errorf("Expected HeadYaw to decay towards 0, got %f", outLost.HeadYaw)
	}
}

func TestEngine_EyeGaze(t *testing.T) {
	eng := NewEngine()

	// Frame looking to the right and down
	f := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeLookOutLeft":   0.8,
			"eyeLookInRight":   0.8,
			"eyeLookDownLeft":  0.6,
			"eyeLookDownRight": 0.6,
		},
	}
	out := eng.Process(f)

	if out.EyeX <= 0.5 {
		t.Errorf("Expected EyeX > 0.5 when looking right, got %f", out.EyeX)
	}
	if out.EyeY <= 0.4 {
		t.Errorf("Expected EyeY > 0.4 when looking down, got %f", out.EyeY)
	}
}

func TestEngine_HybridAudioMode(t *testing.T) {
	eng := NewEngine() // default mode is hybrid

	// 1. Silent mic: mouth should remain closed with minor optical camera noise
	fQuiet := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"jawOpen": 0.05, // minor optical noise
		},
		Audio: &AudioPayload{
			Active:     true,
			Volume:     0.01,
			IsSpeaking: false,
		},
	}
	outQuiet := eng.Process(fQuiet)
	if outQuiet.MouthOpen > 0.01 {
		t.Errorf("Expected MouthOpen near 0 when audio is silent in hybrid mode, got %f", outQuiet.MouthOpen)
	}

	// 2. Speaking into mic: feed a burst of speech frames
	var outSpeaking ParamFrame
	for i := 1; i <= 6; i++ {
		fSpeaking := FaceFrame{
			Timestamp: float64(1000 + i*16),
			Present:   true,
			Blendshapes: map[string]float64{
				"jawOpen": 0.05,
			},
			Audio: &AudioPayload{
				Active:     true,
				Volume:     0.5,
				IsSpeaking: true,
			},
		}
		outSpeaking = eng.Process(fSpeaking)
	}

	if outSpeaking.MouthOpen <= 0.3 {
		t.Errorf("Expected MouthOpen > 0.3 after speech burst, got %f", outSpeaking.MouthOpen)
	}
	if !outSpeaking.IsSpeaking {
		t.Errorf("Expected IsSpeaking=true")
	}
}

func TestEngine_HybridNoMic_WideMouth(t *testing.T) {
	eng := NewEngine() // hybrid mode

	// No mic on (Audio is nil)
	fNoMic := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"jawOpen": 0.35, // user opens mouth wide
		},
		Audio: nil,
	}
	out := eng.Process(fNoMic)
	if out.MouthOpen <= 0.2 {
		t.Errorf("Expected MouthOpen > 0.2 when mouth opened wide without mic, got %f", out.MouthOpen)
	}
}

func TestEngine_HybridSilentMic_WideMouth(t *testing.T) {
	eng := NewEngine() // hybrid mode

	// Mic on, but user is silent (e.g. yawn, silent gasp)
	fSilentWide := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"jawOpen": 0.35, // user opens mouth wide
		},
		Audio: &AudioPayload{
			Active:     true,
			Volume:     0.0,
			IsSpeaking: false,
		},
	}
	out := eng.Process(fSilentWide)
	if out.MouthOpen <= 0.2 {
		t.Errorf("Expected MouthOpen > 0.2 for silent wide mouth in hybrid mode, got %f", out.MouthOpen)
	}
}

func TestEngine_AudioOnlyMode(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	// Set mode to audio
	s := cfgMgr.Get()
	s.Audio.Mode = "audio"
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// User speaks without camera present
	f := FaceFrame{
		Timestamp: 1000,
		Present:   false, // camera off
		Audio: &AudioPayload{
			Volume:     0.6,
			IsSpeaking: true,
		},
	}
	out := eng.Process(f)

	if !out.Present {
		t.Errorf("Expected Present=true during speech in audio-only mode")
	}
	if out.MouthOpen <= 0.3 {
		t.Errorf("Expected MouthOpen > 0.3, got %f", out.MouthOpen)
	}
	if out.HeadY >= 0 {
		t.Errorf("Expected negative HeadY (speech bounce bob), got %f", out.HeadY)
	}
}

func TestEngine_IndependentEyeSensitivity(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.BlinkThresholdL = 0.30
	s.Tracking.BlinkThresholdR = 0.60
	s.Tracking.BlinkSyncDelayMs = 0 // test pure independent thresholds without delay
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Feed frame where raw blink is 0.45 for both eyes
	// 0.45 >= 0.30 (Left triggered), but 0.45 < 0.60 (Right not triggered)
	f := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.45,
			"eyeBlinkRight": 0.45,
		},
	}
	out := eng.Process(f)

	if !out.IsBlinkL {
		t.Errorf("Expected Left eye to trigger (threshold 0.30, got %f)", out.BlinkL)
	}
	if out.IsBlinkR {
		t.Errorf("Expected Right eye NOT to trigger (threshold 0.60, got %f)", out.BlinkR)
	}
}

func TestEngine_BlinkSynchronizationDelay(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.BlinkThresholdL = 0.45
	s.Tracking.BlinkThresholdR = 0.45
	s.Tracking.BlinkSyncDelayMs = 50.0 // 50ms sync window
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Step 1: Left eye closes at t=1000ms, Right eye is still open.
	// Within the 50ms sync window, both eyes should remain open to prevent a 1-frame micro-wink!
	f1 := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.8,
			"eyeBlinkRight": 0.1,
		},
	}
	out1 := eng.Process(f1)
	if out1.IsBlinkL || out1.IsBlinkR {
		t.Errorf("Expected both eyes open during sync window, got L=%v R=%v", out1.IsBlinkL, out1.IsBlinkR)
	}

	// Step 2: Right eye closes at t=1030ms (30ms later, within 50ms window).
	// Bilateral blink confirmed! Both eyes snap shut simultaneously.
	f2 := FaceFrame{
		Timestamp: 1030,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.8,
			"eyeBlinkRight": 0.8,
		},
	}
	out2 := eng.Process(f2)
	if !out2.IsBlinkL || !out2.IsBlinkR {
		t.Errorf("Expected both eyes closed together, got L=%v R=%v", out2.IsBlinkL, out2.IsBlinkR)
	}

	// Step 3: Reopening at t=1120ms. Left eye opens ahead of Right eye (e.g. 0.1 vs 0.55).
	// Within reopening sync window, hold both eyes closed to prevent reopening flutter!
	f3 := FaceFrame{
		Timestamp: 1120,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.1,
			"eyeBlinkRight": 0.55,
		},
	}
	out3 := eng.Process(f3)
	if !out3.IsBlinkL || !out3.IsBlinkR {
		t.Errorf("Expected both eyes to stay closed during reopening sync window, got L=%v R=%v", out3.IsBlinkL, out3.IsBlinkR)
	}

	// Step 4: Right eye opens at t=1140ms (20ms later). Both eyes open cleanly together.
	f4 := FaceFrame{
		Timestamp: 1140,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.1,
			"eyeBlinkRight": 0.1,
		},
	}
	out4 := eng.Process(f4)
	if out4.IsBlinkL || out4.IsBlinkR {
		t.Errorf("Expected both eyes open cleanly, got L=%v R=%v", out4.IsBlinkL, out4.IsBlinkR)
	}
}

func TestEngine_IntentionalWink(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.BlinkThresholdL = 0.45
	s.Tracking.BlinkThresholdR = 0.45
	s.Tracking.BlinkSyncDelayMs = 50.0
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Step 1: Left eye closes at t=1000ms, Right eye open
	f1 := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	}
	_ = eng.Process(f1)

	// Step 2: At t=1060ms (60ms elapsed > 50ms delay), Right eye is STILL open.
	// Sync delay expired: confirmed intentional wink! Left eye closes, Right eye open.
	f2 := FaceFrame{
		Timestamp: 1060,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	}
	out2 := eng.Process(f2)
	if !out2.IsBlinkL {
		t.Errorf("Expected Left eye to be closed for confirmed wink, got %v", out2.IsBlinkL)
	}
	if out2.IsBlinkR {
		t.Errorf("Expected Right eye to stay open for wink, got %v", out2.IsBlinkR)
	}
}

func TestEngine_WinkIsBlink(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.BlinkThresholdL = 0.45
	s.Tracking.BlinkThresholdR = 0.45
	s.Tracking.WinkIsBlink = true
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Step 1: User winks Left eye only (Right eye open)
	f1 := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	}
	out1 := eng.Process(f1)
	if !out1.IsBlinkL || !out1.IsBlinkR {
		t.Errorf("Expected BOTH eyes to close when WinkIsBlink=true, got L=%v R=%v", out1.IsBlinkL, out1.IsBlinkR)
	}
	if out1.BlinkL < 0.8 || out1.BlinkR < 0.8 {
		t.Errorf("Expected mirrored analog blinks, got BlinkL=%f BlinkR=%f", out1.BlinkL, out1.BlinkR)
	}

	// Step 2: User opens both eyes
	f2 := FaceFrame{
		Timestamp: 1030,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.05,
			"eyeBlinkRight": 0.05,
		},
	}
	out2 := eng.Process(f2)
	if out2.IsBlinkL || out2.IsBlinkR {
		t.Errorf("Expected both eyes open when eyes are open, got L=%v R=%v", out2.IsBlinkL, out2.IsBlinkR)
	}

	// Step 3: User winks Right eye only (Left eye open)
	f3 := FaceFrame{
		Timestamp: 1060,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.05,
			"eyeBlinkRight": 0.90,
		},
	}
	out3 := eng.Process(f3)
	if !out3.IsBlinkL || !out3.IsBlinkR {
		t.Errorf("Expected BOTH eyes to close on Right wink when WinkIsBlink=true, got L=%v R=%v", out3.IsBlinkL, out3.IsBlinkR)
	}
}


