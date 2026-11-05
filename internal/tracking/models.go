package tracking

// AudioPayload represents microphone audio level, vowel visemes, voice pitch, and speech state from the Studio.
type AudioPayload struct {
	Active     bool    `json:"active"`               // true if microphone is active/running
	Volume     float64 `json:"volume"`               // normalized RMS volume [0.0, 1.0]
	IsSpeaking bool    `json:"isSpeaking"`           // noise-gated speech trigger
	Pitch      float64 `json:"pitch,omitempty"`      // normalized voice pitch [0.0, 1.0] (0.5 = calibrated neutral voice)
	PitchHz    float64 `json:"pitchHz,omitempty"`    // fundamental voice pitch in Hz
	Viseme     string  `json:"viseme,omitempty"`     // dominant vowel viseme ("sil", "A", "I", "U", "E", "O")
	VisemeA    float64 `json:"visemeA,omitempty"`    // open vowel 'A' weight [0.0, 1.0]
	VisemeI    float64 `json:"visemeI,omitempty"`    // front vowel 'I' weight [0.0, 1.0]
	VisemeU    float64 `json:"visemeU,omitempty"`    // close-back vowel 'U' weight [0.0, 1.0]
	VisemeE    float64 `json:"visemeE,omitempty"`    // mid-front vowel 'E' weight [0.0, 1.0]
	VisemeO    float64 `json:"visemeO,omitempty"`    // mid-back vowel 'O' weight [0.0, 1.0]
	IsShouting bool    `json:"isShouting,omitempty"` // high-energy vocal peak trigger
	IsLaughing bool    `json:"isLaughing,omitempty"` // rhythmic staccato laugh trigger
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
	Type             string             `json:"type"` // always "param_frame"
	T                float64            `json:"t"`    // timestamp in ms
	Present          bool               `json:"present"`
	HeadYaw          float64            `json:"headYaw"`     // calibrated degrees
	HeadPitch        float64            `json:"headPitch"`   // calibrated degrees
	HeadRoll         float64            `json:"headRoll"`    // calibrated degrees
	HeadX            float64            `json:"headX"`       // calibrated translation
	HeadY            float64            `json:"headY"`       // calibrated translation
	HeadZ            float64            `json:"headZ"`       // calibrated depth
	EyeX             float64            `json:"eyeX"`        // -1.0 (left) to 1.0 (right)
	EyeY             float64            `json:"eyeY"`        // -1.0 (up) to 1.0 (down)
	BlinkL           float64            `json:"blinkL"`      // 0.0 (open) to 1.0 (closed)
	BlinkR           float64            `json:"blinkR"`      // 0.0 (open) to 1.0 (closed)
	MouthOpen        float64            `json:"mouthOpen"`   // 0.0 to 1.0
	Smile            float64            `json:"smile"`       // 0.0 to 1.0
	BrowUp           float64            `json:"browUp"`      // 0.0 to 1.0
	BrowL            float64            `json:"browL"`       // -1.0 (furrowed) to 1.0 (raised)
	BrowR            float64            `json:"browR"`       // -1.0 (furrowed) to 1.0 (raised)
	CheekPuff        float64            `json:"cheekPuff"`   // 0.0 to 1.0
	MouthPucker      float64            `json:"mouthPucker"` // 0.0 to 1.0
	TongueOut        float64            `json:"tongueOut"`   // 0.0 to 1.0
	Frown            float64            `json:"frown"`       // 0.0 to 1.0
	JawX             float64            `json:"jawX"`        // -1.0 (left) to 1.0 (right)
	NoseSneer        float64            `json:"noseSneer"`   // 0.0 to 1.0
	EyeSquintL       float64            `json:"eyeSquintL"`  // 0.0 to 1.0
	EyeSquintR       float64            `json:"eyeSquintR"`  // 0.0 to 1.0
	EyeSquint        float64            `json:"eyeSquint"`   // 0.0 to 1.0
	MouthThreshold   float64            `json:"mouthThreshold"`
	BlinkThreshold   float64            `json:"blinkThreshold"`
	BlinkThresholdL  float64            `json:"blinkThresholdL"`
	BlinkThresholdR  float64            `json:"blinkThresholdR"`
	BlinkSyncDelayMs float64            `json:"blinkSyncDelayMs"`
	WinkIsBlink      bool               `json:"winkIsBlink,omitempty"`
	StabilizeBlink   bool               `json:"stabilizeBlink"`
	BlinkMaxHeadYaw  float64            `json:"blinkMaxHeadYaw"`
	SmileThreshold   float64            `json:"smileThreshold"`
	FrownThreshold   float64            `json:"frownThreshold"`
	AudioVolume      float64            `json:"audioVolume,omitempty"`
	AudioPitch       float64            `json:"audioPitch,omitempty"`
	Viseme           string             `json:"viseme,omitempty"`
	VisemeA          float64            `json:"visemeA,omitempty"`
	VisemeI          float64            `json:"visemeI,omitempty"`
	VisemeU          float64            `json:"visemeU,omitempty"`
	VisemeE          float64            `json:"visemeE,omitempty"`
	VisemeO          float64            `json:"visemeO,omitempty"`
	BounceAmount     float64            `json:"bounceAmount"`
	PhysicsEnabled         bool               `json:"physicsEnabled"`
	PhysicsAmount          float64            `json:"physicsAmount"`
	DepthZoomAmount        float64            `json:"depthZoomAmount"`
	PerspectiveSkewEnabled bool               `json:"perspectiveSkewEnabled"`
	PerspectiveSkewAmount  float64            `json:"perspectiveSkewAmount"`
	IsSpeaking             bool               `json:"isSpeaking,omitempty"`
	IsShouting       bool               `json:"isShouting,omitempty"`
	IsLaughing       bool               `json:"isLaughing,omitempty"`
	IsBlinkL         bool               `json:"isBlinkL"`
	IsBlinkR         bool               `json:"isBlinkR"`
	AutoBlink        bool               `json:"autoBlink,omitempty"`
	IsMouthOpen      bool               `json:"isMouthOpen"`
	IsSmiling        bool               `json:"isSmiling"`
	IsCheekPuff      bool               `json:"isCheekPuff,omitempty"`
	IsMouthPucker    bool               `json:"isMouthPucker,omitempty"`
	IsTongueOut      bool               `json:"isTongueOut,omitempty"`
	IsFrowning       bool               `json:"isFrowning,omitempty"`
	IsSneering       bool               `json:"isSneering,omitempty"`
	Expressions      map[string]bool    `json:"expressions,omitempty"`
	Raw              map[string]float64 `json:"raw,omitempty"`
}
