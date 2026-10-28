package mcp

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInitializeAndToolsList(t *testing.T) {
	serverInR, clientInW := io.Pipe()
	clientOutR, serverOutW := io.Pipe()

	srv := NewServer(serverInR, serverOutW)

	go func() {
		_ = srv.Run()
	}()

	clientReader := bufio.NewReader(clientOutR)

	// 1. Send Initialize request
	initReq := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}` + "\n"
	if _, err := clientInW.Write([]byte(initReq)); err != nil {
		t.Fatalf("failed to write init req: %v", err)
	}

	initLine, err := clientReader.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read init resp: %v", err)
	}

	var initResp JSONRPCResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(initLine)), &initResp); err != nil {
		t.Fatalf("failed to unmarshal init response: %v", err)
	}
	if initResp.Error != nil {
		t.Fatalf("unexpected init error: %v", initResp.Error)
	}

	initData, _ := json.Marshal(initResp.Result)
	var initRes InitializeResult
	if err := json.Unmarshal(initData, &initRes); err != nil {
		t.Fatalf("failed to unmarshal init result: %v", err)
	}
	if !strings.Contains(initRes.Instructions, "Universal Archetype-Agnostic Layer Naming Convention") {
		t.Errorf("expected InitializeResult.Instructions to contain naming convention guide, got: %s", initRes.Instructions)
	}

	// 1b. Send Resources List & Read requests
	resListReq := `{"jsonrpc":"2.0","id":10,"method":"resources/list","params":{}}` + "\n"
	if _, err := clientInW.Write([]byte(resListReq)); err != nil {
		t.Fatalf("failed to write resources/list req: %v", err)
	}
	resListLine, err := clientReader.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read resources/list resp: %v", err)
	}
	var resListResp JSONRPCResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(resListLine)), &resListResp); err != nil || resListResp.Error != nil {
		t.Fatalf("unexpected resources/list response: %v, err=%v", resListResp, err)
	}

	resReadReq := `{"jsonrpc":"2.0","id":11,"method":"resources/read","params":{"uri":"svgtuber://guides/naming-conventions"}}` + "\n"
	if _, err := clientInW.Write([]byte(resReadReq)); err != nil {
		t.Fatalf("failed to write resources/read req: %v", err)
	}
	resReadLine, err := clientReader.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read resources/read resp: %v", err)
	}
	var resReadResp JSONRPCResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(resReadLine)), &resReadResp); err != nil || resReadResp.Error != nil {
		t.Fatalf("unexpected resources/read response: %v, err=%v", resReadResp, err)
	}

	// 2. Send Tools List request
	listReq := `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` + "\n"
	if _, err := clientInW.Write([]byte(listReq)); err != nil {
		t.Fatalf("failed to write list req: %v", err)
	}

	listLine, err := clientReader.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read list resp: %v", err)
	}

	var listResp JSONRPCResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(listLine)), &listResp); err != nil {
		t.Fatalf("failed to unmarshal list response: %v", err)
	}
	if listResp.Error != nil {
		t.Fatalf("unexpected list error: %v", listResp.Error)
	}

	// Verify tools list
	toolsData, _ := json.Marshal(listResp.Result)
	var listRes ToolsListResult
	if err := json.Unmarshal(toolsData, &listRes); err != nil {
		t.Fatalf("failed to unmarshal tools data: %v", err)
	}

	if len(listRes.Tools) < 6 {
		t.Errorf("expected at least 6 tools, got %d", len(listRes.Tools))
	}

	// Close pipes to cleanly exit server
	_ = clientInW.Close()
	_ = serverOutW.Close()
}

func TestPlanRigGenericArchetypes(t *testing.T) {
	archetypes := []struct {
		name       string
		components []string
	}{
		{"cow", []string{"horns", "ears", "bell", "muzzle", "blush"}},
		{"dragon", []string{"horns", "wings", "tail", "snout"}},
		{"otter", []string{"whiskers", "ears", "muzzle", "arms"}},
		{"humanoid", []string{"hair", "bangs", "blush"}},
	}

	for _, tc := range archetypes {
		bp, err := PlanRig(tc.name, "semi-realism", tc.components, 800, 800)
		if err != nil {
			t.Fatalf("unexpected error planning %s rig: %v", tc.name, err)
		}
		if bp.Archetype != tc.name {
			t.Errorf("expected archetype '%s', got '%s'", tc.name, bp.Archetype)
		}
		if len(bp.Layers) < 5 {
			t.Errorf("expected >= 5 layers for %s, got %d", tc.name, len(bp.Layers))
		}
	}
}

func TestCleanSVGIDs(t *testing.T) {
	cowPath := filepath.Join("..", "..", "testdata", "cow_avatar.svg")
	tempOut := filepath.Join(t.TempDir(), "cow_cleaned.svg")
	res, err := CleanSVGIDs(cowPath, tempOut)
	if err != nil {
		t.Fatalf("failed to clean svg ids: %v", err)
	}
	if res.CleanedCount == 0 {
		t.Log("no mangled IDs needed cleaning")
	}

	// Auto rig and hierarchically structure flat shapes into <g> groups
	_, err = AutoRig(tempOut, tempOut, AutoRigOptions{OverwriteExisting: true})
	if err != nil {
		t.Fatalf("failed to auto rig cow: %v", err)
	}

	// Validate after auto-rigging
	report, err := ValidateSVGRig(tempOut)
	if err != nil {
		t.Fatalf("failed to validate cleaned cow svg: %v", err)
	}
	if !report.IsValid {
		t.Errorf("expected valid svg after auto-rigging, got issues: %v", report.Issues)
	}
}

func TestInspectRig(t *testing.T) {
	robotPath := filepath.Join("..", "..", "testdata", "robot_avatar.svg")
	cowPath := filepath.Join("..", "..", "testdata", "cow_avatar.svg")

	// Robot inspection
	robotRep, err := InspectRig(robotPath)
	if err != nil {
		t.Fatalf("failed to inspect robot rig: %v", err)
	}
	if robotRep.RiggedCount < 10 {
		t.Errorf("expected >= 10 rigged layers in robot, got %d", robotRep.RiggedCount)
	}

	// Cow inspection
	cowRep, err := InspectRig(cowPath)
	if err != nil {
		t.Fatalf("failed to inspect cow rig: %v", err)
	}
	if cowRep.RiggedCount < 10 {
		t.Errorf("expected >= 10 rigged layers in cow, got %d", cowRep.RiggedCount)
	}
}

func TestApplyDirectives(t *testing.T) {
	cowPath := filepath.Join("..", "..", "testdata", "cow_avatar.svg")
	tempOut := filepath.Join(t.TempDir(), "cow_tagged.svg")

	tags := []ElementTag{
		{ID: "Top_Accessory_Left_Group", Directive: "[Sway {pivot: bottom; range: 8; stiffness: 0.28}]"},
		{ID: "Chest_Accessory_Group", Directive: "[Follow {yaw: 10}] [Sway {pivot: top; range: 16}]"},
	}

	res, err := ApplyDirectives(cowPath, tags, tempOut)
	if err != nil {
		t.Fatalf("failed to apply directives: %v", err)
	}
	if res.ModifiedCount == 0 {
		t.Error("expected modified count > 0")
	}

	// Verify resulting SVG is valid
	report, err := ValidateSVGRig(tempOut)
	if err != nil {
		t.Fatalf("failed to validate tagged svg: %v", err)
	}
	if !report.IsValid {
		t.Errorf("expected valid svg after directive tagging, got issues: %v", report.Issues)
	}
}

func TestAutoRig(t *testing.T) {
	testSVG := `<svg viewBox="0 0 800 800">
  <g id="Head"><circle cx="400" cy="400" r="100"/></g>
  <path id="Left_Ear" d="M 0 0"/>
  <path id="Right_Ear" d="M 0 0"/>
  <path id="Mouth_Open" d="M 0 0"/>
  <path id="Open_Tongue" d="M 0 0"/>
  <path id="Mouth_Resting" d="M 0 0"/>
  <path id="Left_Eye_White" d="M 0 0"/>
  <path id="Pupil_Left" d="M 0 0"/>
  <path id="Eyes_Closed" d="M 0 0"/>
</svg>`
	tempInput := filepath.Join(t.TempDir(), "unrigged.svg")
	tempOut := filepath.Join(t.TempDir(), "auto_rigged.svg")

	if err := os.WriteFile(tempInput, []byte(testSVG), 0644); err != nil {
		t.Fatalf("failed to write temp input: %v", err)
	}

	res, err := AutoRig(tempInput, tempOut, AutoRigOptions{})
	if err != nil {
		t.Fatalf("failed to auto rig: %v", err)
	}
	if res.TaggedCount < 8 {
		t.Errorf("expected at least 8 auto-tagged elements, got %d", res.TaggedCount)
	}

	// Verify directives on sensitive elements
	taggedData, err := os.ReadFile(tempOut)
	if err != nil {
		t.Fatalf("failed to read tagged svg: %v", err)
	}
	content := string(taggedData)
	if !strings.Contains(content, `Left_Eye_White [Hide {when: blinkL &gt; 0.4}]`) && !strings.Contains(content, `Left_Eye_White [Hide {when: blinkL > 0.4}]`) {
		t.Errorf("Left_Eye_White missing hide directive: %s", content)
	}
	if !strings.Contains(content, `Open_Tongue [Show {when: isMouthOpen}]`) {
		t.Errorf("Open_Tongue missing mouthOpen directive: %s", content)
	}
	if !strings.Contains(content, `Mouth_Resting [Hide {when: isMouthOpen || isSmiling}]`) {
		t.Errorf("Mouth_Resting missing resting directive: %s", content)
	}
}

func TestGenerateStudioWidget(t *testing.T) {
	cowPath := filepath.Join("..", "..", "testdata", "cow_avatar.svg")
	tempOut := filepath.Join(t.TempDir(), "cow_studio_widget.html")

	outPath, err := GenerateStudioWidget(cowPath, "Cow VTuber", tempOut)
	if err != nil {
		t.Fatalf("failed to generate studio widget: %v", err)
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read generated widget: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "<svg") {
		t.Error("generated widget does not contain embedded SVG")
	}
	if !strings.Contains(content, "slider-yaw") {
		t.Error("generated widget missing slider-yaw")
	}
	if !strings.Contains(content, "Cow VTuber") {
		t.Error("generated widget missing title")
	}
}

func TestValidateSVGRig(t *testing.T) {
	testAvatar := filepath.Join("..", "..", "testdata", "robot_avatar.svg")
	report, err := ValidateSVGRig(testAvatar)
	if err != nil {
		t.Fatalf("failed to validate svg: %v", err)
	}

	if !report.IsValid {
		t.Errorf("expected robot_avatar.svg to be valid, got issues: %v", report.Issues)
	}

	if report.RiggedElements < 10 {
		t.Errorf("expected at least 10 rigged elements, found %d", report.RiggedElements)
	}

	cowAvatar := filepath.Join("..", "..", "testdata", "cow_avatar.svg")
	cowReport, err := ValidateSVGRig(cowAvatar)
	if err != nil {
		t.Fatalf("failed to validate cow svg: %v", err)
	}
	if !cowReport.IsValid {
		t.Errorf("expected cow_avatar.svg to be valid, got issues: %v", cowReport.Issues)
	}
	if len(cowReport.Issues) != 0 {
		t.Errorf("expected 0 validation issues on cow_avatar.svg, got: %v", cowReport.Issues)
	}

	// Verify geometric warnings catch floating head, out-of-bounds spot, and closed-top arm seams
	flawedSVG := `<svg viewBox="0 0 800 800">
  <g id="Body_Group" data-name="Body_Group [Idle {breathe: 0.02; pivot: bottom}]">
    <path id="Body" d="M 200 500 L 600 500 L 600 800 L 200 800 Z" fill="#fff" stroke="#000"/>
    <path id="Body_Spot_Left" d="M 150 550 L 280 550 L 280 700 L 150 700 Z" fill="#222"/>
    <path id="Arm_Left" d="M 250 560 L 250 700 L 300 700 L 300 560 Z" fill="#fff" stroke="#000"/>
  </g>
  <g id="Head_Group" data-name="Head_Group [Follow {yaw: 15; pivot: center}]">
    <path id="Head" d="M 250 200 L 550 200 L 550 480 L 250 480 Z" fill="#fff" stroke="#000"/>
  </g>
</svg>`
	flawedPath := filepath.Join(t.TempDir(), "flawed.svg")
	if err := os.WriteFile(flawedPath, []byte(flawedSVG), 0644); err != nil {
		t.Fatalf("failed to write flawed svg: %v", err)
	}
	flawedRep, err := ValidateSVGRig(flawedPath)
	if err != nil {
		t.Fatalf("failed to validate flawed svg: %v", err)
	}
	if len(flawedRep.Issues) < 3 {
		t.Errorf("expected at least 3 geometric warnings (floating head, out-of-bounds spot, closed arm seam), got %d: %v", len(flawedRep.Issues), flawedRep.Issues)
	}
}

func TestSimulateMotion(t *testing.T) {
	in := MotionSimulationInput{
		Yaw:       15,
		Pitch:     -10,
		Roll:      5,
		MouthOpen: 0.8,
	}

	sim := SimulateMotion(in)
	if !sim.IsStable {
		t.Error("expected simulation to be physically stable")
	}

	if len(sim.Elements) < 5 {
		t.Errorf("expected at least 5 simulated elements, got %d", len(sim.Elements))
	}
}

func TestRobotAvatarRigAndWidget(t *testing.T) {
	robotPath := filepath.Join("..", "..", "testdata", "robot_avatar.svg")
	if _, err := os.Stat(robotPath); err != nil {
		t.Skip("robot_avatar.svg not present")
	}

	tempOut := filepath.Join(t.TempDir(), "robot_cleaned.svg")
	if _, err := CleanSVGIDs(robotPath, tempOut); err != nil {
		t.Fatalf("failed to clean robot svg ids: %v", err)
	}

	autoRes, err := AutoRig(tempOut, tempOut, AutoRigOptions{OverwriteExisting: true})
	if err != nil {
		t.Fatalf("failed to auto-rig robot avatar: %v", err)
	}
	if autoRes.TaggedCount < 15 {
		t.Errorf("expected >= 15 rigged groups in robot avatar, got %d", autoRes.TaggedCount)
	}

	report, err := ValidateSVGRig(tempOut)
	if err != nil {
		t.Fatalf("failed to validate robot avatar: %v", err)
	}
	if !report.IsValid || len(report.Issues) > 0 {
		t.Errorf("expected robot_avatar.svg to have 0 validation issues, got: %v", report.Issues)
	}

	tempWidget := filepath.Join(t.TempDir(), "robot_studio_widget.html")
	if _, err := GenerateStudioWidget(tempOut, "Industrial Robot VTuber", tempWidget); err != nil {
		t.Fatalf("failed to generate robot studio widget: %v", err)
	}
}

func TestTriangleRobotAvatarRigAndWidget(t *testing.T) {
	triRobotPath := filepath.Join("..", "..", "testdata", "triangle_robot_avatar.svg")
	if _, err := os.Stat(triRobotPath); err != nil {
		t.Skip("triangle_robot_avatar.svg not present")
	}

	tempOut := filepath.Join(t.TempDir(), "triangle_robot_cleaned.svg")
	if _, err := CleanSVGIDs(triRobotPath, tempOut); err != nil {
		t.Fatalf("failed to clean triangle robot svg ids: %v", err)
	}

	autoRes, err := AutoRig(tempOut, tempOut, AutoRigOptions{OverwriteExisting: true})
	if err != nil {
		t.Fatalf("failed to auto-rig triangle robot avatar: %v", err)
	}
	if autoRes.TaggedCount < 15 {
		t.Errorf("expected >= 15 rigged groups in triangle robot avatar, got %d", autoRes.TaggedCount)
	}

	report, err := ValidateSVGRig(tempOut)
	if err != nil {
		t.Fatalf("failed to validate triangle robot avatar: %v", err)
	}
	if !report.IsValid || len(report.Issues) > 0 {
		t.Errorf("expected triangle_robot_avatar.svg to have 0 validation issues, got: %v", report.Issues)
	}

	tempWidget := filepath.Join(t.TempDir(), "triangle_robot_studio_widget.html")
	if _, err := GenerateStudioWidget(tempOut, "Delta-Head Robot VTuber", tempWidget); err != nil {
		t.Fatalf("failed to generate triangle robot studio widget: %v", err)
	}
}

func TestAllAvatarsValidateZeroIssues(t *testing.T) {
	avatars := []string{
		"cow_avatar.svg",
		"robot_avatar.svg",
		"triangle_robot_avatar.svg",
	}
	for _, name := range avatars {
		p := filepath.Join("..", "..", "testdata", name)
		rep, err := ValidateSVGRig(p)
		if err != nil {
			t.Fatalf("validate %s: %v", name, err)
		}
		if !rep.IsValid || len(rep.Issues) > 0 {
			t.Errorf("expected %s to have 0 validation issues, got: %+v", name, rep.Issues)
		}
	}
}
