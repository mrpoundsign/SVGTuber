package mcp

import (
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
)

// ValidationIssue represents a detected structural, rigging, or CSS issue in an SVG avatar.
type ValidationIssue struct {
	Severity    string `json:"severity"` // "ERROR", "WARNING", "INFO"
	ElementID   string `json:"element_id,omitempty"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Fix         string `json:"fix,omitempty"`
}

// RigValidationReport summarizes all checks performed on an avatar SVG file.
type RigValidationReport struct {
	FilePath       string            `json:"file_path"`
	IsValid        bool              `json:"is_valid"`
	TotalElements  int               `json:"total_elements"`
	RiggedElements int               `json:"rigged_elements"`
	Issues         []ValidationIssue `json:"issues"`
	Summary        string            `json:"summary"`
}

// ValidateSVGRig inspects an SVG avatar file on disk and verifies geometric and directive integrity.
func ValidateSVGRig(filePath string) (*RigValidationReport, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read svg file: %w", err)
	}

	report := &RigValidationReport{
		FilePath: filePath,
		IsValid:  true,
		Issues:   make([]ValidationIssue, 0),
	}

	svgContent := string(data)

	// 1. Check for dangerous CSS: transform-box: fill-box
	if strings.Contains(svgContent, "transform-box") && strings.Contains(svgContent, "fill-box") {
		report.Issues = append(report.Issues, ValidationIssue{
			Severity:    "ERROR",
			Title:       "Dangerous transform-box: fill-box detected",
			Description: "CSS contains 'transform-box: fill-box'. This overrides SVG viewBox user coordinates and causes scale/translate directives to multiply relative to local element bounds, rocketing elements (like mouth) diagonally across the screen and swinging whiskers off the face.",
			Fix:         "Remove 'transform-box: fill-box' and let the browser overlay use default SVG user coordinate space.",
		})
		report.IsValid = false
	}

	// 1b. Check for flat leaf Head hazard (where Head is a <path> sibling instead of a <g> parent container)
	if !strings.Contains(svgContent, `id="Head_Group"`) && leafShapeRegex.MatchString(svgContent) {
		for _, m := range leafShapeRegex.FindAllStringSubmatch(svgContent, -1) {
			if strings.EqualFold(m[3], "Head") {
				report.Issues = append(report.Issues, ValidationIssue{
					Severity:    "ERROR",
					ElementID:   "Head",
					Title:       "Flat Hierarchy Hazard: 'Head' is a leaf shape instead of a parent <g> group",
					Description: "Head is a self-closing leaf element while ears, eyes, muzzle, and mouth are flat siblings. Turning the head will move only the skull outline while facial features detach.",
					Fix:         "Run 'svgtuber_auto_rig' to automatically group head, ears, horns, eyes, muzzle, and mouth into a hierarchical <g> scene graph.",
				})
				report.IsValid = false
				break
			}
		}
	}

	// 2. Parse directives using internal/rig
	rigDef, err := rig.DefaultParser.Parse(data)
	if err != nil {
		report.Issues = append(report.Issues, ValidationIssue{
			Severity:    "ERROR",
			Title:       "Rig Extraction Error",
			Description: fmt.Sprintf("Failed to extract rig bindings: %v", err),
		})
		report.IsValid = false
		return report, nil
	}

	report.RiggedElements = len(rigDef.Elements)

	// 3. Inspect every rigged element for universal pivot and parameter safety
	var hasBlinkLeftOpen, hasBlinkRightOpen, hasBlinkLeftClosed, hasBlinkRightClosed bool
	var hasAnyBrow, hasBrowLeft, hasBrowRight bool
	for _, el := range rigDef.Elements {
		lowerID := strings.ToLower(el.ID)
		if strings.Contains(lowerID, "brow") {
			hasAnyBrow = true
		}
		for _, d := range el.Directives {
			dType := strings.ToLower(d.Type)
			if strings.Contains(lowerID, "brow") && (dType == "move" || dType == "rotate") {
				pStr := strings.ToLower(d.Params["y"] + " " + d.Params["x"] + " " + d.Params["param"] + " " + d.Params["target"] + " " + d.Params["source"])
				if strings.Contains(pStr, "browl") || strings.Contains(pStr, "browouterupleft") || (strings.Contains(lowerID, "left") && strings.Contains(pStr, "brow")) {
					hasBrowLeft = true
				}
				if strings.Contains(pStr, "browr") || strings.Contains(pStr, "browouterupright") || (strings.Contains(lowerID, "right") && strings.Contains(pStr, "brow")) {
					hasBrowRight = true
				}
			}

			// Check Sway / Rotate / Physics / Scale directives for missing pivot
			if dType == "sway" || dType == "rotate" || dType == "physics" || dType == "scale" {
				pivot, hasPivot := d.Params["pivot"]
				if !hasPivot || strings.TrimSpace(pivot) == "" {
					report.Issues = append(report.Issues, ValidationIssue{
						Severity:    "WARNING",
						ElementID:   el.ID,
						Title:       fmt.Sprintf("%s directive '%s' is missing a pivot anchor", el.ID, d.Type),
						Description: "Without an explicit 'pivot: ...', the element rotates/scales from the SVG origin (0,0), causing detachment during head motion.",
						Fix:         "Add 'pivot: bottom', 'pivot: top', 'pivot: left', 'pivot: right', or 'pivot: center' to the directive.",
					})
				}
			}

			// Check mouth vertical scaling pivot policy
			if strings.Contains(lowerID, "mouth") && dType == "scale" {
				if pivot, ok := d.Params["pivot"]; ok && strings.EqualFold(pivot, "bottom") {
					report.Issues = append(report.Issues, ValidationIssue{
						Severity:    "WARNING",
						ElementID:   el.ID,
						Title:       fmt.Sprintf("Mouth element '%s' should not pivot from bottom", el.ID),
						Description: "Mouth elements should pivot from the top philtrum margin ('pivot: top') so opening the mouth drops the jaw downward naturally instead of expanding upward into the nose.",
						Fix:         "Change 'pivot: bottom' to 'pivot: top' on mouth scale directive.",
					})
				}
			}

			// Check whisker pivot policy
			if strings.Contains(lowerID, "whisker") && dType == "sway" {
				pivot, ok := d.Params["pivot"]
				if strings.Contains(lowerID, "left") && (!ok || !strings.EqualFold(pivot, "right")) {
					report.Issues = append(report.Issues, ValidationIssue{
						Severity:    "WARNING",
						ElementID:   el.ID,
						Title:       fmt.Sprintf("Left whisker '%s' should anchor with 'pivot: right'", el.ID),
						Description: "Left whiskers attach to the face on their right margin; pivoting from left causes whisker tips to stay fixed while roots detach from the cheek.",
						Fix:         "Add 'pivot: right' to the Sway directive.",
					})
				} else if strings.Contains(lowerID, "right") && (!ok || !strings.EqualFold(pivot, "left")) {
					report.Issues = append(report.Issues, ValidationIssue{
						Severity:    "WARNING",
						ElementID:   el.ID,
						Title:       fmt.Sprintf("Right whisker '%s' should anchor with 'pivot: left'", el.ID),
						Description: "Right whiskers attach to the face on their left margin; pivoting from right causes whisker tips to stay fixed while roots detach from the cheek.",
						Fix:         "Add 'pivot: left' to the Sway directive.",
					})
				}
			}

			// Check condition syntax on Show / Hide and track independent L/R eye blink states
			if dType == "show" || dType == "hide" {
				when, ok := d.Params["when"]
				if !ok || strings.TrimSpace(when) == "" {
					report.Issues = append(report.Issues, ValidationIssue{
						Severity:    "ERROR",
						ElementID:   el.ID,
						Title:       fmt.Sprintf("Element '%s' has %s directive without 'when:' condition", el.ID, d.Type),
						Description: "Conditional visibility directives require a condition expression (e.g. 'when: blinkL > 0.4' or 'when: isMouthOpen').",
						Fix:         "Add 'when: ...' parameter to the directive.",
					})
				} else {
					wLower := strings.ToLower(when)
					isLeftBlink := strings.Contains(wLower, "blinkl") || strings.Contains(wLower, "isblinkl")
					isRightBlink := strings.Contains(wLower, "blinkr") || strings.Contains(wLower, "isblinkr")
					switch dType {
					case "hide":
						if isLeftBlink {
							hasBlinkLeftOpen = true
						}
						if isRightBlink {
							hasBlinkRightOpen = true
						}
					case "show":
						if isLeftBlink {
							hasBlinkLeftClosed = true
						}
						if isRightBlink {
							hasBlinkRightClosed = true
						}
					}
				}
			}
		}
	}

	// 3b. Ensure independent Left and Right eye blink states both exist
	if hasBlinkLeftOpen || hasBlinkRightOpen || hasBlinkLeftClosed || hasBlinkRightClosed {
		if !hasBlinkLeftOpen || !hasBlinkRightOpen {
			report.Issues = append(report.Issues, ValidationIssue{
				Severity:    "WARNING",
				ElementID:   "Eyes_Open",
				Title:       "Missing Independent Left/Right Open Eye Blink Bindings",
				Description: "Eyes should have independent Left ('blinkL' / 'isBlinkL') and Right ('blinkR' / 'isBlinkR') open groups so the avatar can wink each eye independently.",
				Fix:         "Split open eyes into 'Left_Eye_Open_Group [Hide {when: blinkL > 0.4}]' and 'Right_Eye_Open_Group [Hide {when: blinkR > 0.4}]'.",
			})
		}
		if !hasBlinkLeftClosed || !hasBlinkRightClosed {
			report.Issues = append(report.Issues, ValidationIssue{
				Severity:    "WARNING",
				ElementID:   "Eyes_Closed",
				Title:       "Missing Independent Left/Right Closed Eye Blink Bindings",
				Description: "Closed eyelids should have independent Left ('blinkL' / 'isBlinkL') and Right ('blinkR' / 'isBlinkR') groups so winking shows only the corresponding closed eyelid.",
				Fix:         "Split closed eyelids into 'Left_Eye_Closed_Group [Show {when: blinkL > 0.4}]' and 'Right_Eye_Closed_Group [Show {when: blinkR > 0.4}]'.",
			})
		}
	}

	// 3c. Ensure independent Left and Right eyebrow bindings both exist when brows are present
	if hasAnyBrow && (!hasBrowLeft || !hasBrowRight) {
		report.Issues = append(report.Issues, ValidationIssue{
			Severity:    "WARNING",
			ElementID:   "Brows",
			Title:       "Missing Independent Left/Right Eyebrow Bindings",
			Description: "Eyebrows should have independent Left ('browL') and Right ('browR') groups so each eyebrow can raise and furrow independently.",
			Fix:         "Split eyebrows into 'Brow_Left_Group [Move {y: browL; rangeY: -8}]' and 'Brow_Right_Group [Move {y: browR; rangeY: -8}]'.",
		})
	}

	// 4. Perform geometric & visual seam checks on leaf shapes
	validateGeometryAndVisualSeams(svgContent, report)

	errorCount := 0
	warningCount := 0
	for _, iss := range report.Issues {
		switch iss.Severity {
		case "ERROR":
			errorCount++
		case "WARNING":
			warningCount++
		}
	}

	if errorCount > 0 {
		report.IsValid = false
	}

	report.Summary = fmt.Sprintf("Validated %d rigged elements: %d errors, %d warnings, %d notes.",
		report.RiggedElements, errorCount, warningCount, len(report.Issues)-errorCount-warningCount)

	return report, nil
}

type shapeGeometry struct {
	id           string
	minX, minY   float64
	maxX, maxY   float64
	isClosedPath bool
	hasStroke    bool
}

var (
	attrDRegex      = regexp.MustCompile(`\bd=["']([^"']+)["']`)
	attrStrokeRegex = regexp.MustCompile(`\bstroke=["']([^"']+)["']`)
	svgNumberRegex  = regexp.MustCompile(`[-+]?(?:\d+\.?\d*|\.\d+)`)
)

func parseAttrFloat(attrs, name string) (float64, bool) {
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `=["']([^"']+)["']`)
	m := re.FindStringSubmatch(attrs)
	if len(m) < 2 {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(m[1]), 64)
	return v, err == nil
}

func extractShapeGeometry(tagType, attrs, id string) (shapeGeometry, bool) {
	g := shapeGeometry{
		id:   id,
		minX: math.Inf(1),
		minY: math.Inf(1),
		maxX: math.Inf(-1),
		maxY: math.Inf(-1),
	}

	if sm := attrStrokeRegex.FindStringSubmatch(attrs); len(sm) >= 2 {
		sVal := strings.ToLower(strings.TrimSpace(sm[1]))
		g.hasStroke = sVal != "" && sVal != "none"
	}

	switch strings.ToLower(tagType) {
	case "path":
		dm := attrDRegex.FindStringSubmatch(attrs)
		if len(dm) < 2 {
			return g, false
		}
		dStr := strings.TrimSpace(dm[1])
		g.isClosedPath = strings.HasSuffix(strings.ToUpper(dStr), "Z")

		nums := svgNumberRegex.FindAllString(dStr, -1)
		if len(nums) < 2 {
			return g, false
		}
		for i := 0; i+1 < len(nums); i += 2 {
			x, err1 := strconv.ParseFloat(nums[i], 64)
			y, err2 := strconv.ParseFloat(nums[i+1], 64)
			if err1 == nil && err2 == nil {
				if x < g.minX {
					g.minX = x
				}
				if x > g.maxX {
					g.maxX = x
				}
				if y < g.minY {
					g.minY = y
				}
				if y > g.maxY {
					g.maxY = y
				}
			}
		}
		return g, !math.IsInf(g.minX, 1)

	case "circle":
		cx, ok1 := parseAttrFloat(attrs, "cx")
		cy, ok2 := parseAttrFloat(attrs, "cy")
		r, ok3 := parseAttrFloat(attrs, "r")
		if !ok1 || !ok2 || !ok3 {
			return g, false
		}
		g.minX, g.maxX = cx-r, cx+r
		g.minY, g.maxY = cy-r, cy+r
		g.isClosedPath = true
		return g, true

	case "ellipse":
		cx, ok1 := parseAttrFloat(attrs, "cx")
		cy, ok2 := parseAttrFloat(attrs, "cy")
		rx, ok3 := parseAttrFloat(attrs, "rx")
		ry, ok4 := parseAttrFloat(attrs, "ry")
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return g, false
		}
		g.minX, g.maxX = cx-rx, cx+rx
		g.minY, g.maxY = cy-ry, cy+ry
		g.isClosedPath = true
		return g, true

	case "rect":
		x, ok1 := parseAttrFloat(attrs, "x")
		y, ok2 := parseAttrFloat(attrs, "y")
		w, ok3 := parseAttrFloat(attrs, "width")
		h, ok4 := parseAttrFloat(attrs, "height")
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return g, false
		}
		g.minX, g.maxX = x, x+w
		g.minY, g.maxY = y, y+h
		g.isClosedPath = true
		return g, true
	}

	return g, false
}

// validateGeometryAndVisualSeams checks leaf shape bounding boxes for floating heads,
// out-of-bounds markings/spots, and closed interior joint strokes on arms.
func validateGeometryAndVisualSeams(svgContent string, report *RigValidationReport) {
	leaves := leafShapeRegex.FindAllStringSubmatch(svgContent, -1)
	report.TotalElements = len(leaves)
	if len(leaves) == 0 {
		return
	}

	shapes := make(map[string]shapeGeometry)
	var allShapes []shapeGeometry

	for _, m := range leaves {
		if len(m) < 4 {
			continue
		}
		if g, ok := extractShapeGeometry(m[1], m[2], m[3]); ok {
			shapes[strings.ToLower(m[3])] = g
			allShapes = append(allShapes, g)
		}
	}

	headGeo, hasHead := shapes["head"]
	if !hasHead {
		headGeo, hasHead = shapes["head_base"]
	}
	bodyGeo, hasBody := shapes["body"]
	if !hasBody {
		bodyGeo, hasBody = shapes["torso"]
	}
	_, hasNeck := shapes["neck"]
	if !hasNeck {
		for k := range shapes {
			if strings.HasPrefix(k, "neck") {
				hasNeck = true
				break
			}
		}
	}

	// 4a. Floating Head / Missing Neck Overlap Check
	if hasHead && hasBody && !hasNeck {
		if bodyGeo.minY > headGeo.maxY-2.0 {
			report.Issues = append(report.Issues, ValidationIssue{
				Severity:    "WARNING",
				ElementID:   bodyGeo.id,
				Title:       "Floating Head Hazard: Insufficient vertical overlap between Head and Body",
				Description: fmt.Sprintf("Head ends at y=%.1f while Body starts at y=%.1f. Without a neck or vertical overlap behind the chin, the head appears detached or floats when pitching upward.", headGeo.maxY, bodyGeo.minY),
				Fix:         fmt.Sprintf("Extend the upper neck section of '%s' above y=%.1f so it tucks cleanly behind the head.", bodyGeo.id, headGeo.maxY-15.0),
			})
		}
	}

	// 4a-ii. Shallow Neck Top Overlap Hazard (prevents squared-off neck top from peeking out on extreme yaw/roll/pitch)
	if hasHead && hasNeck {
		minNeckY := math.Inf(1)
		neckID := "Neck"
		for k, g := range shapes {
			if strings.HasPrefix(k, "neck") && g.minY < minNeckY {
				minNeckY = g.minY
				neckID = g.id
			}
		}
		if minNeckY > headGeo.maxY-18.0 {
			report.Issues = append(report.Issues, ValidationIssue{
				Severity:    "WARNING",
				ElementID:   neckID,
				Title:       "Exposed Neck Top Hazard: Neck does not extend deep enough behind Head",
				Description: fmt.Sprintf("Head ends at y=%.1f while top of Neck ('%s') starts at y=%.1f. At extreme yaw/roll or upward pitch, the squared-off top of the neck may be exposed.", headGeo.maxY, neckID, minNeckY),
				Fix:         fmt.Sprintf("Extend '%s' higher up behind '%s' (at least 20-40px above y=%.1f) or reduce neck Follow yaw/roll.", neckID, headGeo.id, headGeo.maxY),
			})
		}
	}

	// 4b. Out-of-Bounds Markings (Body_Spot_* / Head_Spot*) Check
	const boundsTolerance = 8.0
	for _, s := range allShapes {
		lower := strings.ToLower(s.id)
		if hasBody && (strings.Contains(lower, "body_spot") || strings.Contains(lower, "torso_spot")) {
			if s.minX < bodyGeo.minX-boundsTolerance || s.maxX > bodyGeo.maxX+boundsTolerance ||
				s.minY < bodyGeo.minY-boundsTolerance || s.maxY > bodyGeo.maxY+boundsTolerance {
				report.Issues = append(report.Issues, ValidationIssue{
					Severity:    "WARNING",
					ElementID:   s.id,
					Title:       fmt.Sprintf("Out-of-Bounds Marking: '%s' extends outside '%s'", s.id, bodyGeo.id),
					Description: fmt.Sprintf("Spot bounds [x:%.1f..%.1f, y:%.1f..%.1f] protrude beyond Body bounds [x:%.1f..%.1f, y:%.1f..%.1f].", s.minX, s.maxX, s.minY, s.maxY, bodyGeo.minX, bodyGeo.maxX, bodyGeo.minY, bodyGeo.maxY),
					Fix:         "Reshape the spot path so its outer contour hugs the inside of the body silhouette, or apply a <clipPath>.",
				})
			}
		}
		if hasHead && strings.Contains(lower, "head_spot") {
			if s.minX < headGeo.minX-boundsTolerance || s.maxX > headGeo.maxX+boundsTolerance ||
				s.minY < headGeo.minY-boundsTolerance || s.maxY > headGeo.maxY+boundsTolerance {
				report.Issues = append(report.Issues, ValidationIssue{
					Severity:    "WARNING",
					ElementID:   s.id,
					Title:       fmt.Sprintf("Out-of-Bounds Marking: '%s' extends outside '%s'", s.id, headGeo.id),
					Description: fmt.Sprintf("Spot bounds [x:%.1f..%.1f, y:%.1f..%.1f] protrude beyond Head bounds [x:%.1f..%.1f, y:%.1f..%.1f].", s.minX, s.maxX, s.minY, s.maxY, headGeo.minX, headGeo.maxX, headGeo.minY, headGeo.maxY),
					Fix:         "Reshape the spot path so its outer contour stays within the head silhouette, or apply a <clipPath>.",
				})
			}
		}

		// 4c. Closed Joint Seam Stroke on Attached Arms
		if hasBody && (lower == "arm_left" || lower == "arm_right" || lower == "left_arm" || lower == "right_arm" || lower == "arms") {
			if s.isClosedPath && s.hasStroke && s.minY > bodyGeo.minY+20.0 {
				report.Issues = append(report.Issues, ValidationIssue{
					Severity:    "WARNING",
					ElementID:   s.id,
					Title:       fmt.Sprintf("Visible Joint Seam Hazard: '%s' is a closed path ('Z') with a top stroke inside the torso", s.id),
					Description: "Closing the top of an attached arm path with 'Z' draws a dark outline stroke across the shoulder/chest seam instead of blending into the body.",
					Fix:         "Use an open path (omit trailing 'Z' / set closed: false) on the top shoulder edge so the arm fill blends seamlessly into the body.",
				})
			}
		}
	}
}
