package svg

import (
	"os"
	"strings"
	"testing"
)

func TestParseTransform(t *testing.T) {
	t.Run("matrix", func(t *testing.T) {
		m := ParseTransform("matrix(-1, 0, 0, 1, 270, 0)")
		if m.A != -1 || m.D != 1 || m.E != 270 {
			t.Errorf("Unexpected matrix parse: %+v", m)
		}
		x, y := m.TransformPoint(100, 50)
		if x != 170 || y != 50 {
			t.Errorf("Expected (170, 50), got (%v, %v)", x, y)
		}
	})

	t.Run("translate", func(t *testing.T) {
		m := ParseTransform("translate(242, 10)")
		x, y := m.TransformPoint(100, 50)
		if x != 342 || y != 60 {
			t.Errorf("Expected (342, 60), got (%v, %v)", x, y)
		}
	})

	t.Run("scale", func(t *testing.T) {
		m := ParseTransform("scale(-1, 1)")
		x, y := m.TransformPoint(100, 50)
		if x != -100 || y != 50 {
			t.Errorf("Expected (-100, 50), got (%v, %v)", x, y)
		}
	})
}

func TestTransformPathD(t *testing.T) {
	m := ParseTransform("matrix(-1, 0, 0, 1, 200, 0)")
	d := "m 50,30 c -10,12 -12,28 -4,42 z"
	out := TransformPathD(d, m)

	// Initial point 50 transformed: -50 + 200 = 150
	// Relative displacement dx=-10 vector transformed: -(-10) = 10
	if !strings.Contains(out, "150") {
		t.Errorf("Expected initial point to be 150, got: %s", out)
	}
	if !strings.Contains(out, "10") {
		t.Errorf("Expected relative dx to be inverted to 10, got: %s", out)
	}
}

func TestPreprocessSVG_BakesFlippedRiggedElement(t *testing.T) {
	input := `<svg xmlns="http://www.w3.org/2000/svg">
  <g id="layer_head">
    <g id="braid_seg_1" inkscape:label="Braid [Sway {range: 18}]" transform="matrix(-1,0,0,1,270,0)">
      <path id="p1" d="m 132,230 c -10,12 -12,28 -4,42 z" />
    </g>
  </g>
</svg>`

	out, err := PreprocessSVG([]byte(input))
	if err != nil {
		t.Fatalf("PreprocessSVG failed: %v", err)
	}

	outStr := string(out)

	// braid_seg_1 should have its transform attribute removed
	if strings.Contains(outStr, `transform="matrix(-1,0,0,1,270,0)"`) {
		t.Errorf("Expected transform attribute to be stripped from rigged group, got: %s", outStr)
	}

	// Path d should now be transformed: -132 + 270 = 138
	if !strings.Contains(outStr, "138") {
		t.Errorf("Expected path coordinates to be transformed to 138, got: %s", outStr)
	}
}

func TestPreprocessSVG_AvatarFiles(t *testing.T) {
	for _, file := range []string{"../../testdata/test_avatar.svg", "../../testdata/test_avatar_vectorcraft.svg"} {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read %s: %v", file, err)
		}
		out, err := PreprocessSVG(data)
		if err != nil {
			t.Fatalf("PreprocessSVG failed on %s: %v", file, err)
		}
		if len(out) == 0 {
			t.Errorf("Expected non-empty preprocessed SVG for %s", file)
		}
		_ = os.WriteFile("/home/mrp/.gemini/antigravity-ide/brain/115b14fa-1e84-4ce1-9919-d73ebbc333ac/scratch/preprocessed_"+strings.ReplaceAll(file, "../../testdata/", ""), out, 0644)
	}
}
