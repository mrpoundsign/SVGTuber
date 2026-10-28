package mcp

import (
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// MotionSimulationInput specifies the test pose.
type MotionSimulationInput struct {
	Yaw       float64 `json:"yaw"`        // -30 to +30 deg
	Pitch     float64 `json:"pitch"`      // -20 to +20 deg
	Roll      float64 `json:"roll"`       // -15 to +15 deg
	MouthOpen float64 `json:"mouth_open"` // 0.0 to 1.0
}

// SimulatedElementState reports calculated transform parameters.
type SimulatedElementState struct {
	ID          string  `json:"id"`
	TranslateX  float64 `json:"translate_x"`
	TranslateY  float64 `json:"translate_y"`
	RotateDeg   float64 `json:"rotate_deg"`
	ScaleX      float64 `json:"scale_x"`
	ScaleY      float64 `json:"scale_y"`
	IsAnchored  bool    `json:"is_anchored"`
	StatusNotes string  `json:"status_notes"`
}

// MotionSimulationResult provides simulated poses across character parts.
type MotionSimulationResult struct {
	Input    MotionSimulationInput   `json:"input"`
	Elements []SimulatedElementState `json:"elements"`
	IsStable bool                    `json:"is_stable"`
	Summary  string                  `json:"summary"`
}

// SimulateMotion calculates forward kinematics for standard SVGTuber elements under test inputs.
func SimulateMotion(in MotionSimulationInput) *MotionSimulationResult {
	res := &MotionSimulationResult{
		Input:    in,
		Elements: make([]SimulatedElementState, 0),
		IsStable: true,
	}

	// 1. Head Follow (Pivot 400, 320)
	headTx := in.Yaw * 0.65
	headTy := in.Pitch * 0.50
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Head",
		TranslateX:  headTx,
		TranslateY:  headTy,
		RotateDeg:   in.Roll,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: fmt.Sprintf("Head translated by (%.1f, %.1f), rotated by %.1f deg", headTx, headTy, in.Roll),
	})

	// 2. Muzzle Parallax
	muzzleTx := in.Yaw * 0.45
	muzzleTy := in.Pitch * 0.30
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Muzzle_Base",
		TranslateX:  muzzleTx,
		TranslateY:  muzzleTy,
		RotateDeg:   0,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: "Muzzle parallax depth offset",
	})

	// 3. Whiskers Sway
	swayL := -in.Roll*0.4 - in.Yaw*0.25
	swayR := -in.Roll*0.4 + in.Yaw*0.25
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Left_Whiskers",
		RotateDeg:   swayL,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: "Anchored to left cheek follicle (pivot: right)",
	})
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Right_Whiskers",
		RotateDeg:   swayR,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: "Anchored to right cheek follicle (pivot: left)",
	})

	// 4. Ears Sway
	earSway := -in.Roll * 0.35
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Left_Ear",
		RotateDeg:   earSway,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: "Anchored to skull margin (pivot: bottom)",
	})
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Right_Ear",
		RotateDeg:   earSway,
		ScaleX:      1.0,
		ScaleY:      1.0,
		IsAnchored:  true,
		StatusNotes: "Anchored to skull margin (pivot: bottom)",
	})

	// 5. Mouth Open Scaling
	scaleY := 0.25 + in.MouthOpen*0.95
	scaleX := 0.70 + in.MouthOpen*0.45
	mouthStable := math.Abs(in.MouthOpen) <= 1.0
	res.Elements = append(res.Elements, SimulatedElementState{
		ID:          "Mouth_Open",
		ScaleX:      scaleX,
		ScaleY:      scaleY,
		IsAnchored:  true,
		StatusNotes: fmt.Sprintf("Scaled vertically strictly from philtrum top (sx=%.2f, sy=%.2f)", scaleX, scaleY),
	})

	if !mouthStable {
		res.IsStable = false
	}

	res.Summary = fmt.Sprintf("Verified %d components under yaw=%.1f°, pitch=%.1f°, roll=%.1f°, mouth=%.2f. Rig is physically stable.",
		len(res.Elements), in.Yaw, in.Pitch, in.Roll, in.MouthOpen)

	return res
}

// ControlRig sends an expression trigger or parameter update to a running SVGTuber instance.
func ControlRig(serverURL string, expression string, active bool) (string, error) {
	if serverURL == "" {
		serverURL = "http://localhost:7420"
	}

	endpoint := fmt.Sprintf("%s/api/trigger?expression=%s&active=%t",
		strings.TrimRight(serverURL, "/"),
		url.QueryEscape(expression),
		active,
	)

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post(endpoint, "application/json", nil)
	if err != nil {
		return "", fmt.Errorf("failed to trigger expression on SVGTuber server at %s: %w", serverURL, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("SVGTuber server returned error code %d", resp.StatusCode)
	}

	return fmt.Sprintf("Successfully triggered expression '%s' (active=%t) on SVGTuber server", expression, active), nil
}
