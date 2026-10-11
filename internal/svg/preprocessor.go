package svg

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Matrix2D represents an affine 2D transformation matrix:
// [ a  c  e ]
// [ b  d  f ]
// [ 0  0  1 ]
type Matrix2D struct {
	A, B, C, D, E, F float64
}

// Identity returns the 2D identity matrix.
func Identity() Matrix2D {
	return Matrix2D{A: 1, B: 0, C: 0, D: 1, E: 0, F: 0}
}

// IsIdentity returns true if the matrix is identity (within floating point epsilon).
func (m Matrix2D) IsIdentity() bool {
	const eps = 1e-6
	return math.Abs(m.A-1) < eps &&
		math.Abs(m.B) < eps &&
		math.Abs(m.C) < eps &&
		math.Abs(m.D-1) < eps &&
		math.Abs(m.E) < eps &&
		math.Abs(m.F) < eps
}

// Multiply computes m * other.
func (m Matrix2D) Multiply(o Matrix2D) Matrix2D {
	return Matrix2D{
		A: m.A*o.A + m.C*o.B,
		B: m.B*o.A + m.D*o.B,
		C: m.A*o.C + m.C*o.D,
		D: m.B*o.C + m.D*o.D,
		E: m.A*o.E + m.C*o.F + m.E,
		F: m.B*o.E + m.D*o.F + m.F,
	}
}

// TransformPoint transforms an absolute coordinate (x, y).
func (m Matrix2D) TransformPoint(x, y float64) (float64, float64) {
	return m.A*x + m.C*y + m.E, m.B*x + m.D*y + m.F
}

// TransformVector transforms a relative displacement (dx, dy) without translation.
func (m Matrix2D) TransformVector(dx, dy float64) (float64, float64) {
	return m.A*dx + m.C*dy, m.B*dx + m.D*dy
}

// ToSVG returns the SVG transform attribute string for the matrix.
func (m Matrix2D) ToSVG() string {
	return fmt.Sprintf("matrix(%s %s %s %s %s %s)",
		formatFloat(m.A), formatFloat(m.B), formatFloat(m.C),
		formatFloat(m.D), formatFloat(m.E), formatFloat(m.F))
}

var transformCallRe = regexp.MustCompile(`([a-zA-Z]+)\s*\(([^)]*)\)`)

// ParseTransform parses an SVG transform attribute string into a combined Matrix2D.
func ParseTransform(str string) Matrix2D {
	current := Identity()
	matches := transformCallRe.FindAllStringSubmatch(str, -1)
	if len(matches) == 0 {
		return current
	}

	for _, match := range matches {
		op := strings.ToLower(strings.TrimSpace(match[1]))
		args := parseNumbers(match[2])
		var m Matrix2D
		switch op {
		case "matrix":
			if len(args) >= 6 {
				m = Matrix2D{A: args[0], B: args[1], C: args[2], D: args[3], E: args[4], F: args[5]}
			} else {
				continue
			}
		case "translate":
			tx := 0.0
			ty := 0.0
			if len(args) >= 1 {
				tx = args[0]
			}
			if len(args) >= 2 {
				ty = args[1]
			}
			m = Matrix2D{A: 1, B: 0, C: 0, D: 1, E: tx, F: ty}
		case "scale":
			sx := 1.0
			sy := 1.0
			if len(args) >= 1 {
				sx = args[0]
				sy = args[0]
			}
			if len(args) >= 2 {
				sy = args[1]
			}
			m = Matrix2D{A: sx, B: 0, C: 0, D: sy, E: 0, F: 0}
		case "rotate":
			if len(args) >= 1 {
				rad := args[0] * math.Pi / 180.0
				cosA := math.Cos(rad)
				sinA := math.Sin(rad)
				if len(args) >= 3 {
					cx, cy := args[1], args[2]
					t1 := Matrix2D{A: 1, B: 0, C: 0, D: 1, E: cx, F: cy}
					rot := Matrix2D{A: cosA, B: sinA, C: -sinA, D: cosA, E: 0, F: 0}
					t2 := Matrix2D{A: 1, B: 0, C: 0, D: 1, E: -cx, F: -cy}
					m = t1.Multiply(rot).Multiply(t2)
				} else {
					m = Matrix2D{A: cosA, B: sinA, C: -sinA, D: cosA, E: 0, F: 0}
				}
			} else {
				continue
			}
		default:
			continue
		}
		current = current.Multiply(m)
	}

	return current
}

func parseNumbers(str string) []float64 {
	var nums []float64
	// Match numbers including scientific notation and signs
	re := regexp.MustCompile(`[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?`)
	matches := re.FindAllString(str, -1)
	for _, m := range matches {
		if val, err := strconv.ParseFloat(m, 64); err == nil {
			nums = append(nums, val)
		}
	}
	return nums
}

// formatFloat formats a float without unnecessary trailing zeros.
func formatFloat(f float64) string {
	res := strconv.FormatFloat(f, 'f', 4, 64)
	res = strings.TrimRight(res, "0")
	res = strings.TrimRight(res, ".")
	if res == "-0" || res == "" {
		res = "0"
	}
	return res
}

// TransformPathD parses an SVG path "d" attribute string, applies the Matrix2D,
// and returns the transformed path "d" string.
func TransformPathD(d string, m Matrix2D) string {
	if m.IsIdentity() {
		return d
	}

	tokens := tokenizePathD(d)
	if len(tokens) == 0 {
		return d
	}

	var out []string
	i := 0
	for i < len(tokens) {
		tok := tokens[i]
		if len(tok) == 1 && isPathCmd(tok[0]) {
			cmd := tok[0]
			out = append(out, string(cmd))
			i++

			switch cmd {
			case 'M', 'm':
				first := true
				for i+1 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x, _ := strconv.ParseFloat(tokens[i], 64)
					y, _ := strconv.ParseFloat(tokens[i+1], 64)
					i += 2
					if cmd == 'M' || first {
						tx, ty := m.TransformPoint(x, y)
						out = append(out, formatFloat(tx), formatFloat(ty))
						first = false
					} else {
						// Subsequent pairs in 'm' are treated as relative linetos 'l'
						tx, ty := m.TransformVector(x, y)
						out = append(out, formatFloat(tx), formatFloat(ty))
					}
				}
			case 'L':
				for i+1 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x, _ := strconv.ParseFloat(tokens[i], 64)
					y, _ := strconv.ParseFloat(tokens[i+1], 64)
					i += 2
					tx, ty := m.TransformPoint(x, y)
					out = append(out, formatFloat(tx), formatFloat(ty))
				}
			case 'l':
				for i+1 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x, _ := strconv.ParseFloat(tokens[i], 64)
					y, _ := strconv.ParseFloat(tokens[i+1], 64)
					i += 2
					tx, ty := m.TransformVector(x, y)
					out = append(out, formatFloat(tx), formatFloat(ty))
				}
			case 'H':
				// If matrix has shear/rotation (B!=0), convert H to L
				for i < len(tokens) && !isPathCmd(tokens[i][0]) {
					x, _ := strconv.ParseFloat(tokens[i], 64)
					i++
					tx, ty := m.TransformPoint(x, 0)
					if math.Abs(m.B) > 1e-6 {
						out = append(out, formatFloat(tx), formatFloat(ty))
					} else {
						out = append(out, formatFloat(tx))
					}
				}
			case 'h':
				for i < len(tokens) && !isPathCmd(tokens[i][0]) {
					dx, _ := strconv.ParseFloat(tokens[i], 64)
					i++
					tx, ty := m.TransformVector(dx, 0)
					if math.Abs(m.B) > 1e-6 {
						out = append(out, formatFloat(tx), formatFloat(ty))
					} else {
						out = append(out, formatFloat(tx))
					}
				}
			case 'V':
				for i < len(tokens) && !isPathCmd(tokens[i][0]) {
					y, _ := strconv.ParseFloat(tokens[i], 64)
					i++
					tx, ty := m.TransformPoint(0, y)
					if math.Abs(m.C) > 1e-6 {
						out = append(out, formatFloat(tx), formatFloat(ty))
					} else {
						out = append(out, formatFloat(ty))
					}
				}
			case 'v':
				for i < len(tokens) && !isPathCmd(tokens[i][0]) {
					dy, _ := strconv.ParseFloat(tokens[i], 64)
					i++
					tx, ty := m.TransformVector(0, dy)
					if math.Abs(m.C) > 1e-6 {
						out = append(out, formatFloat(tx), formatFloat(ty))
					} else {
						out = append(out, formatFloat(ty))
					}
				}
			case 'C':
				for i+5 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x1, _ := strconv.ParseFloat(tokens[i], 64)
					y1, _ := strconv.ParseFloat(tokens[i+1], 64)
					x2, _ := strconv.ParseFloat(tokens[i+2], 64)
					y2, _ := strconv.ParseFloat(tokens[i+3], 64)
					x, _ := strconv.ParseFloat(tokens[i+4], 64)
					y, _ := strconv.ParseFloat(tokens[i+5], 64)
					i += 6

					tx1, ty1 := m.TransformPoint(x1, y1)
					tx2, ty2 := m.TransformPoint(x2, y2)
					tx, ty := m.TransformPoint(x, y)
					out = append(out, formatFloat(tx1), formatFloat(ty1), formatFloat(tx2), formatFloat(ty2), formatFloat(tx), formatFloat(ty))
				}
			case 'c':
				for i+5 < len(tokens) && !isPathCmd(tokens[i][0]) {
					dx1, _ := strconv.ParseFloat(tokens[i], 64)
					dy1, _ := strconv.ParseFloat(tokens[i+1], 64)
					dx2, _ := strconv.ParseFloat(tokens[i+2], 64)
					dy2, _ := strconv.ParseFloat(tokens[i+3], 64)
					dx, _ := strconv.ParseFloat(tokens[i+4], 64)
					dy, _ := strconv.ParseFloat(tokens[i+5], 64)
					i += 6

					tx1, ty1 := m.TransformVector(dx1, dy1)
					tx2, ty2 := m.TransformVector(dx2, dy2)
					tx, ty := m.TransformVector(dx, dy)
					out = append(out, formatFloat(tx1), formatFloat(ty1), formatFloat(tx2), formatFloat(ty2), formatFloat(tx), formatFloat(ty))
				}
			case 'S':
				for i+3 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x2, _ := strconv.ParseFloat(tokens[i], 64)
					y2, _ := strconv.ParseFloat(tokens[i+1], 64)
					x, _ := strconv.ParseFloat(tokens[i+2], 64)
					y, _ := strconv.ParseFloat(tokens[i+3], 64)
					i += 4

					tx2, ty2 := m.TransformPoint(x2, y2)
					tx, ty := m.TransformPoint(x, y)
					out = append(out, formatFloat(tx2), formatFloat(ty2), formatFloat(tx), formatFloat(ty))
				}
			case 's':
				for i+3 < len(tokens) && !isPathCmd(tokens[i][0]) {
					dx2, _ := strconv.ParseFloat(tokens[i], 64)
					dy2, _ := strconv.ParseFloat(tokens[i+1], 64)
					dx, _ := strconv.ParseFloat(tokens[i+2], 64)
					dy, _ := strconv.ParseFloat(tokens[i+3], 64)
					i += 4

					tx2, ty2 := m.TransformVector(dx2, dy2)
					tx, ty := m.TransformVector(dx, dy)
					out = append(out, formatFloat(tx2), formatFloat(ty2), formatFloat(tx), formatFloat(ty))
				}
			case 'Q':
				for i+3 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x1, _ := strconv.ParseFloat(tokens[i], 64)
					y1, _ := strconv.ParseFloat(tokens[i+1], 64)
					x, _ := strconv.ParseFloat(tokens[i+2], 64)
					y, _ := strconv.ParseFloat(tokens[i+3], 64)
					i += 4

					tx1, ty1 := m.TransformPoint(x1, y1)
					tx, ty := m.TransformPoint(x, y)
					out = append(out, formatFloat(tx1), formatFloat(ty1), formatFloat(tx), formatFloat(ty))
				}
			case 'q':
				for i+3 < len(tokens) && !isPathCmd(tokens[i][0]) {
					dx1, _ := strconv.ParseFloat(tokens[i], 64)
					dy1, _ := strconv.ParseFloat(tokens[i+1], 64)
					dx, _ := strconv.ParseFloat(tokens[i+2], 64)
					dy, _ := strconv.ParseFloat(tokens[i+3], 64)
					i += 4

					tx1, ty1 := m.TransformVector(dx1, dy1)
					tx, ty := m.TransformVector(dx, dy)
					out = append(out, formatFloat(tx1), formatFloat(ty1), formatFloat(tx), formatFloat(ty))
				}
			case 'T':
				for i+1 < len(tokens) && !isPathCmd(tokens[i][0]) {
					x, _ := strconv.ParseFloat(tokens[i], 64)
					y, _ := strconv.ParseFloat(tokens[i+1], 64)
					i += 2
					tx, ty := m.TransformPoint(x, y)
					out = append(out, formatFloat(tx), formatFloat(ty))
				}
			case 't':
				for i+1 < len(tokens) && !isPathCmd(tokens[i][0]) {
					dx, _ := strconv.ParseFloat(tokens[i], 64)
					dy, _ := strconv.ParseFloat(tokens[i+1], 64)
					i += 2
					tx, ty := m.TransformVector(dx, dy)
					out = append(out, formatFloat(tx), formatFloat(ty))
				}
			case 'Z', 'z':
				// No parameters
			default:
				// Pass through
			}
		} else {
			i++
		}
	}

	return strings.Join(out, " ")
}

func isPathCmd(b byte) bool {
	return strings.ContainsRune("MmLlHhVvCcSsQqTtAaZz", rune(b))
}

func tokenizePathD(d string) []string {
	var tokens []string
	var buf strings.Builder

	flush := func() {
		if buf.Len() > 0 {
			tokens = append(tokens, buf.String())
			buf.Reset()
		}
	}

	for i := 0; i < len(d); i++ {
		ch := d[i]
		switch {
		case isPathCmd(ch):
			flush()
			tokens = append(tokens, string(ch))
		case unicode.IsSpace(rune(ch)) || ch == ',':
			flush()
		case ch == '-' && buf.Len() > 0 && strings.ToUpper(buf.String())[len(buf.String())-1] != 'E':
			flush()
			buf.WriteByte(ch)
		default:
			buf.WriteByte(ch)
		}
	}
	flush()
	return tokens
}

// XMLNode represents a node in the SVG DOM tree.
type XMLNode struct {
	XMLName  xml.Name
	Attrs    []xml.Attr
	Children []*XMLNode
	Content  []byte
	Comment  []byte
}

// PreprocessSVG reads SVG XML data, bakes transforms on rigged elements down into
// their child paths/geometries, clears the transform attribute on the rigged elements,
// and serializes the clean, preprocessed SVG.
func PreprocessSVG(svgData []byte) ([]byte, error) {
	root, nsToPrefix, err := parseXMLTree(svgData)
	if err != nil {
		return nil, fmt.Errorf("parsing SVG XML: %w", err)
	}

	// Traverse and bake transforms down into geometry
	modified := processNode(root, Identity())
	if !modified {
		return svgData, nil
	}

	var buf bytes.Buffer
	serializeNode(&buf, root, nsToPrefix)

	return buf.Bytes(), nil
}

func parseXMLTree(data []byte) (*XMLNode, map[string]string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var stack []*XMLNode
	var root *XMLNode

	nsToPrefix := map[string]string{
		"http://www.w3.org/2000/svg":                         "",
		"http://www.w3.org/1999/xlink":                       "xlink",
		"http://www.inkscape.org/namespaces/inkscape":        "inkscape",
		"http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd": "sodipodi",
	}

	for {
		tok, err := decoder.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, nil, err
		}

		switch t := tok.(type) {
		case xml.StartElement:
			for _, attr := range t.Attr {
				switch {
				case attr.Value == "http://www.w3.org/2000/svg":
					nsToPrefix[attr.Value] = ""
				case attr.Name.Space == "xmlns" && attr.Name.Local != "":
					nsToPrefix[attr.Value] = attr.Name.Local
				case attr.Name.Local == "xmlns":
					nsToPrefix[attr.Value] = ""
				}
			}

			node := &XMLNode{
				XMLName: t.Name,
				Attrs:   t.Attr,
			}
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, node)
			} else {
				root = node
			}
			stack = append(stack, node)
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				if len(bytes.TrimSpace(t)) > 0 {
					node := &XMLNode{
						Content: bytes.Clone(t),
					}
					parent.Children = append(parent.Children, node)
				}
			}
		case xml.Comment:
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				node := &XMLNode{
					Comment: bytes.Clone(t),
				}
				parent.Children = append(parent.Children, node)
			}
		}
	}

	if root == nil {
		return nil, nil, errors.New("empty SVG document")
	}

	return root, nsToPrefix, nil
}

func isContainerTag(tag string) bool {
	switch tag {
	case "g", "svg", "a":
		return true
	default:
		return false
	}
}

func isGeometryTag(tag string) bool {
	switch tag {
	case "path", "rect", "circle", "ellipse", "line", "polygon", "polyline":
		return true
	default:
		return false
	}
}

func processNode(node *XMLNode, accumulatedMatrix Matrix2D) bool {
	if node == nil {
		return false
	}

	tag := strings.ToLower(node.XMLName.Local)
	// Do not bake transforms inside defs (gradients, patterns, clip paths)
	if tag == "defs" {
		return false
	}

	modified := false
	localMatrix := Identity()
	var transformIdx = -1
	for idx, attr := range node.Attrs {
		if attr.Name.Local == "transform" {
			localMatrix = ParseTransform(attr.Value)
			transformIdx = idx
			break
		}
	}

	effectiveMatrix := accumulatedMatrix.Multiply(localMatrix)

	if isContainerTag(tag) {
		// Container elements: strip transform so it gets baked into children
		if transformIdx >= 0 {
			node.Attrs = append(node.Attrs[:transformIdx], node.Attrs[transformIdx+1:]...)
			modified = true
		}
		for _, child := range node.Children {
			if processNode(child, effectiveMatrix) {
				modified = true
			}
		}
		return modified
	}

	if isGeometryTag(tag) {
		// Geometry elements: strip local transform because it gets baked directly into the geometry coordinates
		if transformIdx >= 0 {
			node.Attrs = append(node.Attrs[:transformIdx], node.Attrs[transformIdx+1:]...)
			modified = true
		}
		if !effectiveMatrix.IsIdentity() {
			switch tag {
			case "path":
				for i, attr := range node.Attrs {
					if attr.Name.Local == "d" {
						node.Attrs[i].Value = TransformPathD(attr.Value, effectiveMatrix)
						modified = true
						break
					}
				}
			case "rect":
				applyMatrixToRect(node, effectiveMatrix)
				modified = true
			case "circle":
				applyMatrixToCircle(node, effectiveMatrix)
				modified = true
			case "ellipse":
				applyMatrixToEllipse(node, effectiveMatrix)
				modified = true
			case "line":
				applyMatrixToLine(node, effectiveMatrix)
				modified = true
			case "polygon", "polyline":
				applyMatrixToPolygon(node, effectiveMatrix)
				modified = true
			}
		}
		for _, child := range node.Children {
			if processNode(child, Identity()) {
				modified = true
			}
		}
		return modified
	}

	// Non-geometry leaf or text elements (text, image, use, etc.)
	// We CANNOT bake coordinate transforms into text/image glyphs/pixels directly.
	// Therefore, their transform attribute must reflect the effectiveMatrix.
	if applyMatrixToTransformableNonGeometry(node, effectiveMatrix) {
		modified = true
	}
	for _, child := range node.Children {
		// Children of text (e.g. tspan) already live in the text's coordinate system
		if processNode(child, Identity()) {
			modified = true
		}
	}

	return modified
}

func applyMatrixToRect(node *XMLNode, m Matrix2D) {
	var x, y, width, height float64
	var xIdx, yIdx, wIdx, hIdx = -1, -1, -1, -1

	for i, attr := range node.Attrs {
		switch attr.Name.Local {
		case "x":
			x, _ = strconv.ParseFloat(attr.Value, 64)
			xIdx = i
		case "y":
			y, _ = strconv.ParseFloat(attr.Value, 64)
			yIdx = i
		case "width":
			width, _ = strconv.ParseFloat(attr.Value, 64)
			wIdx = i
		case "height":
			height, _ = strconv.ParseFloat(attr.Value, 64)
			hIdx = i
		}
	}

	if wIdx >= 0 && hIdx >= 0 {
		// Transform the 4 corners
		x1, y1 := m.TransformPoint(x, y)
		x2, y2 := m.TransformPoint(x+width, y)
		x3, y3 := m.TransformPoint(x+width, y+height)
		x4, y4 := m.TransformPoint(x, y+height)

		minX := math.Min(math.Min(x1, x2), math.Min(x3, x4))
		maxX := math.Max(math.Max(x1, x2), math.Max(x3, x4))
		minY := math.Min(math.Min(y1, y2), math.Min(y3, y4))
		maxY := math.Max(math.Max(y1, y2), math.Max(y3, y4))

		newW := maxX - minX
		newH := maxY - minY

		if xIdx >= 0 {
			node.Attrs[xIdx].Value = formatFloat(minX)
		} else {
			node.Attrs = append(node.Attrs, xml.Attr{Name: xml.Name{Local: "x"}, Value: formatFloat(minX)})
		}
		if yIdx >= 0 {
			node.Attrs[yIdx].Value = formatFloat(minY)
		} else {
			node.Attrs = append(node.Attrs, xml.Attr{Name: xml.Name{Local: "y"}, Value: formatFloat(minY)})
		}
		node.Attrs[wIdx].Value = formatFloat(newW)
		node.Attrs[hIdx].Value = formatFloat(newH)
	}
}

func applyMatrixToCircle(node *XMLNode, m Matrix2D) {
	var cx, cy float64
	var cxIdx, cyIdx = -1, -1

	for i, attr := range node.Attrs {
		switch attr.Name.Local {
		case "cx":
			cx, _ = strconv.ParseFloat(attr.Value, 64)
			cxIdx = i
		case "cy":
			cy, _ = strconv.ParseFloat(attr.Value, 64)
			cyIdx = i
		}
	}

	if cxIdx >= 0 && cyIdx >= 0 {
		tcx, tcy := m.TransformPoint(cx, cy)
		node.Attrs[cxIdx].Value = formatFloat(tcx)
		node.Attrs[cyIdx].Value = formatFloat(tcy)
	}
}

func applyMatrixToEllipse(node *XMLNode, m Matrix2D) {
	var cx, cy, rx, ry float64
	var cxIdx, cyIdx, rxIdx, ryIdx = -1, -1, -1, -1

	for i, attr := range node.Attrs {
		switch attr.Name.Local {
		case "cx":
			cx, _ = strconv.ParseFloat(attr.Value, 64)
			cxIdx = i
		case "cy":
			cy, _ = strconv.ParseFloat(attr.Value, 64)
			cyIdx = i
		case "rx":
			rx, _ = strconv.ParseFloat(attr.Value, 64)
			rxIdx = i
		case "ry":
			ry, _ = strconv.ParseFloat(attr.Value, 64)
			ryIdx = i
		}
	}

	if cxIdx >= 0 && cyIdx >= 0 {
		tcx, tcy := m.TransformPoint(cx, cy)
		node.Attrs[cxIdx].Value = formatFloat(tcx)
		node.Attrs[cyIdx].Value = formatFloat(tcy)
		if rxIdx >= 0 {
			scaleX := math.Hypot(m.A, m.B)
			node.Attrs[rxIdx].Value = formatFloat(rx * scaleX)
		}
		if ryIdx >= 0 {
			scaleY := math.Hypot(m.C, m.D)
			node.Attrs[ryIdx].Value = formatFloat(ry * scaleY)
		}
	}
}

func applyMatrixToLine(node *XMLNode, m Matrix2D) {
	var x1, y1, x2, y2 float64
	var x1Idx, y1Idx, x2Idx, y2Idx = -1, -1, -1, -1

	for i, attr := range node.Attrs {
		switch attr.Name.Local {
		case "x1":
			x1, _ = strconv.ParseFloat(attr.Value, 64)
			x1Idx = i
		case "y1":
			y1, _ = strconv.ParseFloat(attr.Value, 64)
			y1Idx = i
		case "x2":
			x2, _ = strconv.ParseFloat(attr.Value, 64)
			x2Idx = i
		case "y2":
			y2, _ = strconv.ParseFloat(attr.Value, 64)
			y2Idx = i
		}
	}

	tx1, ty1 := m.TransformPoint(x1, y1)
	tx2, ty2 := m.TransformPoint(x2, y2)

	if x1Idx >= 0 {
		node.Attrs[x1Idx].Value = formatFloat(tx1)
	}
	if y1Idx >= 0 {
		node.Attrs[y1Idx].Value = formatFloat(ty1)
	}
	if x2Idx >= 0 {
		node.Attrs[x2Idx].Value = formatFloat(tx2)
	}
	if y2Idx >= 0 {
		node.Attrs[y2Idx].Value = formatFloat(ty2)
	}
}

func applyMatrixToPolygon(node *XMLNode, m Matrix2D) {
	for i, attr := range node.Attrs {
		if attr.Name.Local == "points" {
			nums := parseNumbers(attr.Value)
			var pairs []string
			for j := 0; j+1 < len(nums); j += 2 {
				tx, ty := m.TransformPoint(nums[j], nums[j+1])
				pairs = append(pairs, formatFloat(tx)+","+formatFloat(ty))
			}
			node.Attrs[i].Value = strings.Join(pairs, " ")
			break
		}
	}
}

func applyMatrixToTransformableNonGeometry(node *XMLNode, m Matrix2D) bool {
	transformIdx := -1
	for idx, attr := range node.Attrs {
		if attr.Name.Local == "transform" {
			transformIdx = idx
			break
		}
	}

	if m.IsIdentity() {
		if transformIdx >= 0 {
			node.Attrs = append(node.Attrs[:transformIdx], node.Attrs[transformIdx+1:]...)
			return true
		}
		return false
	}

	newTransformVal := m.ToSVG()
	if transformIdx >= 0 {
		if node.Attrs[transformIdx].Value != newTransformVal {
			node.Attrs[transformIdx].Value = newTransformVal
			return true
		}
		return false
	}

	node.Attrs = append(node.Attrs, xml.Attr{
		Name:  xml.Name{Local: "transform"},
		Value: newTransformVal,
	})
	return true
}

func serializeNode(w *bytes.Buffer, node *XMLNode, nsToPrefix map[string]string) {
	if len(node.Comment) > 0 {
		w.WriteString("<!--")
		w.Write(node.Comment)
		w.WriteString("-->")
		return
	}
	if len(node.Content) > 0 {
		_ = xml.EscapeText(w, node.Content)
		return
	}

	tag := node.XMLName.Local
	if prefix, ok := nsToPrefix[node.XMLName.Space]; ok && prefix != "" {
		tag = prefix + ":" + node.XMLName.Local
	}

	w.WriteByte('<')
	w.WriteString(tag)

	seenAttrs := make(map[string]bool)
	for _, attr := range node.Attrs {
		name := attr.Name.Local
		if prefix, ok := nsToPrefix[attr.Name.Space]; ok && prefix != "" {
			name = prefix + ":" + attr.Name.Local
		} else if attr.Name.Space == "xmlns" {
			name = "xmlns:" + attr.Name.Local
		}
		if seenAttrs[name] {
			continue
		}
		seenAttrs[name] = true

		w.WriteByte(' ')
		w.WriteString(name)
		w.WriteString(`="`)
		_ = xml.EscapeText(w, []byte(attr.Value))
		w.WriteByte('"')
	}

	if len(node.Children) == 0 {
		w.WriteString("/>")
		return
	}

	w.WriteByte('>')
	for _, child := range node.Children {
		serializeNode(w, child, nsToPrefix)
	}
	w.WriteString("</")
	w.WriteString(tag)
	w.WriteByte('>')
}
