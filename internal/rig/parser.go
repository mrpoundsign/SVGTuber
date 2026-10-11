package rig

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var directiveRegex = regexp.MustCompile(`([A-Za-z]+)\s*\{([^}]+)\}`)

// ParseDirectives extracts all Directive structures from an Inkscape label string.
// Supported syntax matches IAMS conventions, e.g.:
// "Head [Follow {yaw: 15; pitch: 10; pivot: center}]"
// "Eyes Open [Hide {when: blinkL > 0.4}]"
func ParseDirectives(label string) []Directive {
	matches := directiveRegex.FindAllStringSubmatch(label, -1)
	if len(matches) == 0 {
		return nil
	}

	directives := make([]Directive, 0, len(matches))
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		rawType := strings.TrimSpace(match[1])
		rawBody := match[2]

		params := make(map[string]string)
		pairs := strings.SplitSeq(rawBody, ";")
		for pair := range pairs {
			pair = strings.TrimSpace(pair)
			if pair == "" {
				continue
			}
			parts := strings.SplitN(pair, ":", 2)
			if len(parts) == 2 {
				key := strings.ToLower(strings.TrimSpace(parts[0]))
				val := strings.TrimSpace(parts[1])
				params[key] = val
			} else if len(parts) == 1 {
				// Bare flag or shorthand
				key := strings.ToLower(strings.TrimSpace(parts[0]))
				params[key] = "true"
			}
		}

		directives = append(directives, Directive{
			Type:   normalizeDirectiveType(rawType),
			Params: params,
		})
	}

	return directives
}

func normalizeDirectiveType(t string) string {
	lower := strings.ToLower(t)
	switch lower {
	case "follow":
		return "Follow"
	case "dist", "distance", "parallax":
		return "Dist"
	case "show":
		return "Show"
	case "hide":
		return "Hide"
	case "move":
		return "Move"
	case "scale":
		return "Scale"
	case "idle", "breathe":
		return "Idle"
	case "rotate":
		return "Rotate"
	case "fade", "opacity":
		return "Fade"
	case "bounce":
		return "Bounce"
	case "physics", "spring":
		return "Physics"
	case "sway":
		return "Sway"
	case "chain":
		return "Chain"
	default:
		// Capitalize first letter as fallback
		if len(t) > 0 {
			return strings.ToUpper(t[:1]) + strings.ToLower(t[1:])
		}
		return t
	}
}

// Parser defines the interface for parsing SVG data into a RigDefinition.
type Parser interface {
	Parse(svgData []byte) (*RigDefinition, error)
}

// SVGParser implements Parser using a pipeline of pluggable attribute extractors.
type SVGParser struct {
	extractors []Extractor
}

// NewSVGParser constructs an SVGParser with the given extractors. If none are provided, DefaultExtractors() is used.
func NewSVGParser(extractors ...Extractor) *SVGParser {
	if len(extractors) == 0 {
		extractors = DefaultExtractors()
	}
	return &SVGParser{
		extractors: extractors,
	}
}

// DefaultParser is the standard pre-configured SVGParser instance.
var DefaultParser = NewSVGParser()

// Parse scans an SVG XML stream using the configured extractor pipeline.
func (p *SVGParser) Parse(svgData []byte) (*RigDefinition, error) {
	decoder := xml.NewDecoder(bytes.NewReader(svgData))

	var elements []RigElement

	for {
		token, err := decoder.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}

		startElem, ok := token.(xml.StartElement)
		if !ok {
			continue
		}

		var id string
		var transform string
		for _, attr := range startElem.Attr {
			switch attr.Name.Local {
			case "id":
				id = attr.Value
			case "transform":
				transform = attr.Value
			}
		}

		// Phase 1: Query extractors for any label containing rigging directives [ ... ]
		var label string
		for _, ext := range p.extractors {
			if candidate, ok := ext.Extract(startElem.Attr); ok && candidate != "" {
				if strings.Contains(candidate, "[") && strings.Contains(candidate, "]") {
					label = candidate
					break
				}
			}
		}

		// Phase 2: Fallback to the first non-empty label returned by an extractor
		if label == "" {
			for _, ext := range p.extractors {
				if candidate, ok := ext.Extract(startElem.Attr); ok && candidate != "" {
					label = candidate
					break
				}
			}
		}

		if label != "" {
			directives := ParseDirectives(label)
			if len(directives) > 0 {
				if id == "" {
					id = fmt.Sprintf("rig_elem_%d", len(elements))
				}
				elements = append(elements, RigElement{
					ID:         id,
					Label:      label,
					Transform:  transform,
					Directives: directives,
				})
			}
		}
	}

	return &RigDefinition{
		Version:  "1.0",
		Elements: elements,
	}, nil
}

// ParseSVG parses an SVG XML stream using DefaultParser.
func ParseSVG(svgData []byte) (*RigDefinition, error) {
	return DefaultParser.Parse(svgData)
}
