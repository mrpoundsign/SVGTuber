package server

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

// TestIntegration_BothAvatarSources_AsCurrentlySaved tests that loading both
// test_avatar.svg (Inkscape) and test_avatar_vectorcraft.svg (Vectorcraft),
// AS THEY CURRENTLY ARE on disk, load cleanly without errors, serve valid
// SVGs that parse without XML errors, and produce equivalent rig structures.
func TestIntegration_BothAvatarSources_AsCurrentlySaved(t *testing.T) {
	inkscapePath, err := filepath.Abs("../../testdata/test_avatar.svg")
	if err != nil {
		t.Fatalf("Resolving test_avatar.svg: %v", err)
	}
	vectorcraftPath, err := filepath.Abs("../../testdata/test_avatar_vectorcraft.svg")
	if err != nil {
		t.Fatalf("Resolving test_avatar_vectorcraft.svg: %v", err)
	}

	// 1. Initialize server for Inkscape avatar
	srvInkscape := New(0, inkscapePath, NewHub(), tracking.NewEngine())

	// Test /avatar.svg for Inkscape
	recInkSVG := httptest.NewRecorder()
	srvInkscape.handleAvatarSVG(recInkSVG, httptest.NewRequest(http.MethodGet, "/avatar.svg", nil))
	if recInkSVG.Code != http.StatusOK {
		t.Fatalf("Inkscape avatar failed to serve: status %d", recInkSVG.Code)
	}
	inkSVGBytes := recInkSVG.Body.Bytes()

	// Verify Inkscape SVG is well-formed XML with root tag <svg> (no parsererror)
	var inkDoc struct {
		XMLName xml.Name `xml:"svg"`
	}
	if err := xml.Unmarshal(inkSVGBytes, &inkDoc); err != nil {
		t.Fatalf("Inkscape preprocessed SVG is not valid XML: %v\nOutput snippet: %s",
			err, string(inkSVGBytes[:min(len(inkSVGBytes), 300)]))
	}
	if inkDoc.XMLName.Local != "svg" {
		t.Errorf("Expected root element 'svg', got '%s'", inkDoc.XMLName.Local)
	}

	// Test /rig.json for Inkscape
	recInkRig := httptest.NewRecorder()
	srvInkscape.handleRigJSON(recInkRig, httptest.NewRequest(http.MethodGet, "/rig.json", nil))
	if recInkRig.Code != http.StatusOK {
		t.Fatalf("Inkscape rig failed to serve: status %d", recInkRig.Code)
	}
	var rigInkscape rig.RigDefinition
	if err := json.Unmarshal(recInkRig.Body.Bytes(), &rigInkscape); err != nil {
		t.Fatalf("Failed to parse Inkscape rig JSON: %v", err)
	}

	// 2. Initialize server for Vectorcraft avatar
	srvVectorcraft := New(0, vectorcraftPath, NewHub(), tracking.NewEngine())

	// Test /avatar.svg for Vectorcraft
	recVecSVG := httptest.NewRecorder()
	srvVectorcraft.handleAvatarSVG(recVecSVG, httptest.NewRequest(http.MethodGet, "/avatar.svg", nil))
	if recVecSVG.Code != http.StatusOK {
		t.Fatalf("Vectorcraft avatar failed to serve: status %d", recVecSVG.Code)
	}
	vecSVGBytes := recVecSVG.Body.Bytes()

	// Verify Vectorcraft SVG is well-formed XML with root tag <svg>
	var vecDoc struct {
		XMLName xml.Name `xml:"svg"`
	}
	if err := xml.Unmarshal(vecSVGBytes, &vecDoc); err != nil {
		t.Fatalf("Vectorcraft preprocessed SVG is not valid XML: %v\nOutput snippet: %s",
			err, string(vecSVGBytes[:min(len(vecSVGBytes), 300)]))
	}
	if vecDoc.XMLName.Local != "svg" {
		t.Errorf("Expected root element 'svg', got '%s'", vecDoc.XMLName.Local)
	}

	// Test /rig.json for Vectorcraft
	recVecRig := httptest.NewRecorder()
	srvVectorcraft.handleRigJSON(recVecRig, httptest.NewRequest(http.MethodGet, "/rig.json", nil))
	if recVecRig.Code != http.StatusOK {
		t.Fatalf("Vectorcraft rig failed to serve: status %d", recVecRig.Code)
	}
	var rigVectorcraft rig.RigDefinition
	if err := json.Unmarshal(recVecRig.Body.Bytes(), &rigVectorcraft); err != nil {
		t.Fatalf("Failed to parse Vectorcraft rig JSON: %v", err)
	}

	// 3. Verify element count matches (both have exactly 21 elements)
	t.Logf("Inkscape rigged elements: %d", len(rigInkscape.Elements))
	t.Logf("Vectorcraft rigged elements: %d", len(rigVectorcraft.Elements))

	if len(rigInkscape.Elements) != len(rigVectorcraft.Elements) {
		t.Errorf("Element count mismatch: Inkscape has %d, Vectorcraft has %d",
			len(rigInkscape.Elements), len(rigVectorcraft.Elements))
	}

	// 4. Verify expressions match across both avatars
	exprInk := ExtractExpressionsFromRig(&rigInkscape)
	exprVec := ExtractExpressionsFromRig(&rigVectorcraft)
	sort.Strings(exprInk)
	sort.Strings(exprVec)

	if !reflect.DeepEqual(exprInk, exprVec) {
		t.Errorf("Expressions mismatch: Inkscape=%v, Vectorcraft=%v", exprInk, exprVec)
	}
	t.Logf("Discovered expressions across both: %v", exprInk)

	// 5. Verify preprocessor stripped flipped matrices from rigged groups in both served SVGs
	if strings.Contains(string(inkSVGBytes), "matrix(-1") {
		t.Errorf("Expected preprocessor to bake matrix(-1,...) out of Inkscape avatar, but found it in served SVG")
	}
	if strings.Contains(string(vecSVGBytes), "matrix(-1") {
		t.Errorf("Expected preprocessor to bake matrix(-1,...) out of Vectorcraft avatar, but found it in served SVG")
	}

	// 6. Verify all core directives exist in both rigs
	expectedTypes := []string{"Idle", "Bounce", "Follow", "Dist", "Move", "Scale", "Hide", "Show", "Sway", "Chain"}
	checkDirectiveTypes := func(r rig.RigDefinition, source string) {
		found := make(map[string]bool)
		for _, el := range r.Elements {
			for _, d := range el.Directives {
				found[d.Type] = true
			}
		}
		for _, exp := range expectedTypes {
			if !found[exp] {
				t.Errorf("%s avatar missing expected directive type: %s", source, exp)
			}
		}
	}

	checkDirectiveTypes(rigInkscape, "Inkscape")
	checkDirectiveTypes(rigVectorcraft, "Vectorcraft")

	// 7. Verify directive counts and types match across both rigs
	countDirectives := func(r rig.RigDefinition) map[string]int {
		counts := make(map[string]int)
		for _, el := range r.Elements {
			for _, d := range el.Directives {
				counts[d.Type]++
			}
		}
		return counts
	}

	countsInk := countDirectives(rigInkscape)
	countsVec := countDirectives(rigVectorcraft)
	if !reflect.DeepEqual(countsInk, countsVec) {
		t.Errorf("Directive counts mismatch between Inkscape and Vectorcraft:\nInkscape:    %v\nVectorcraft: %v", countsInk, countsVec)
	} else {
		t.Logf("Directive counts match across all types: %v", countsInk)
	}

	// 8. Verify the complete inventory of directives and their parameters match identically
	collectDirectives := func(r rig.RigDefinition) []string {
		var list []string
		for _, el := range r.Elements {
			for _, d := range el.Directives {
				paramKeys := make([]string, 0, len(d.Params))
				for k := range d.Params {
					paramKeys = append(paramKeys, k)
				}
				sort.Strings(paramKeys)
				pStr := make([]string, 0, len(paramKeys))
				for _, k := range paramKeys {
					pStr = append(pStr, k+"="+d.Params[k])
				}
				list = append(list, d.Type+"("+strings.Join(pStr, ",")+")")
			}
		}
		sort.Strings(list)
		return list
	}

	dirsInk := collectDirectives(rigInkscape)
	dirsVec := collectDirectives(rigVectorcraft)
	if !reflect.DeepEqual(dirsInk, dirsVec) {
		t.Errorf("Directives mismatch between Inkscape and Vectorcraft:\nInkscape:    %v\nVectorcraft: %v", dirsInk, dirsVec)
	} else {
		t.Logf("All %d animation directives and their parameters match identically across both rigs.", len(dirsInk))
	}

	// 9. Verify that all 3/3 braid segments on both sides are transformed to their correct positions
	// Left braid (Side Braid 2 / 4): x ~ 130-138
	// Right braid (Side Braid 1): x ~ 374-382
	inkStr := string(inkSVGBytes)
	vecStr := string(vecSVGBytes)

	// In both preprocessed SVGs, verify transformed coordinates are present
	expectedLeftSegments := []string{"138.076", "135.076", "131.076", "117.076", "130.076"}
	expectedRightSegments := []string{"374", "377", "381", "379", "382"}

	for _, seg := range expectedLeftSegments {
		if !strings.Contains(inkStr, seg) {
			t.Errorf("Inkscape preprocessed SVG missing expected left braid coordinate %s (not transformed)", seg)
		}
		if !strings.Contains(vecStr, seg) {
			t.Errorf("Vectorcraft preprocessed SVG missing expected left braid coordinate %s", seg)
		}
	}

	for _, seg := range expectedRightSegments {
		if !strings.Contains(inkStr, seg) {
			t.Errorf("Inkscape preprocessed SVG missing expected right braid coordinate %s (not transformed)", seg)
		}
		if !strings.Contains(vecStr, seg) {
			t.Errorf("Vectorcraft preprocessed SVG missing expected right braid coordinate %s", seg)
		}
	}
}
