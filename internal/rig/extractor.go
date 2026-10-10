package rig

import (
	"encoding/xml"
	"strings"
)

// Extractor defines a strategy for extracting candidate label or directive strings from SVG XML attributes.
type Extractor interface {
	Name() string
	Extract(attrs []xml.Attr) (label string, ok bool)
}

// InkscapeExtractor extracts Inkscape layer labels (inkscape:label or label).
type InkscapeExtractor struct{}

func (e InkscapeExtractor) Name() string { return "inkscape" }

func (e InkscapeExtractor) Extract(attrs []xml.Attr) (string, bool) {
	for _, attr := range attrs {
		if attr.Name.Local == "label" && attr.Value != "" {
			return attr.Value, true
		}
	}
	return "", false
}

// DataNameExtractor extracts data-name attributes (Vectorcraft, Adobe Illustrator).
type DataNameExtractor struct{}

func (e DataNameExtractor) Name() string { return "data-name" }

func (e DataNameExtractor) Extract(attrs []xml.Attr) (string, bool) {
	for _, attr := range attrs {
		if attr.Name.Local == "data-name" && attr.Value != "" {
			return attr.Value, true
		}
	}
	return "", false
}

// AriaLabelExtractor extracts accessibility aria-label attributes.
type AriaLabelExtractor struct{}

func (e AriaLabelExtractor) Name() string { return "aria-label" }

func (e AriaLabelExtractor) Extract(attrs []xml.Attr) (string, bool) {
	for _, attr := range attrs {
		if attr.Name.Local == "aria-label" && attr.Value != "" {
			return attr.Value, true
		}
	}
	return "", false
}

// IDExtractor extracts directives directly from the XML id attribute if formatted with directives.
type IDExtractor struct{}

func (e IDExtractor) Name() string { return "id" }

func (e IDExtractor) Extract(attrs []xml.Attr) (string, bool) {
	for _, attr := range attrs {
		if attr.Name.Local == "id" && strings.Contains(attr.Value, "[") && strings.Contains(attr.Value, "]") {
			return attr.Value, true
		}
	}
	return "", false
}

// DefaultExtractors returns the standard pipeline of attribute extractors.
func DefaultExtractors() []Extractor {
	return []Extractor{
		InkscapeExtractor{},
		DataNameExtractor{},
		AriaLabelExtractor{},
		IDExtractor{},
	}
}
