//go:build !cgo

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/mrpoundsign/appinstaller/pkg/installer"
)

func main() {
	var (
		silentFlag    = flag.Bool("silent", false, "Run installation or uninstallation without GUI")
		uninstallFlag = flag.Bool("uninstall", false, "Uninstall the application")
		purgeFlag     = flag.Bool("purge", false, "Remove user configuration and data during silent uninstall")
		dirFlag       = flag.String("dir", "", "Target installation directory")
		waitPIDFlag   = flag.Int("wait-pid", 0, "Wait for the specified process ID to exit before installing")
		relaunchFlag  = flag.Bool("relaunch", false, "Launch application after installation completes")
	)
	flag.Parse()
	_ = silentFlag

	spec := buildAppSpec()
	isUninstall := *uninstallFlag
	if exeBase := strings.ToLower(filepath.Base(os.Args[0])); strings.HasPrefix(exeBase, "uninstall") {
		isUninstall = true
	}

	targetDir := strings.TrimSpace(*dirFlag)
	if targetDir == "" {
		if isUninstall {
			if selfExe, err := os.Executable(); err == nil && selfExe != "" {
				targetDir = filepath.Dir(selfExe)
			}
		}
		if targetDir == "" {
			targetDir = installer.DefaultInstallDir(spec.AppName)
		}
	}

	ins := installer.NewInstaller(spec)
	ctx := context.Background()

	if isUninstall {
		if err := ins.Uninstall(ctx, targetDir, *purgeFlag, nil); err != nil {
			fmt.Fprintf(os.Stderr, "%s uninstall error: %v\n", spec.AppName, err)
			os.Exit(1)
		}
		return
	}

	selected := make(map[string]bool, len(spec.OptionalComponents))
	for _, c := range spec.OptionalComponents {
		selected[c.ID] = c.DefaultOn
	}

	opts := installer.Options{
		InstallDir:              targetDir,
		CreateStartMenuShortcut: true,
		CreateDesktopShortcut:   false,
		SelectedComponents:      selected,
		WaitPID:                 *waitPIDFlag,
	}
	if _, err := ins.Install(ctx, opts, nil); err != nil {
		fmt.Fprintf(os.Stderr, "%s install error: %v\n", spec.AppName, err)
		os.Exit(1)
	}
	if *relaunchFlag && spec.BinaryName != "" {
		exePath := filepath.Join(targetDir, spec.BinaryName)
		cmd := exec.Command(exePath)
		cmd.Dir = targetDir
		_ = cmd.Start()
	}
}
