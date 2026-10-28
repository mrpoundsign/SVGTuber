package mcp

import (
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
)

var (
	directivePattern = regexp.MustCompile(`\[([A-Za-z]+)\s*\{([^}]+)\}\]`)
	xmlTagOpenRegex  = regexp.MustCompile(`(?s)<([a-zA-Z0-9_:-]+)(\s+(?:[^>"']|"[^"]*"|'[^']*')*?id=["']([^"']+)["'](?:[^>"']|"[^"]*"|'[^']*')*)>`)
	leafShapeRegex   = regexp.MustCompile(`(?s)<(path|circle|ellipse|rect|polygon|polyline|line)(\s+(?:[^>"']|"[^"]*"|'[^']*')*?id=["']([^"']+)["'](?:[^>"']|"[^"]*"|'[^']*')*?)/\s*>`)
)

// CompactLayerInfo represents a token-efficient summary of a rigged layer.
type CompactLayerInfo struct {
	ID         string   `json:"id"`
	Label      string   `json:"label"`
	Directives []string `json:"directives"`
	Pivot      string   `json:"pivot,omitempty"`
}

// CompactRigReport provides a high-density, low-token summary of an SVG puppet.
type CompactRigReport struct {
	SVGPath            string             `json:"svg_path"`
	ViewBox            string             `json:"view_box,omitempty"`
	TotalElements      int                `json:"total_elements"`
	RiggedCount        int                `json:"rigged_count"`
	Expressions        []string           `json:"expressions"`
	RiggedLayers       []CompactLayerInfo `json:"rigged_layers"`
	UnriggedCandidates []string           `json:"unrigged_candidates,omitempty"`
}

// ElementTag specifies an ID and directive to apply.
type ElementTag struct {
	ID        string `json:"id"`
	Directive string `json:"directive"`
}

// TagResult reports the outcome of a batch tagging operation.
type TagResult struct {
	OutputPath    string       `json:"output_path"`
	ModifiedCount int          `json:"modified_count"`
	AppliedTags   []ElementTag `json:"applied_tags"`
}

// AutoRigOptions configures automated anatomical tag recognition.
type AutoRigOptions struct {
	OverwriteExisting bool `json:"overwrite_existing,omitempty"`
}

// AutoRigResult reports the elements automatically rigged by keyword matching.
type AutoRigResult struct {
	OutputPath     string       `json:"output_path"`
	TaggedCount    int          `json:"tagged_count"`
	TaggedElements []ElementTag `json:"tagged_elements"`
}

// InspectRig provides a fast, low-token summary of an SVG rig.
func InspectRig(svgPath string) (*CompactRigReport, error) {
	data, err := os.ReadFile(svgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read svg file: %w", err)
	}

	content := string(data)
	report := &CompactRigReport{
		SVGPath: svgPath,
	}

	// Extract viewBox if present
	if _, after, ok := strings.Cut(content, "viewBox=\""); ok {
		if before, _, ok := strings.Cut(after, "\""); ok {
			report.ViewBox = before
		}
	}

	// Parse elements via rig.DefaultParser
	rigDef, err := rig.DefaultParser.Parse(data)
	if err != nil {
		return nil, fmt.Errorf("failed to extract rig elements: %w", err)
	}

	exprSet := make(map[string]bool)
	report.RiggedCount = len(rigDef.Elements)
	report.RiggedLayers = make([]CompactLayerInfo, 0, len(rigDef.Elements))

	riggedIDs := make(map[string]bool)
	for _, el := range rigDef.Elements {
		riggedIDs[el.ID] = true
		var dirNames []string
		pivot := ""
		for _, d := range el.Directives {
			dirNames = append(dirNames, d.Type)
			if p, ok := d.Params["pivot"]; ok {
				pivot = p
			}
			if when, ok := d.Params["when"]; ok {
				extractExpressionNames(when, exprSet)
			}
		}

		report.RiggedLayers = append(report.RiggedLayers, CompactLayerInfo{
			ID:         el.ID,
			Label:      el.Label,
			Directives: dirNames,
			Pivot:      pivot,
		})
	}

	for expr := range exprSet {
		report.Expressions = append(report.Expressions, expr)
	}

	// Quick scan for unrigged candidates with meaningful IDs
	decoder := xml.NewDecoder(strings.NewReader(content))
	candidateSet := make(map[string]bool)
	totalElems := 0

	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		if se, ok := token.(xml.StartElement); ok {
			totalElems++
			for _, attr := range se.Attr {
				if attr.Name.Local == "id" && attr.Value != "" {
					id := attr.Value
					if !riggedIDs[id] && isAnatomicalCandidate(id) {
						candidateSet[id] = true
					}
				}
			}
		}
	}

	report.TotalElements = totalElems
	for cand := range candidateSet {
		report.UnriggedCandidates = append(report.UnriggedCandidates, cand)
		if len(report.UnriggedCandidates) >= 15 {
			break
		}
	}

	return report, nil
}

func ensureInkscapeNamespace(content string) string {
	if strings.Contains(content, "xmlns:inkscape=") {
		return content
	}
	return strings.Replace(content, "<svg ", `<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" `, 1)
}

// ApplyDirectives surgically updates inkscape:label and data-name on designated elements.
func ApplyDirectives(svgPath string, tags []ElementTag, outputPath string) (*TagResult, error) {
	if len(tags) == 0 {
		return nil, errors.New("tags list cannot be empty")
	}

	data, err := os.ReadFile(svgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read svg file: %w", err)
	}

	content := ensureInkscapeNamespace(string(data))
	tagMap := make(map[string]string)
	for _, t := range tags {
		normDirective := strings.TrimSpace(t.Directive)
		if !strings.HasPrefix(normDirective, "[") {
			normDirective = "[" + normDirective + "]"
		}
		tagMap[t.ID] = normDirective
	}

	var applied []ElementTag
	modifiedCount := 0

	// Regex-based tag replacement preserving geometry
	content = xmlTagOpenRegex.ReplaceAllStringFunc(content, func(fullMatch string) string {
		sub := xmlTagOpenRegex.FindStringSubmatch(fullMatch)
		if len(sub) < 4 {
			return fullMatch
		}
		tagType := sub[1]
		attrsStr := sub[2]
		id := sub[3]

		directive, hasTag := tagMap[id]
		if !hasTag {
			return fullMatch
		}

		// Clean existing directives from data-name or inkscape:label if present
		cleanAttrs := updateOrAddAttribute(attrsStr, "data-name", id, directive)
		cleanAttrs = updateOrAddAttribute(cleanAttrs, "inkscape:label", id, directive)

		modifiedCount++
		applied = append(applied, ElementTag{ID: id, Directive: directive})
		return fmt.Sprintf("<%s%s>", tagType, cleanAttrs)
	})

	if outputPath == "" {
		outputPath = svgPath
	}

	if err := os.WriteFile(outputPath, []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("failed to write updated svg: %w", err)
	}

	return &TagResult{
		OutputPath:    outputPath,
		ModifiedCount: modifiedCount,
		AppliedTags:   applied,
	}, nil
}

// AutoRig scans an SVG for anatomical keywords, automatically structures flat Vectorcraft/Illustrator
// paths into a nested <g> hierarchy when needed, and applies verified IAMS directives in one pass.
func AutoRig(svgPath string, outputPath string, opts AutoRigOptions) (*AutoRigResult, error) {
	data, err := os.ReadFile(svgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read svg file: %w", err)
	}

	content := ensureInkscapeNamespace(string(data))
	if outputPath == "" {
		outputPath = svgPath
	}

	// Check if this is a flat leaf SVG (e.g. from Vectorcraft/Illustrator where Head is a <path> rather than a parent <g>)
	if structured, tags, ok := structureFlatSVG(content); ok {
		if err := os.WriteFile(outputPath, []byte(structured), 0644); err != nil {
			return nil, fmt.Errorf("failed to write structured svg: %w", err)
		}
		return &AutoRigResult{
			OutputPath:     outputPath,
			TaggedCount:    len(tags),
			TaggedElements: tags,
		}, nil
	}

	matches := xmlTagOpenRegex.FindAllStringSubmatch(content, -1)

	var tagsToApply []ElementTag
	for _, m := range matches {
		if len(m) < 4 {
			continue
		}
		attrs := m[2]
		id := m[3]

		// Skip if already rigged unless OverwriteExisting is true
		if !opts.OverwriteExisting && (directivePattern.MatchString(attrs) || strings.Contains(attrs, "Follow {") || strings.Contains(attrs, "Sway {") || strings.Contains(attrs, "Scale {") || strings.Contains(attrs, "Show {") || strings.Contains(attrs, "Hide {")) {
			continue
		}

		dir, _ := ResolveDirectiveForPart(id, nil)
		if dir != "" && !strings.HasPrefix(dir, "[Follow {yaw: 5") {
			tagsToApply = append(tagsToApply, ElementTag{
				ID:        id,
				Directive: dir,
			})
		}
	}

	if len(tagsToApply) == 0 {
		return &AutoRigResult{
			OutputPath:     svgPath,
			TaggedCount:    0,
			TaggedElements: nil,
		}, nil
	}

	res, err := ApplyDirectives(svgPath, tagsToApply, outputPath)
	if err != nil {
		return nil, err
	}

	return &AutoRigResult{
		OutputPath:     res.OutputPath,
		TaggedCount:    res.ModifiedCount,
		TaggedElements: res.AppliedTags,
	}, nil
}

// stripLeafDirectives removes inline IAMS bracket directives from a leaf shape and normalizes legacy IDs to the MCP Universal Layer Naming Convention.
func stripLeafDirectives(rawTag string, id string) string {
	cleaned := directivePattern.ReplaceAllString(rawTag, "")
	// Clean up trailing spaces inside quotes from stripped directives
	cleaned = regexp.MustCompile(`\s+"`).ReplaceAllString(cleaned, `"`)
	// Remove redundant inkscape:label and data-name on leaf paths inside rigged groups
	cleaned = regexp.MustCompile(`\s+inkscape:label="[^"]*"`).ReplaceAllString(cleaned, "")
	cleaned = regexp.MustCompile(`\s+data-name="[^"]*"`).ReplaceAllString(cleaned, "")

	canonID := canonicalizeLeafID(id)
	if canonID != id {
		idRe := regexp.MustCompile(`\bid=["']` + regexp.QuoteMeta(id) + `["']`)
		cleaned = idRe.ReplaceAllString(cleaned, fmt.Sprintf(`id=%q`, canonID))
	}
	return strings.TrimSpace(cleaned)
}

func canonicalizeLeafID(id string) string {
	exact := map[string]string{
		"Left_Eye_White":   "Eye_Open_Left",
		"Right_Eye_White":  "Eye_Open_Right",
		"Left_Eyelid_Top":  "Eyelid_Top_Left",
		"Right_Eyelid_Top": "Eyelid_Top_Right",
		"Eyes_Closed":      "Eye_Closed_Left",
		"Left_Eye_Closed":  "Eye_Closed_Left",
		"Eyes_Closed_Right": "Eye_Closed_Right",
		"Right_Eye_Closed": "Eye_Closed_Right",
		"Left_Brow":        "Brow_Left",
		"Right_Brow":       "Brow_Right",
		"Bandanna_Collar":  "Collar",
		"Bandanna_Trim":    "Collar_Trim",
		"Bell":             "Chest_Accessory",
		"Bell_Rim":         "Chest_Accessory_Rim",
		"Bell_Clapper":     "Chest_Accessory_Clapper",
		"Bell_Clapper_Center": "Chest_Core_Clapper",
		"Left_Horn":        "Top_Accessory_Left",
		"Right_Horn":       "Top_Accessory_Right",
		"Left_Ear":         "Ear_Left",
		"Right_Ear":        "Ear_Right",
		"Ear_Tag":          "Ear_Left_Tag",
		"Muzzle":           "Face_Center",
		"Muzzle_Screen":    "Face_Center_Screen",
		"Left_Nostril":     "Nostril_Left",
		"Right_Nostril":    "Nostril_Right",
		"Open_Tongue":      "Mouth_Tongue",
		"Smile_Tongue":     "Mouth_Smile_Tongue",
		"Hoof_Left":        "Hand_Left",
		"Hoof_Right":       "Hand_Right",
		"Forelock_Hair":    "Forelock",
		"Head_Spot":        "Head_Spot_Right",
	}
	if mapped, ok := exact[id]; ok {
		return mapped
	}
	prefixes := [][2]string{
		{"Left_Horn_", "Top_Accessory_Left_"},
		{"Right_Horn_", "Top_Accessory_Right_"},
		{"Left_Ear_", "Ear_Left_"},
		{"Right_Ear_", "Ear_Right_"},
		{"Bell_Core_", "Chest_Core_"},
		{"Muzzle_Visor_", "Head_Visor_"},
		{"Hoof_Left_", "Hand_Left_"},
		{"Hoof_Right_", "Hand_Right_"},
	}
	for _, p := range prefixes {
		if after, ok := strings.CutPrefix(id, p[0]); ok {
			return p[1] + after
		}
	}
	return id
}

func makeRigGroup(indent, id, directive string, children []string) (string, *ElementTag) {
	if len(children) == 0 {
		return "", nil
	}
	var b strings.Builder
	if directive != "" {
		escapedDir := xmlEscapeAttr(directive)
		labelVal := fmt.Sprintf("%s %s", id, escapedDir)
		fmt.Fprintf(&b, "%s<g id=%q data-name=%q inkscape:label=%q>\n", indent, id, labelVal, labelVal)
	} else {
		fmt.Fprintf(&b, "%s<g id=%q data-name=%q>\n", indent, id, id)
	}
	for _, ch := range children {
		for line := range strings.SplitSeq(strings.TrimRight(ch, "\n"), "\n") {
			fmt.Fprintf(&b, "%s  %s\n", indent, strings.TrimSpace(line))
		}
	}
	fmt.Fprintf(&b, "%s</g>", indent)
	var tag *ElementTag
	if directive != "" {
		tag = &ElementTag{ID: id, Directive: directive}
	}
	return b.String(), tag
}

// structureFlatSVG detects flat Vectorcraft/Illustrator SVGs where Head and facial parts are flat sibling leaf shapes,
// and reorganizes them into a proper hierarchical <g> rig tree so head motion carries ears, horns, eyes, muzzle, and mouth.
func structureFlatSVG(content string) (string, []ElementTag, bool) {
	leaves := leafShapeRegex.FindAllStringSubmatch(content, -1)
	if len(leaves) < 6 {
		return "", nil, false
	}

	hasLeafHead := false
	for _, m := range leaves {
		if strings.EqualFold(m[3], "Head") || strings.EqualFold(m[3], "Head_Base") {
			hasLeafHead = true
			break
		}
	}
	if !hasLeafHead {
		return "", nil, false
	}

	// Buckets for hierarchical scene graph
	var (
		tailShapes           []string
		neckBaseShapes       []string
		neckRingBuckets      [6][]string
		bodyBaseShapes       []string
		collarShapes         []string
		leftArmShapes        []string
		rightArmShapes       []string
		bellShapes           []string
		leftHornShapes       []string
		rightHornShapes      []string
		leftEarShapes        []string
		rightEarShapes       []string
		headBaseShapes       []string
		forelockShapes       []string
		eyeOpenLeftShapes    []string
		eyeOpenRightShapes   []string
		pupilLeftShapes      []string
		pupilRightShapes     []string
		eyeClosedLeftShapes  []string
		eyeClosedRightShapes []string
		browLeftShapes       []string
		browRightShapes      []string
		muzzleBaseShapes     []string
		whiskerLShapes       []string
		whiskerRShapes       []string
		mouthRestShapes      []string
		mouthSmileShapes     []string
		mouthOpenShapes      []string
		blushShapes          []string
		otherShapes          []string
	)

	isMechanical := false

	for _, m := range leaves {
		fullTag := m[0]
		id := m[3]
		norm := strings.ToLower(id)
		cleanTag := stripLeafDirectives(fullTag, id)

		if strings.Contains(norm, "visor") || strings.Contains(norm, "muzzle_screen") || strings.Contains(norm, "ear_pod") || strings.Contains(norm, "bell_core") || strings.Contains(norm, "chest_core") || strings.Contains(norm, "reactor") || strings.Contains(norm, "antenna") || strings.Contains(norm, "equalizer") || strings.Contains(norm, "pincer") {
			isMechanical = true
		}

		switch {
		case strings.HasPrefix(norm, "tail") || strings.Contains(norm, "tail"):
			tailShapes = append(tailShapes, cleanTag)

		case strings.HasPrefix(norm, "neck") || (strings.Contains(norm, "neck") && !strings.Contains(norm, "necklace")):
			placedRing := false
			for idx := 1; idx <= 5; idx++ {
				suffix := fmt.Sprintf("_%d", idx)
				if strings.HasSuffix(norm, suffix) {
					neckRingBuckets[idx] = append(neckRingBuckets[idx], cleanTag)
					placedRing = true
					break
				}
			}
			if !placedRing {
				neckBaseShapes = append(neckBaseShapes, cleanTag)
			}

		case strings.Contains(norm, "pupil") || strings.Contains(norm, "iris") || strings.Contains(norm, "glint"):
			if strings.Contains(norm, "right") {
				pupilRightShapes = append(pupilRightShapes, cleanTag)
			} else {
				pupilLeftShapes = append(pupilLeftShapes, cleanTag)
			}

		case (strings.Contains(norm, "arm") && !strings.Contains(norm, "armor")) || strings.Contains(norm, "hoof") || strings.Contains(norm, "paw") || strings.Contains(norm, "hand") || strings.Contains(norm, "clamp") || strings.Contains(norm, "claw") || strings.Contains(norm, "pincer") || strings.Contains(norm, "wrist"):
			if strings.Contains(norm, "right") {
				rightArmShapes = append(rightArmShapes, cleanTag)
			} else {
				leftArmShapes = append(leftArmShapes, cleanTag)
			}

		case strings.Contains(norm, "chest_accessory") || strings.Contains(norm, "chest_core") || strings.Contains(norm, "bell") || strings.Contains(norm, "pendant") || strings.Contains(norm, "necklace") || strings.Contains(norm, "clapper") || strings.Contains(norm, "core") || strings.Contains(norm, "reactor"):
			bellShapes = append(bellShapes, cleanTag)

		case strings.Contains(norm, "collar") || strings.Contains(norm, "bandanna") || strings.Contains(norm, "scarf") || strings.Contains(norm, "flange"):
			collarShapes = append(collarShapes, cleanTag)

		case strings.Contains(norm, "body") || strings.Contains(norm, "torso") || strings.Contains(norm, "chest") || strings.Contains(norm, "shoulder") || strings.Contains(norm, "chassis") || strings.Contains(norm, "sweater") || strings.Contains(norm, "shirt"):
			bodyBaseShapes = append(bodyBaseShapes, cleanTag)

		case strings.Contains(norm, "top_accessory") || strings.Contains(norm, "horn") || strings.Contains(norm, "antenna"):
			if strings.Contains(norm, "right") {
				rightHornShapes = append(rightHornShapes, cleanTag)
			} else {
				leftHornShapes = append(leftHornShapes, cleanTag)
			}

		case strings.Contains(norm, "ear") || strings.Contains(norm, "transceiver") || strings.Contains(norm, "fin_left") || strings.Contains(norm, "fin_right"):
			if strings.Contains(norm, "right") {
				rightEarShapes = append(rightEarShapes, cleanTag)
			} else {
				leftEarShapes = append(leftEarShapes, cleanTag)
			}

		case strings.Contains(norm, "forelock") || strings.Contains(norm, "hair") || strings.Contains(norm, "bang") || strings.Contains(norm, "ahoge") || strings.Contains(norm, "crest") || strings.Contains(norm, "beacon"):
			forelockShapes = append(forelockShapes, cleanTag)

		case strings.Contains(norm, "head") || strings.Contains(norm, "skull") || strings.Contains(norm, "cranium") || strings.Contains(norm, "visor") || strings.Contains(norm, "faceplate") || strings.Contains(norm, "helmet"):
			headBaseShapes = append(headBaseShapes, cleanTag)

		case strings.Contains(norm, "eyes_closed") || strings.Contains(norm, "eye_closed") || strings.Contains(norm, "closed_eye") || strings.Contains(norm, "blink"):
			if strings.Contains(norm, "right") {
				eyeClosedRightShapes = append(eyeClosedRightShapes, cleanTag)
			} else {
				eyeClosedLeftShapes = append(eyeClosedLeftShapes, cleanTag)
			}

		case strings.Contains(norm, "brow"):
			if strings.Contains(norm, "right") {
				browRightShapes = append(browRightShapes, cleanTag)
			} else if strings.Contains(norm, "left") {
				browLeftShapes = append(browLeftShapes, cleanTag)
			} else if lTag, rTag, ok := splitCompoundBrowPath(cleanTag, id); ok {
				browLeftShapes = append(browLeftShapes, lTag)
				browRightShapes = append(browRightShapes, rTag)
			} else {
				browLeftShapes = append(browLeftShapes, cleanTag)
			}

		case strings.Contains(norm, "eye") || strings.Contains(norm, "sclera"):
			if strings.Contains(norm, "right") {
				eyeOpenRightShapes = append(eyeOpenRightShapes, cleanTag)
			} else {
				eyeOpenLeftShapes = append(eyeOpenLeftShapes, cleanTag)
			}

		case strings.Contains(norm, "whisker"):
			if strings.Contains(norm, "right") {
				whiskerRShapes = append(whiskerRShapes, cleanTag)
			} else {
				whiskerLShapes = append(whiskerLShapes, cleanTag)
			}

		case strings.Contains(norm, "mouth_resting") || strings.Contains(norm, "mouth_neutral") || strings.Contains(norm, "mouth_closed") || strings.Contains(norm, "resting_mouth"):
			mouthRestShapes = append(mouthRestShapes, cleanTag)

		case strings.Contains(norm, "mouth_smile") || strings.Contains(norm, "smile_tongue") || strings.Contains(norm, "smile"):
			mouthSmileShapes = append(mouthSmileShapes, cleanTag)

		case strings.Contains(norm, "mouth_open") || strings.Contains(norm, "mouth_tongue") || strings.Contains(norm, "mouth_equalizer") || strings.Contains(norm, "open_tongue") || strings.Contains(norm, "tongue") || strings.Contains(norm, "teeth") || strings.Contains(norm, "mouth"):
			mouthOpenShapes = append(mouthOpenShapes, cleanTag)

		case strings.Contains(norm, "face_center") || strings.Contains(norm, "muzzle") || strings.Contains(norm, "snout") || strings.Contains(norm, "nose") || strings.Contains(norm, "nostril"):
			muzzleBaseShapes = append(muzzleBaseShapes, cleanTag)

		case strings.Contains(norm, "blush") || strings.Contains(norm, "cheek"):
			blushShapes = append(blushShapes, cleanTag)

		default:
			otherShapes = append(otherShapes, cleanTag)
		}
	}

	var appliedTags []ElementTag
	addGroup := func(indent, id, dir string, items []string) string {
		gStr, tag := makeRigGroup(indent, id, dir, items)
		if tag != nil {
			appliedTags = append(appliedTags, *tag)
		}
		return gStr
	}

	var rootGroups []string

	// 1. Tail Group
	if g := addGroup("    ", "Tail_Group", "[Follow {yaw: -8; pitch: 4}] [Sway {pivot: top; range: 18; stiffness: 0.12; damping: 0.82}]", tailShapes); g != "" {
		rootGroups = append(rootGroups, g)
	}

	// 2. Body Group (wrapping graduated corrugated neck, body base, arms, collar, and bell/core)
	var bodyChildren []string
	var neckChildren []string
	neckChildren = append(neckChildren, neckBaseShapes...)
	ringFollowDirectives := [6]string{
		"",
		"[Follow {yaw: 3.5; pitch: 3; roll: 1.8; pivot: bottom}]",
		"[Follow {yaw: 2.8; pitch: 2.4; roll: 1.4; pivot: bottom}]",
		"[Follow {yaw: 2.1; pitch: 1.8; roll: 1.0; pivot: bottom}]",
		"[Follow {yaw: 1.4; pitch: 1.2; roll: 0.7; pivot: bottom}]",
		"[Follow {yaw: 0.7; pitch: 0.6; roll: 0.3; pivot: bottom}]",
	}
	for idx := 1; idx <= 5; idx++ {
		if len(neckRingBuckets[idx]) > 0 {
			ringID := fmt.Sprintf("Neck_Ring_%d_Group", idx)
			if g := addGroup("        ", ringID, ringFollowDirectives[idx], neckRingBuckets[idx]); g != "" {
				neckChildren = append(neckChildren, g)
			}
		}
	}
	if g := addGroup("      ", "Neck_Group", "[Follow {yaw: 2.5; pitch: 2; roll: 1; pivot: bottom}]", neckChildren); g != "" {
		bodyChildren = append(bodyChildren, g)
	}

	bodyChildren = append(bodyChildren, bodyBaseShapes...)
	if g := addGroup("      ", "Arm_Left_Group", "[Follow {yaw: 2; pitch: 1}] [Sway {pivot: top; range: 3.2; stiffness: 0.22; damping: 0.82}]", leftArmShapes); g != "" {
		bodyChildren = append(bodyChildren, g)
	}
	if g := addGroup("      ", "Arm_Right_Group", "[Follow {yaw: 2; pitch: 1}] [Sway {pivot: top; range: 3.2; stiffness: 0.22; damping: 0.82}]", rightArmShapes); g != "" {
		bodyChildren = append(bodyChildren, g)
	}
	if g := addGroup("      ", "Collar_Group", "[Follow {yaw: 3; pitch: 2; roll: 1.5; pivot: center}]", collarShapes); g != "" {
		bodyChildren = append(bodyChildren, g)
	}

	bellDir := "[Follow {yaw: 10; pitch: 6}] [Sway {pivot: top; range: 16; stiffness: 0.22; damping: 0.78}] [Bounce {height: 8; speed: 18; squash: 0.04; pivot: top}]"
	if isMechanical {
		bellDir = "[Follow {yaw: 3; pitch: 2; pivot: center}] [Bounce {height: 2; speed: 18; squash: -0.06; pivot: center}]"
	}
	if g := addGroup("      ", "Chest_Accessory_Group", bellDir, bellShapes); g != "" {
		bodyChildren = append(bodyChildren, g)
	}
	if g := addGroup("    ", "Body_Group", "[Idle {breathe: 0.018; period: 3.8s; pivot: bottom}] [Bounce {height: 2.5; speed: 15; squash: 0.015; pivot: bottom}]", bodyChildren); g != "" {
		rootGroups = append(rootGroups, g)
	}

	// 3. Head Group (wrapping horns/antennas, ears/pods, head base, forelock, independent L/R eyes, brows, face center, mouths, and cheeks)
	var headChildren []string
	hornDir := "[Sway {pivot: bottom; range: 6; stiffness: 0.28; damping: 0.85}]"
	earLDir := "[Sway {pivot: right; range: 12; stiffness: 0.22; damping: 0.82}]"
	earRDir := "[Sway {pivot: left; range: 12; stiffness: 0.22; damping: 0.82}]"
	if isMechanical {
		hornDir = "[Sway {pivot: bottom; range: 13; stiffness: 0.18; damping: 0.78}]"
		earLDir = "[Sway {pivot: right; range: 3.5; stiffness: 0.35; damping: 0.88}]"
		earRDir = "[Sway {pivot: left; range: 3.5; stiffness: 0.35; damping: 0.88}]"
	}

	if g := addGroup("      ", "Top_Accessory_Left_Group", hornDir, leftHornShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Top_Accessory_Right_Group", hornDir, rightHornShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Ear_Left_Group", earLDir, leftEarShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Ear_Right_Group", earRDir, rightEarShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Head_Base_Group", "", headBaseShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Forelock_Group", "[Sway {pivot: top; range: 8; stiffness: 0.25; damping: 0.85}]", forelockShapes); g != "" {
		headChildren = append(headChildren, g)
	}

	// Independent Left & Right Eyes Open (wrapping eye whites, eyelids, and pupil groups)
	sortPupilStack := func(items []string) []string {
		var base, core, glint []string
		for _, it := range items {
			lower := strings.ToLower(it)
			switch {
			case strings.Contains(lower, "glint"):
				glint = append(glint, it)
			case strings.Contains(lower, "core") || strings.Contains(lower, "center"):
				core = append(core, it)
			default:
				base = append(base, it)
			}
		}
		out := make([]string, 0, len(items))
		out = append(out, base...)
		out = append(out, core...)
		out = append(out, glint...)
		return out
	}

	var leftEyeOpenChildren []string
	leftEyeOpenChildren = append(leftEyeOpenChildren, eyeOpenLeftShapes...)
	if g := addGroup("        ", "Pupil_Left_Group", "[Move {x: eyeX; y: eyeY; range: 6}]", sortPupilStack(pupilLeftShapes)); g != "" {
		leftEyeOpenChildren = append(leftEyeOpenChildren, g)
	}
	if g := addGroup("      ", "Eye_Open_Left_Group", "[Hide {when: blinkL > 0.4}]", leftEyeOpenChildren); g != "" {
		headChildren = append(headChildren, g)
	}

	var rightEyeOpenChildren []string
	rightEyeOpenChildren = append(rightEyeOpenChildren, eyeOpenRightShapes...)
	if g := addGroup("        ", "Pupil_Right_Group", "[Move {x: eyeX; y: eyeY; range: 6}]", sortPupilStack(pupilRightShapes)); g != "" {
		rightEyeOpenChildren = append(rightEyeOpenChildren, g)
	}
	if g := addGroup("      ", "Eye_Open_Right_Group", "[Hide {when: blinkR > 0.4}]", rightEyeOpenChildren); g != "" {
		headChildren = append(headChildren, g)
	}

	// Independent Left & Right Eyes Closed
	if g := addGroup("      ", "Eye_Closed_Left_Group", "[Show {when: blinkL > 0.4}]", eyeClosedLeftShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Eye_Closed_Right_Group", "[Show {when: blinkR > 0.4}]", eyeClosedRightShapes); g != "" {
		headChildren = append(headChildren, g)
	}

	// Independent Left & Right Brows
	if g := addGroup("      ", "Brow_Left_Group", "[Move {y: browL; rangeY: -8}] [Rotate {param: browL; range: -6; pivot: center}]", browLeftShapes); g != "" {
		headChildren = append(headChildren, g)
	}
	if g := addGroup("      ", "Brow_Right_Group", "[Move {y: browR; rangeY: -8}] [Rotate {param: browR; range: 6; pivot: center}]", browRightShapes); g != "" {
		headChildren = append(headChildren, g)
	}

	// Face Center Group (wrapping muzzle/snout, nostrils, whiskers, and mouth states)
	var muzzleChildren []string
	muzzleChildren = append(muzzleChildren, muzzleBaseShapes...)
	if g := addGroup("        ", "Whisker_Left_Group", "[Sway {pivot: right; range: 7; stiffness: 0.30; damping: 0.85}]", whiskerLShapes); g != "" {
		muzzleChildren = append(muzzleChildren, g)
	}
	if g := addGroup("        ", "Whisker_Right_Group", "[Sway {pivot: left; range: 7; stiffness: 0.30; damping: 0.85}]", whiskerRShapes); g != "" {
		muzzleChildren = append(muzzleChildren, g)
	}
	if g := addGroup("        ", "Mouth_Resting_Group", "[Hide {when: isMouthOpen || isSmiling}]", mouthRestShapes); g != "" {
		muzzleChildren = append(muzzleChildren, g)
	}
	if g := addGroup("        ", "Mouth_Smile_Group", "[Show {when: isSmiling && !isMouthOpen}] [Scale {y: smile; from: 0.90; to: 1.15; x: smile; fromx: 0.95; tox: 1.10; pivot: top}]", mouthSmileShapes); g != "" {
		muzzleChildren = append(muzzleChildren, g)
	}
	mouthOpenDir := "[Show {when: isMouthOpen}] [Scale {y: mouthOpen; from: 0.30; to: 1.15; x: mouthOpen; fromx: 0.85; tox: 1.10; pivot: top}]"
	if isMechanical {
		mouthOpenDir = "[Show {when: isMouthOpen}] [Scale {y: mouthOpen; from: 0.25; to: 1.25; x: mouthOpen; fromx: 0.90; tox: 1.08; pivot: center}]"
	}
	if g := addGroup("        ", "Mouth_Open_Group", mouthOpenDir, mouthOpenShapes); g != "" {
		muzzleChildren = append(muzzleChildren, g)
	}
	if g := addGroup("      ", "Face_Center_Group", "[Dist {factor: 0.14}]", muzzleChildren); g != "" {
		headChildren = append(headChildren, g)
	}

	// Cheeks / Blush Group
	if g := addGroup("      ", "Cheeks_Group", "[Show {when: isBlush}]", blushShapes); g != "" {
		headChildren = append(headChildren, g)
	}

	// Remaining unclassified shapes
	headChildren = append(headChildren, otherShapes...)

	if g := addGroup("    ", "Head_Group", "[Follow {yaw: 16; pitch: 12; roll: 8; pivot: center}]", headChildren); g != "" {
		rootGroups = append(rootGroups, g)
	}

	// Replace inner body of Layer_1 (or <svg>) with structured groups
	layer1Regex := regexp.MustCompile(`(?s)(<g[^>]*id=["']Layer_1["'][^>]*>).*(</g>\s*</svg>)`)
	if layer1Regex.MatchString(content) {
		replacement := "${1}\n" + strings.Join(rootGroups, "\n") + "\n  ${2}"
		return layer1Regex.ReplaceAllString(content, replacement), appliedTags, true
	}

	return "", nil, false
}

// splitCompoundBrowPath splits a single compound <path> containing two M subpaths (left and right brows)
// into separate Brow_Left and Brow_Right <path> elements.
func splitCompoundBrowPath(cleanTag string, origID string) (string, string, bool) {
	dm := attrDRegex.FindStringSubmatch(cleanTag)
	if len(dm) < 2 {
		return "", "", false
	}
	dStr := strings.TrimSpace(dm[1])
	parts := strings.Split(dStr, "M")
	var subpaths []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			subpaths = append(subpaths, "M"+trimmed)
		}
	}
	if len(subpaths) != 2 {
		return "", "", false
	}

	idReplace := regexp.MustCompile(`\bid=["']` + regexp.QuoteMeta(origID) + `["']`)
	leftTag := idReplace.ReplaceAllString(cleanTag, `id="Brow_Left"`)
	leftTag = strings.Replace(leftTag, dm[0], fmt.Sprintf(`d="%s"`, subpaths[0]), 1)

	rightTag := idReplace.ReplaceAllString(cleanTag, `id="Brow_Right"`)
	rightTag = strings.Replace(rightTag, dm[0], fmt.Sprintf(`d="%s"`, subpaths[1]), 1)
	return leftTag, rightTag, true
}

func xmlEscapeAttr(s string) string {
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&", "&amp;")
	return s
}

func updateOrAddAttribute(attrs string, attrName string, id string, directive string) string {
	directive = xmlEscapeAttr(directive)
	pattern := regexp.MustCompile(regexp.QuoteMeta(attrName) + `=["']([^"']*)["']`)
	newVal := fmt.Sprintf("%s %s", id, directive)

	if pattern.MatchString(attrs) {
		return pattern.ReplaceAllStringFunc(attrs, func(m string) string {
			curr := pattern.FindStringSubmatch(m)[1]
			// Strip existing bracket directives
			baseName := strings.TrimSpace(directivePattern.ReplaceAllString(curr, ""))
			if baseName == "" {
				baseName = id
			}
			return fmt.Sprintf(`%s="%s %s"`, attrName, baseName, directive)
		})
	}

	return fmt.Sprintf(` %s="%s"%s`, attrName, newVal, attrs)
}

func extractExpressionNames(whenExpr string, set map[string]bool) {
	cleaned := strings.NewReplacer("&amp;", " ", "&lt;", " ", "&gt;", " ", "&quot;", " ", "&apos;", " ").Replace(whenExpr)
	words := regexp.MustCompile(`\b([a-zA-Z_][a-zA-Z0-9_]*)\b`).FindAllString(cleaned, -1)
	builtin := map[string]bool{
		"true": true, "false": true, "and": true, "or": true,
		"blinkl": true, "blinkr": true, "isblinkl": true, "isblinkr": true, "isblinking": true,
		"mouthopen": true, "ismouthopen": true,
		"smile": true, "issmiling": true,
		"speaking": true, "isspeaking": true,
		"eyex": true, "eyey": true, "eyelookx": true, "eyelooky": true,
		"browup": true, "browinnerup": true, "browl": true, "browr": true,
	}
	for _, w := range words {
		if builtin[strings.ToLower(w)] {
			continue
		}
		set[w] = true
	}
}

// CleanSVGResult reports cleaned element IDs.
type CleanSVGResult struct {
	OutputPath   string   `json:"output_path"`
	CleanedCount int      `json:"cleaned_count"`
	CleanedIDs   []string `json:"cleaned_ids"`
}

// CleanSVGIDs normalizes mangled XML element IDs generated by vector software into clean base names.
func CleanSVGIDs(svgPath string, outputPath string) (*CleanSVGResult, error) {
	data, err := os.ReadFile(svgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read svg file: %w", err)
	}

	content := ensureInkscapeNamespace(string(data))
	usedIDs := make(map[string]int)
	var cleanedIDs []string
	cleanedCount := 0

	content = xmlTagOpenRegex.ReplaceAllStringFunc(content, func(fullMatch string) string {
		sub := xmlTagOpenRegex.FindStringSubmatch(fullMatch)
		if len(sub) < 4 {
			return fullMatch
		}
		tagType := sub[1]
		attrsStr := sub[2]
		rawID := sub[3]

		// Check if ID is mangled (contains double underscores or directive remnants)
		if !strings.Contains(rawID, "__") {
			return fullMatch
		}

		// Derive base ID from data-name or rawID prefix
		baseID := ""
		dataNameRegex := regexp.MustCompile(`data-name=["']([^"']+)["']`)
		if dm := dataNameRegex.FindStringSubmatch(attrsStr); len(dm) > 1 {
			rawName := dm[1]
			if before, _, ok := strings.Cut(rawName, "["); ok {
				baseID = strings.TrimSpace(before)
			} else {
				baseID = strings.TrimSpace(rawName)
			}
		}

		if baseID == "" {
			parts := strings.Split(rawID, "__")
			baseID = parts[0]
		}

		baseID = strings.ReplaceAll(baseID, " ", "_")
		if baseID == "" {
			return fullMatch
		}

		// Ensure uniqueness
		finalID := baseID
		usedIDs[baseID]++
		if count := usedIDs[baseID]; count > 1 {
			finalID = fmt.Sprintf("%s_%d", baseID, count)
		}

		idRegex := regexp.MustCompile(fmt.Sprintf(`id=["']%s["']`, regexp.QuoteMeta(rawID)))
		newAttrs := idRegex.ReplaceAllString(attrsStr, fmt.Sprintf(`id="%s"`, finalID))

		cleanedCount++
		cleanedIDs = append(cleanedIDs, fmt.Sprintf("%s -> %s", rawID, finalID))
		return fmt.Sprintf("<%s%s>", tagType, newAttrs)
	})

	if outputPath == "" {
		outputPath = svgPath
	}

	if err := os.WriteFile(outputPath, []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("failed to write cleaned svg: %w", err)
	}

	return &CleanSVGResult{
		OutputPath:   outputPath,
		CleanedCount: cleanedCount,
		CleanedIDs:   cleanedIDs,
	}, nil
}

func isAnatomicalCandidate(id string) bool {
	lower := strings.ToLower(id)
	keywords := []string{
		"head", "ear", "horn", "antenna", "top_accessory", "whisker",
		"muzzle", "snout", "nostril", "visor", "face_center",
		"mouth", "lip", "tongue", "teeth", "equalizer",
		"eye", "pupil", "iris", "glint", "eyelid", "sclera", "brow",
		"hair", "bang", "forelock", "tail", "tuft", "wing",
		"bell", "pendant", "chest_accessory", "chest_core", "reactor",
		"collar", "bandanna", "scarf", "flange", "neck",
		"arm", "paw", "hand", "hoof", "claw", "pincer",
		"blush", "cheeks", "body", "torso",
	}
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}
