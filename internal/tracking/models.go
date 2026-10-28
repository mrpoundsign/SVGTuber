package tracking

// AudioPayload represents microphone audio level and speech state from the Studio.
type AudioPayload struct {
	Active     bool    `json:"active"`     // true if microphone is active/running
	Volume     float64 `json:"volume"`     // normalized RMS volume [0.0, 1.0]
	IsSpeaking bool    `json:"isSpeaking"` // noise-gated speech trigger
}

// FaceFrame represents raw tracking data received from the Studio webcam tracker.
type FaceFrame struct {
	Timestamp   float64            `json:"timestamp"`
	Present     bool               `json:"present"`
	Yaw         float64            `json:"yaw"`   // degrees
	Pitch       float64            `json:"pitch"` // degrees
	Roll        float64            `json:"roll"`  // degrees
	X           float64            `json:"x"`     // normalized translation [-1, 1]
	Y           float64            `json:"y"`     // normalized translation [-1, 1]
	Z           float64            `json:"z"`     // normalized depth
	Blendshapes map[string]float64 `json:"blendshapes"`
	Audio       *AudioPayload      `json:"audio,omitempty"`
}

// ParamFrame represents calibrated and filtered parameters broadcast to OBS overlays.
type ParamFrame struct {
	Type           string             `json:"type"` // always "param_frame"
	T              float64            `json:"t"`    // timestamp in ms
	Present        bool               `json:"present"`
	HeadYaw        float64            `json:"headYaw"`   // calibrated degrees
	HeadPitch      float64            `json:"headPitch"` // calibrated degrees
	HeadRoll       float64            `json:"headRoll"`  // calibrated degrees
	HeadX          float64            `json:"headX"`     // calibrated translation
	HeadY          float64            `json:"headY"`     // calibrated translation
	HeadZ          float64            `json:"headZ"`     // calibrated depth
	EyeX           float64            `json:"eyeX"`      // -1.0 (left) to 1.0 (right)
	EyeY           float64            `json:"eyeY"`      // -1.0 (up) to 1.0 (down)
	BlinkL         float64            `json:"blinkL"`    // 0.0 (open) to 1.0 (closed)
	BlinkR         float64            `json:"blinkR"`    // 0.0 (open) to 1.0 (closed)
	MouthOpen        float64            `json:"mouthOpen"` // 0.0 to 1.0
	Smile            float64            `json:"smile"`     // 0.0 to 1.0
	BrowUp           float64            `json:"browUp"`    // 0.0 to 1.0
	BrowL            float64            `json:"browL"`     // -1.0 (furrowed) to 1.0 (raised)
	BrowR            float64            `json:"browR"`     // -1.0 (furrowed) to 1.0 (raised)
	MouthThreshold   float64            `json:"mouthThreshold"`
	BlinkThreshold   float64            `json:"blinkThreshold"`
	BlinkThresholdL  float64            `json:"blinkThresholdL"`
	BlinkThresholdR  float64            `json:"blinkThresholdR"`
	BlinkSyncDelayMs float64            `json:"blinkSyncDelayMs"`
	WinkIsBlink      bool               `json:"winkIsBlink,omitempty"`
	SmileThreshold   float64            `json:"smileThreshold"`
	AudioVolume    float64            `json:"audioVolume,omitempty"`
	BounceAmount   float64            `json:"bounceAmount"`
	PhysicsEnabled bool               `json:"physicsEnabled"`
	PhysicsAmount  float64            `json:"physicsAmount"`
	IsSpeaking     bool               `json:"isSpeaking,omitempty"`
	IsBlinkL       bool               `json:"isBlinkL"`
	IsBlinkR       bool               `json:"isBlinkR"`
	AutoBlink      bool               `json:"autoBlink,omitempty"`
	IsMouthOpen    bool               `json:"isMouthOpen"`
	IsSmiling      bool               `json:"isSmiling"`
	Expressions    map[string]bool    `json:"expressions,omitempty"`
	Raw            map[string]float64 `json:"raw,omitempty"`
}
