package tracking

import (
	"math"
)

const twoPi = 2.0 * math.Pi

// LowPassFilter implements a first-order exponential smoothing filter.
type LowPassFilter struct {
	hatX        float64
	initialized bool
}

func (l *LowPassFilter) Filter(x, alpha float64) float64 {
	if !l.initialized {
		l.hatX = x
		l.initialized = true
		return x
	}
	l.hatX = alpha*x + (1.0-alpha)*l.hatX
	return l.hatX
}

func (l *LowPassFilter) Last() float64 {
	return l.hatX
}

func (l *LowPassFilter) Reset() {
	l.initialized = false
	l.hatX = 0
}

// OneEuroFilter implements the 1€ filter algorithm (Casiez et al., CHI 2012).
// It reduces jitter at low speeds while maintaining near-zero lag during rapid motions.
type OneEuroFilter struct {
	minCutoff float64 // Minimum cutoff frequency in Hz (jitter reduction at rest)
	beta      float64 // Speed coefficient (lag reduction during motion)
	dCutoff   float64 // Cutoff frequency for derivative in Hz
	xFilter   LowPassFilter
	dxFilter  LowPassFilter
	lastTime  float64
}

// NewOneEuroFilter constructs a OneEuroFilter with specified parameters.
func NewOneEuroFilter(minCutoff, beta, dCutoff float64) *OneEuroFilter {
	return &OneEuroFilter{
		minCutoff: minCutoff,
		beta:      beta,
		dCutoff:   dCutoff,
	}
}

// DefaultOneEuroFilter creates a filter tuned for head pose and facial landmarks.
func DefaultOneEuroFilter() *OneEuroFilter {
	return NewOneEuroFilter(1.0, 0.007, 1.0)
}

func alpha(rate, cutoff float64) float64 {
	tau := 1.0 / (twoPi * cutoff)
	te := 1.0 / rate
	return 1.0 / (1.0 + tau/te)
}

// Filter updates the filter with a new observation x at timestamp t (in seconds or ms).
func (f *OneEuroFilter) Filter(x, timestamp float64) float64 {
	if f.lastTime == 0 || timestamp <= f.lastTime {
		f.lastTime = timestamp
		return f.xFilter.Filter(x, 1.0)
	}

	dt := timestamp - f.lastTime
	f.lastTime = timestamp
	if dt <= 0 {
		return f.xFilter.Last()
	}

	rate := 1.0 / dt

	// Estimate derivative (speed)
	var dx float64
	if f.xFilter.initialized {
		dx = (x - f.xFilter.Last()) * rate
	}
	edx := f.dxFilter.Filter(dx, alpha(rate, f.dCutoff))

	// Adaptive cutoff frequency based on speed
	cutoff := f.minCutoff + f.beta*math.Abs(edx)

	return f.xFilter.Filter(x, alpha(rate, cutoff))
}

// Reset clears the filter state.
func (f *OneEuroFilter) Reset() {
	f.lastTime = 0
	f.xFilter.Reset()
	f.dxFilter.Reset()
}

// PoseFilter maintains a bank of 1€ filters for full facial pose and expression parameters.
type PoseFilter struct {
	yaw       *OneEuroFilter
	pitch     *OneEuroFilter
	roll      *OneEuroFilter
	x         *OneEuroFilter
	y         *OneEuroFilter
	z         *OneEuroFilter
	eyeX      *OneEuroFilter
	eyeY      *OneEuroFilter
	blinkL    *OneEuroFilter
	blinkR    *OneEuroFilter
	mouthOpen *OneEuroFilter
	smile     *OneEuroFilter
	browUp    *OneEuroFilter
}

// NewPoseFilter initializes a full set of filters tuned for avatar animation.
func NewPoseFilter() *PoseFilter {
	return &PoseFilter{
		yaw:       NewOneEuroFilter(1.0, 0.005, 1.0),
		pitch:     NewOneEuroFilter(1.0, 0.005, 1.0),
		roll:      NewOneEuroFilter(1.0, 0.005, 1.0),
		x:         NewOneEuroFilter(1.0, 0.005, 1.0),
		y:         NewOneEuroFilter(1.0, 0.005, 1.0),
		z:         NewOneEuroFilter(1.0, 0.005, 1.0),
		eyeX:      NewOneEuroFilter(1.2, 0.01, 1.0),
		eyeY:      NewOneEuroFilter(1.2, 0.01, 1.0),
		blinkL:    NewOneEuroFilter(1.5, 0.02, 1.0), // Snappier for blinks
		blinkR:    NewOneEuroFilter(1.5, 0.02, 1.0),
		mouthOpen: NewOneEuroFilter(1.2, 0.01, 1.0),
		smile:     NewOneEuroFilter(1.0, 0.007, 1.0),
		browUp:    NewOneEuroFilter(1.0, 0.007, 1.0),
	}
}

// Reset clears all filters in the bank.
func (pf *PoseFilter) Reset() {
	pf.yaw.Reset()
	pf.pitch.Reset()
	pf.roll.Reset()
	pf.x.Reset()
	pf.y.Reset()
	pf.z.Reset()
	pf.eyeX.Reset()
	pf.eyeY.Reset()
	pf.blinkL.Reset()
	pf.blinkR.Reset()
	pf.mouthOpen.Reset()
	pf.smile.Reset()
	pf.browUp.Reset()
}
