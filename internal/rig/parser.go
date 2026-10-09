package rig

import (
	"bytes"
	"encoding/xml"
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
		pairs := strings.Split(rawBody, ";")
		for _, pair := range pairs {
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
	default:
		// Capitalize first letter as fallback
		if len(t) > 0 {
			return strings.ToUpper(t[:1]) + strings.ToLower(t[1:])
		}
		return t
	}
}

// ParseSVG scans an SVG XML stream for elements with IDs and Inkscape rigging directives.
func ParseSVG(svgData []byte) (*RigDefinition, error) {
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

		var id, label string
		for _, attr := range startElem.Attr {
			switch attr.Name.Local {
			case "id":
				id = attr.Value
			case "label":
				// Matches both inkscape:label and standard label
				label = attr.Value
			}
		}

		if id != "" && label != "" {
			directives := ParseDirectives(label)
			if len(directives) > 0 {
				elements = append(elements, RigElement{
					ID:         id,
					Label:      label,
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
