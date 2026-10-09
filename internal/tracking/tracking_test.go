package tracking

import (
	"math"
	"math/rand"
	"testing"
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
