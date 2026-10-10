package rig

import (
	"encoding/xml"
	"testing"
)

func TestExtractors(t *testing.T) {
	attrs := []xml.Attr{
		{Name: xml.Name{Local: "id"}, Value: "mouth_open"},
		{Name: xml.Name{Local: "label"}, Value: "Mouth Open [Show {when: isMouthOpen}]"},
		{Name: xml.Name{Local: "data-name"}, Value: "Alt Mouth [Show {when: isSmiling}]"},
		{Name: xml.Name{Local: "aria-label"}, Value: "Accessible Mouth"},
	}

	ink := InkscapeExtractor{}
	if val, ok := ink.Extract(attrs); !ok || val != "Mouth Open [Show {when: isMouthOpen}]" {
		t.Errorf("InkscapeExtractor failed: got %q, %v", val, ok)
	}

	dn := DataNameExtractor{}
	if val, ok := dn.Extract(attrs); !ok || val != "Alt Mouth [Show {when: isSmiling}]" {
		t.Errorf("DataNameExtractor failed: got %q, %v", val, ok)
	}

	aria := AriaLabelExtractor{}
	if val, ok := aria.Extract(attrs); !ok || val != "Accessible Mouth" {
		t.Errorf("AriaLabelExtractor failed: got %q, %v", val, ok)
	}

	idExt := IDExtractor{}
	idAttrs := []xml.Attr{
		{Name: xml.Name{Local: "id"}, Value: "head_[Follow_{yaw:_10}]"},
	}
	if val, ok := idExt.Extract(idAttrs); !ok || val != "head_[Follow_{yaw:_10}]" {
		t.Errorf("IDExtractor failed: got %q, %v", val, ok)
	}
}

func TestCustomExtractorDI(t *testing.T) {
	// Custom extractor mock
	customSVG := `<svg><g id="test" custom-tag="MyRig [Idle {breathe: 0.05}]"><circle/></g></svg>`

	customExtractor := customAttrExtractor{attrName: "custom-tag"}
	customParser := NewSVGParser(customExtractor)

	rigDef, err := customParser.Parse([]byte(customSVG))
	if err != nil {
		t.Fatalf("Failed to parse custom SVG: %v", err)
	}

	if len(rigDef.Elements) != 1 {
		t.Fatalf("Expected 1 element, got %d", len(rigDef.Elements))
	}
	if rigDef.Elements[0].Directives[0].Type != "Idle" {
		t.Errorf("Expected Idle directive, got %s", rigDef.Elements[0].Directives[0].Type)
	}
}

type customAttrExtractor struct {
	attrName string
}

func (c customAttrExtractor) Name() string { return c.attrName }

func (c customAttrExtractor) Extract(attrs []xml.Attr) (string, bool) {
	for _, attr := range attrs {
		if attr.Name.Local == c.attrName && attr.Value != "" {
			return attr.Value, true
		}
	}
	return "", false
}
