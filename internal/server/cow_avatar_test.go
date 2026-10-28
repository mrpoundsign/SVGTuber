package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

func TestCowAvatarRig(t *testing.T) {
	avatarPath, err := filepath.Abs("../../testdata/cow_avatar.svg")
	if err != nil {
		t.Fatalf("Resolving cow_avatar.svg: %v", err)
	}

	srv := New(0, avatarPath, NewHub(), tracking.NewEngine())

	recRig := httptest.NewRecorder()
	srv.handleRigJSON(recRig, httptest.NewRequest(http.MethodGet, "/rig.json", nil))
	if recRig.Code != http.StatusOK {
		t.Fatalf("Failed to serve rig: %d", recRig.Code)
	}

	var rigDef rig.RigDefinition
	if err := json.Unmarshal(recRig.Body.Bytes(), &rigDef); err != nil {
		t.Fatalf("Failed to unmarshal rig: %v", err)
	}

	t.Logf("Cow Avatar rigged elements count: %d", len(rigDef.Elements))
	for _, el := range rigDef.Elements {
		dTypes := make([]string, 0, len(el.Directives))
		for _, d := range el.Directives {
			dTypes = append(dTypes, d.Type)
		}
		t.Logf("  Element [%s] (%s): %v", el.ID, el.Label, dTypes)
	}

	exprs := ExtractExpressionsFromRig(&rigDef)
	t.Logf("Discovered Expressions in Cow: %v", exprs)
}
