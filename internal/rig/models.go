package rig

// Directive represents a single parsed animation directive on an SVG element.
type Directive struct {
	Type   string            `json:"type"`   // e.g. "Follow", "Dist", "Show", "Hide", "Move", "Scale", "Idle"
	Params map[string]string `json:"params"` // parsed key-value parameters
}

// RigElement represents an SVG element tagged with one or more rigging directives.
type RigElement struct {
	ID         string      `json:"id"`
	Label      string      `json:"label"`
	Transform  string      `json:"transform,omitempty"`
	Directives []Directive `json:"directives"`
}

// RigDefinition contains all rigged elements extracted from an SVG document.
type RigDefinition struct {
	Version  string       `json:"version"`
	Elements []RigElement `json:"elements"`
}
