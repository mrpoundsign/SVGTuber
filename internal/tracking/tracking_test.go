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

	for i := range steps {
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

	rawMean := rawSum / steps
	rawVar := (rawSqSum / steps) - (rawMean * rawMean)
	filtMean := filtSum / steps
	filtVar := (filtSqSum / steps) - (filtMean * filtMean)

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

	if out.Present {
		t.Errorf("Expected Present=false when camera is off/face lost, got true")
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

func TestEngine_AutoBlink(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.AutoBlink = true
	s.Tracking.AutoBlinkIntervalSec = 3.0 // 3 seconds
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Step 1: When face is present, auto-blink must NEVER trigger (pure optical camera tracking)
	fTracked := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.0,
			"eyeBlinkRight": 0.0,
		},
	}
	out1 := eng.Process(fTracked)
	if out1.IsBlinkL || out1.IsBlinkR || out1.AutoBlink {
		t.Errorf("Expected eyes open on initial frame, got AutoBlink=%v", out1.AutoBlink)
	}

	outTrackedLate := eng.Process(FaceFrame{
		Timestamp: 6000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.0,
			"eyeBlinkRight": 0.0,
		},
	})
	if outTrackedLate.AutoBlink {
		t.Errorf("Expected AutoBlink to NEVER trigger while face is present/tracked")
	}

	// Step 2: Camera off or face lost (Present: false). Auto-blink should engage at configured interval.
	_ = eng.Process(FaceFrame{Timestamp: 6000, Present: false})

	// Advance time past auto-blink interval (t = 10500ms > 6000 + 3000*1.2)
	// Peak of auto-blink (e.g. 70ms into 140ms duration)
	f2 := FaceFrame{
		Timestamp: 10500,
		Present:   false,
	}
	out2 := eng.Process(f2)
	if !out2.AutoBlink {
		t.Errorf("Expected AutoBlink to trigger at t=10500ms when face is not present")
	}

	// Mid-blink at t=10570ms: eyes should be closed
	f3 := FaceFrame{
		Timestamp: 10570,
		Present:   false,
	}
	out3 := eng.Process(f3)
	if !out3.IsBlinkL || !out3.IsBlinkR {
		t.Errorf("Expected both eyes closed mid-autoblink, got L=%v R=%v", out3.IsBlinkL, out3.IsBlinkR)
	}

	// Step 3: Advance past blink duration (t = 10700ms > 10500 + 140ms)
	f4 := FaceFrame{
		Timestamp: 10700,
		Present:   false,
	}
	out4 := eng.Process(f4)
	if out4.AutoBlink || out4.IsBlinkL || out4.IsBlinkR {
		t.Errorf("Expected eyes reopened after autoblink finished, got AutoBlink=%v L=%v R=%v", out4.AutoBlink, out4.IsBlinkL, out4.IsBlinkR)
	}
}

func TestEngine_AutomationsMode_FaceLostOnly(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.AutoBlink = true
	s.Tracking.AutoBlinkIntervalSec = 2.0
	s.Tracking.AutoBlinkMode = "face_lost_only"
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Step 1: Face is present for 5000ms. Auto-blink should NOT trigger because mode is face_lost_only.
	_ = eng.Process(FaceFrame{Timestamp: 1000, Present: true})
	outTracked := eng.Process(FaceFrame{Timestamp: 5000, Present: true})
	if outTracked.AutoBlink {
		t.Errorf("Expected AutoBlink to NOT trigger while face is present in face_lost_only mode")
	}

	// Step 2: Face is lost at t=5500ms. Now auto-blink should be allowed!
	_ = eng.Process(FaceFrame{Timestamp: 5500, Present: false})
	outLost := eng.Process(FaceFrame{Timestamp: 8500, Present: false})
	if !outLost.AutoBlink {
		t.Errorf("Expected AutoBlink to trigger when face is lost in face_lost_only mode")
	}
}

func TestEngine_StreamBlinkCount(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	s := cfgMgr.Get()
	s.Tracking.AutoBlink = true
	s.Tracking.AutoBlinkIntervalSec = 4.5
	s.Tracking.AutoBlinkMode = "face_lost_only"
	s.Tracking.BlinkThreshold = 0.46
	s.Tracking.BlinkThresholdL = 0.46
	s.Tracking.BlinkThresholdR = 0.46
	_ = cfgMgr.Update(s)

	eng := NewEngine(cfgMgr)

	// Simulate 10 seconds of 60fps frames with Face NOT present
	var blinksCount int
	wasBlink := false
	for tMs := 0.0; tMs <= 10000.0; tMs += 16.6 {
		out := eng.Process(FaceFrame{
			Timestamp: tMs,
			Present:   false,
		})
		isClosed := out.IsBlinkL || out.IsBlinkR
		if isClosed && !wasBlink {
			blinksCount++
		}
		wasBlink = isClosed
	}
	t.Logf("Face lost: 10s of 60fps yielded %d auto-blinks (expected ~2 with 4.5s interval)", blinksCount)

	// Simulate 10 seconds of 60fps with Face present and eye hovering around 0.45-0.47
	eng2 := NewEngine(cfgMgr)
	var noiseBlinksCount int
	wasNoiseBlink := false
	for i, tMs := 0, 0.0; tMs <= 10000.0; i, tMs = i+1, tMs+16.6 {
		// Eye value slightly jittering around 0.46
		eyeVal := 0.45 + float64(i%2)*0.02 // 0.45, 0.47, 0.45, 0.47...
		out := eng2.Process(FaceFrame{
			Timestamp: tMs,
			Present:   true,
			Blendshapes: map[string]float64{
				"eyeBlinkLeft":  eyeVal,
				"eyeBlinkRight": eyeVal,
			},
		})
		isClosed := out.IsBlinkL || out.IsBlinkR
		if isClosed && !wasNoiseBlink {
			noiseBlinksCount++
		}
		wasNoiseBlink = isClosed
	}
	t.Logf("Tracked with 0.45-0.47 noise: 10s of 60fps yielded %d blinks!", noiseBlinksCount)
}

func TestEngine_IndependentEyebrows(t *testing.T) {
	eng := NewEngine()

	// 1. Left eyebrow raised, Right eyebrow furrowed ("skeptical brow" expression)
	f1 := FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"browOuterUpLeft":  0.6,
			"browDownLeft":     0.0,
			"browOuterUpRight": 0.0,
			"browDownRight":    0.5,
			"browInnerUp":      0.0,
		},
	}
	out1 := eng.Process(f1)
	if out1.BrowL <= 0.5 {
		t.Errorf("Expected BrowL > 0.5 when left eyebrow raised, got %f", out1.BrowL)
	}
	if out1.BrowR >= -0.4 {
		t.Errorf("Expected BrowR < -0.4 when right eyebrow furrowed, got %f", out1.BrowR)
	}

	// 2. Both eyebrows raised via browInnerUp
	eng2 := NewEngine()
	f2 := FaceFrame{
		Timestamp: 2000,
		Present:   true,
		Blendshapes: map[string]float64{
			"browInnerUp":      0.5,
			"browOuterUpLeft":  0.4,
			"browOuterUpRight": 0.4,
		},
	}
	out2 := eng2.Process(f2)
	if out2.BrowL <= 0.4 || out2.BrowR <= 0.4 {
		t.Errorf("Expected both BrowL and BrowR > 0.4 when inner brows raised, got L=%f R=%f", out2.BrowL, out2.BrowR)
	}

	// 3. Calibration zeroes resting brow offset
	eng2.Calibrate()
	outCal := eng2.Process(FaceFrame{
		Timestamp: 2016,
		Present:   true,
		Blendshapes: map[string]float64{
			"browInnerUp":      0.5,
			"browOuterUpLeft":  0.4,
			"browOuterUpRight": 0.4,
		},
	})
	if math.Abs(outCal.BrowL) > 0.05 || math.Abs(outCal.BrowR) > 0.05 {
		t.Errorf("Expected BrowL and BrowR near 0 after calibration, got L=%f R=%f", outCal.BrowL, outCal.BrowR)
	}
}

func TestStabilizeBlink_HeadTurnOcclusion(t *testing.T) {
	// 1. Head turned right (+30 deg > 25 deg): Left eye foreshortened (0.85), Right eye open (0.05) -> both mirror Right (0.05)
	l, r := StabilizeBlink(0.85, 0.05, 30.0, false, 25.0)
	if math.Abs(l-0.05) > 1e-6 || math.Abs(r-0.05) > 1e-6 {
		t.Errorf("Expected both eyes to mirror unobstructed Right eye (0.05) on +30° yaw, got L=%v R=%v", l, r)
	}

	// 2. Head turned left (-30 deg < -25 deg): Right eye foreshortened (0.88), Left eye open (0.04) -> both mirror Left (0.04)
	l2, r2 := StabilizeBlink(0.04, 0.88, -30.0, false, 25.0)
	if math.Abs(l2-0.04) > 1e-6 || math.Abs(r2-0.04) > 1e-6 {
		t.Errorf("Expected both eyes to mirror unobstructed Left eye (0.04) on -30° yaw, got L=%v R=%v", l2, r2)
	}

	// 3. Natural bilateral blink during head turn (+30 deg): unobstructed Right eye closes (0.90) -> both close (0.90)
	l3, r3 := StabilizeBlink(0.95, 0.90, 30.0, false, 25.0)
	if math.Abs(l3-0.90) > 1e-6 || math.Abs(r3-0.90) > 1e-6 {
		t.Errorf("Expected both eyes to close (0.90) during head-turn blink, got L=%v R=%v", l3, r3)
	}
}

func TestStabilizeBlink_FrontalWinkAndCoupling(t *testing.T) {
	// 1. Intentional frontal wink (even with natural opposite-eye squint: blinkL=0.55, blinkR=0.15) -> preserved independently
	l, r := StabilizeBlink(0.55, 0.15, 5.0, false, 25.0)
	if math.Abs(l-0.55) > 1e-6 || math.Abs(r-0.15) > 1e-6 {
		t.Errorf("Expected intentional frontal wink to be preserved (0.55, 0.15), got L=%v R=%v", l, r)
	}

	// 2. Resting open eyes with minor optical jitter (blinkL=0.22, blinkR=0.08, both < 0.35) -> coupled toward open eye
	l2, r2 := StabilizeBlink(0.22, 0.08, 0.0, false, 25.0)
	expectedCoupled := 0.08*0.95 + 0.22*0.05 // 0.087
	if math.Abs(l2-expectedCoupled) > 1e-6 || math.Abs(r2-expectedCoupled) > 1e-6 {
		t.Errorf("Expected resting open jitter to couple to %v, got L=%v R=%v", expectedCoupled, l2, r2)
	}

	// 3. Normal ARKit bilateral blink (blinkL=0.50, blinkR=0.62, both >= 0.40) -> coupled toward closed eye
	l3, r3 := StabilizeBlink(0.50, 0.62, 0.0, false, 25.0)
	expectedClosing := 0.50*0.05 + 0.62*0.95 // 0.614
	if math.Abs(l3-expectedClosing) > 1e-6 || math.Abs(r3-expectedClosing) > 1e-6 {
		t.Errorf("Expected bilateral closing eyes to couple to %v, got L=%v R=%v", expectedClosing, l3, r3)
	}
}

func TestEngine_HeadTurnSuppressesFalseWink(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	eng := NewEngine(cfgMgr)

	// Step 1: User turns head right (+30 deg > default 25 deg cutoff) for >100ms (past 50ms syncDelay).
	// MediaPipe reports false closure on occluded Left eye (0.85) while Right eye is open (0.05).
	_ = eng.Process(FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Yaw:       30.0,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	})
	out := eng.Process(FaceFrame{
		Timestamp: 1100,
		Present:   true,
		Yaw:       30.0,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	})
	if out.IsBlinkL || out.IsBlinkR {
		t.Errorf("Expected false wink to be suppressed during +30° head turn, got IsBlinkL=%v IsBlinkR=%v", out.IsBlinkL, out.IsBlinkR)
	}
	if !out.StabilizeBlink || out.BlinkMaxHeadYaw != 25.0 {
		t.Errorf("Expected ParamFrame to expose StabilizeBlink=true and BlinkMaxHeadYaw=25.0, got %v / %v", out.StabilizeBlink, out.BlinkMaxHeadYaw)
	}

	// Step 2: Disable StabilizeBlink -> same head turn now allows unilateral wink through after syncDelay
	s := cfgMgr.Get()
	s.Tracking.StabilizeBlink = false
	_ = cfgMgr.Update(s)

	_ = eng.Process(FaceFrame{
		Timestamp: 1200,
		Present:   true,
		Yaw:       30.0,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	})
	outDisabled := eng.Process(FaceFrame{
		Timestamp: 1300,
		Present:   true,
		Yaw:       30.0,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.85,
			"eyeBlinkRight": 0.05,
		},
	})
	if !outDisabled.IsBlinkL || outDisabled.IsBlinkR {
		t.Errorf("Expected unilateral wink when StabilizeBlink=false, got IsBlinkL=%v IsBlinkR=%v", outDisabled.IsBlinkL, outDisabled.IsBlinkR)
	}
}

func TestEngine_GlassesBlinkRemapAndGlareAssist(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	// Simulate user with glasses:
	// Resting open eyes sit at 0.24 (L) and 0.20 (R).
	// Closed eyes reach only 0.44 (L, lens glare) and 0.52 (R).
	err = cfgMgr.SetCalibration(config.CalibrationProfile{
		Calibrated:   true,
		BlinkOpenL:   0.24,
		BlinkOpenR:   0.20,
		BlinkClosedL: 0.44,
		BlinkClosedR: 0.52,
		GlareAssist:  true,
		SmileWeightL: 0.5,
		SmileWeightR: 0.5,
	})
	if err != nil {
		t.Fatalf("SetCalibration failed: %v", err)
	}

	eng := NewEngine(cfgMgr)

	// 1. Resting open eyes behind glasses (raw L=0.25, R=0.21) -> should remap near 0 and NOT blink
	outOpen := eng.Process(FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.25,
			"eyeBlinkRight": 0.21,
		},
	})
	if outOpen.IsBlinkL || outOpen.IsBlinkR || outOpen.BlinkL > 0.15 || outOpen.BlinkR > 0.15 {
		t.Errorf("Expected resting glasses eyes to remain open, got BlinkL=%v BlinkR=%v IsBlinkL=%v IsBlinkR=%v",
			outOpen.BlinkL, outOpen.BlinkR, outOpen.IsBlinkL, outOpen.IsBlinkR)
	}

	// 2. Bilateral blink where left lens has heavy glare (raw L=0.29 -> remapped 0.25, raw R=0.48 -> remapped 0.875).
	// GlareAssist couples the glare-weakened left eye with the clearer right eye!
	outBlink := eng.Process(FaceFrame{
		Timestamp: 1100,
		Present:   true,
		Blendshapes: map[string]float64{
			"eyeBlinkLeft":  0.29,
			"eyeBlinkRight": 0.48,
		},
	})
	if !outBlink.IsBlinkL || !outBlink.IsBlinkR {
		t.Errorf("Expected GlareAssist to trigger clean bilateral blink, got IsBlinkL=%v IsBlinkR=%v (BlinkL=%v, BlinkR=%v)",
			outBlink.IsBlinkL, outBlink.IsBlinkR, outBlink.BlinkL, outBlink.BlinkR)
	}
}

func TestFuseBlinkScore_EARRescueOnLensGlare(t *testing.T) {
	// Blendshape is washed out by lens reflection (0.18), but 3D landmark EAR closure is 0.80
	fused := FuseBlinkScore(0.18, 0.80, true)
	if fused < 0.70 {
		t.Errorf("Expected 3D landmark EAR closure (0.80) to rescue glare-suppressed blendshape (0.18), got %v", fused)
	}
}

func TestEngine_WinkHoldResistsGlareFlutter(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to init config manager: %v", err)
	}

	eng := NewEngine(cfgMgr)

	// Confirm Left wink across syncDelay (50ms)
	_ = eng.Process(FaceFrame{
		Timestamp:   1000,
		Present:     true,
		Blendshapes: map[string]float64{"eyeBlinkLeft": 0.75, "eyeBlinkRight": 0.12},
	})
	outConfirmed := eng.Process(FaceFrame{
		Timestamp:   1060,
		Present:     true,
		Blendshapes: map[string]float64{"eyeBlinkLeft": 0.75, "eyeBlinkRight": 0.12},
	})
	if !outConfirmed.IsBlinkL || outConfirmed.IsBlinkR {
		t.Fatalf("Expected confirmed Left wink at t=1060, got L=%v R=%v", outConfirmed.IsBlinkL, outConfirmed.IsBlinkR)
	}

	// Simulate a transient 1-frame lens reflection dip to 0.22 (16ms later at t=1076) followed by recovery to 0.70 at t=1092
	outDip := eng.Process(FaceFrame{
		Timestamp:   1076,
		Present:     true,
		Blendshapes: map[string]float64{"eyeBlinkLeft": 0.22, "eyeBlinkRight": 0.12},
	})
	if !outDip.IsBlinkL || outDip.IsBlinkR {
		t.Errorf("Expected Left wink to hold steady across 1-frame glare dip, got L=%v R=%v", outDip.IsBlinkL, outDip.IsBlinkR)
	}

	outRecovered := eng.Process(FaceFrame{
		Timestamp:   1092,
		Present:     true,
		Blendshapes: map[string]float64{"eyeBlinkLeft": 0.70, "eyeBlinkRight": 0.12},
	})
	if !outRecovered.IsBlinkL || outRecovered.IsBlinkR {
		t.Errorf("Expected Left wink to stay closed after glare dip without restarting syncDelay, got L=%v R=%v", outRecovered.IsBlinkL, outRecovered.IsBlinkR)
	}
}




