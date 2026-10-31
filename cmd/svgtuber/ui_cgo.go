//go:build cgo

package main

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"fyne.io/fyne/v2"
	fyneapp "fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/mrpoundsign/appinstaller/pkg/installerui"
	"github.com/mrpoundsign/appinstaller/pkg/updater"
	"github.com/mrpoundsign/appinstaller/pkg/updaterui"

	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/server"
)

const defaultReleasesURL = "https://github.com/mrpoundsign/SVGTuber/releases"

func runAppUI(srv *server.Server, cfgMgr *config.Manager, studioURL, overlayURL string, openStudio, headless bool) {
	if headless {
		runHeadlessLoop(srv, cfgMgr, studioURL, overlayURL, openStudio)
		return
	}

	curVer := currentNormalizedVersion()
	fyneApp := fyneapp.NewWithID("com.github.mrpoundsign.svgtuber")
	fyneApp.Settings().SetTheme(installerui.NewObsidianTheme())

	w := fyneApp.NewWindow("SVGTuber v" + curVer + " — Vector VTuber Engine")
	w.Resize(fyne.NewSize(560, 420))
	w.CenterOnScreen()

	// Header section
	titleLabel := widget.NewLabelWithStyle(
		"SVGTuber v"+curVer,
		fyne.TextAlignLeading,
		fyne.TextStyle{Bold: true},
	)
	statusLabel := widget.NewLabelWithStyle(
		"● Server Running ("+studioURL+")",
		fyne.TextAlignTrailing,
		fyne.TextStyle{Italic: true},
	)
	headerRow := container.NewBorder(nil, nil, titleLabel, statusLabel)

	// Quick Launch buttons (Studio & OBS Overlay)
	openStudioBtn := widget.NewButtonWithIcon("Open Studio Control Page", theme.HomeIcon(), func() {
		go openBrowser(studioURL)
	})
	openStudioBtn.Importance = widget.HighImportance

	var copyOBSBtn *widget.Button
	copyOBSBtn = widget.NewButtonWithIcon("Copy OBS Overlay URL", theme.ContentCopyIcon(), func() {
		fyneApp.Clipboard().SetContent(overlayURL)
		copyOBSBtn.SetText("✓ Copied OBS URL!")
		go func() {
			time.Sleep(1500 * time.Millisecond)
			fyne.Do(func() {
				copyOBSBtn.SetText("Copy OBS Overlay URL")
			})
		}()
	})

	openOBSBtn := widget.NewButtonWithIcon("Open Overlay", theme.VisibilityIcon(), func() {
		go openBrowser(overlayURL)
	})

	quickLaunchSection := container.NewVBox(
		widget.NewLabelWithStyle("Quick Launch & OBS Browser Source:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		openStudioBtn,
		container.NewGridWithColumns(2, copyOBSBtn, openOBSBtn),
	)

	// Avatar & Workspace Folder Section
	avatarFileLabel := widget.NewLabel("Active Avatar: " + srv.CurrentAvatar())
	avatarFileLabel.Truncation = fyne.TextTruncateEllipsis

	avatarDirLabel := widget.NewLabelWithStyle(
		"Folder: "+srv.AvatarDir(),
		fyne.TextAlignLeading,
		fyne.TextStyle{Monospace: true},
	)
	avatarDirLabel.Truncation = fyne.TextTruncateEllipsis

	openAvatarDirBtn := widget.NewButtonWithIcon("Open Avatar Directory", theme.FolderOpenIcon(), func() {
		_ = server.OpenDirectory(srv.AvatarDir())
	})

	reloadRigBtn := widget.NewButtonWithIcon("Reload Avatar Rig", theme.ViewRefreshIcon(), func() {
		_, _ = srv.ReloadRig()
	})

	avatarSection := container.NewVBox(
		widget.NewLabelWithStyle("Avatar Workspace:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		avatarFileLabel,
		avatarDirLabel,
		container.NewGridWithColumns(2, openAvatarDirBtn, reloadRigBtn),
	)

	// Version Check & Release Link Section
	chk := updater.NewChecker("mrpoundsign", "SVGTuber")
	versionStatusLabel := widget.NewLabel("Current Version: v" + curVer + " — Checking for updates...")
	versionStatusLabel.Wrapping = fyne.TextWrapWord

	relURL, _ := url.Parse(defaultReleasesURL)
	releaseLink := widget.NewHyperlink("GitHub Releases ↗", relURL)

	var latestRel *updater.ReleaseInfo
	var installUpdateBtn *widget.Button
	var checkUpdateBtn *widget.Button

	openUpdateDialog := func() {
		if latestRel == nil {
			return
		}
		updaterui.ShowUpdateDialog(updaterui.DialogConfig{
			Parent:         w,
			AppName:        "SVGTuber",
			CurrentVersion: curVer,
			Release:        latestRel,
			Checker:        chk,
			OnQuitApp: func() {
				shutdownServer(srv)
				fyneApp.Quit()
			},
		})
	}

	installUpdateBtn = widget.NewButtonWithIcon("Install Update", theme.DownloadIcon(), openUpdateDialog)
	installUpdateBtn.Importance = widget.HighImportance
	installUpdateBtn.Hide()

	performVersionCheck := func(manual bool) {
		if checkUpdateBtn != nil {
			checkUpdateBtn.Disable()
		}
		versionStatusLabel.SetText("Current Version: v" + curVer + " — Checking GitHub Releases...")

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			rel, isNewer, err := chk.CheckLatest(ctx, curVer)
			fyne.Do(func() {
				if checkUpdateBtn != nil {
					checkUpdateBtn.Enable()
				}
				if err != nil {
					versionStatusLabel.SetText(fmt.Sprintf("Current Version: v%s (Could not check updates: %v)", curVer, err))
					return
				}
				latestRel = rel
				if rel.HTMLURL != "" {
					if u, pErr := url.Parse(rel.HTMLURL); pErr == nil {
						releaseLink.SetURL(u)
						releaseLink.SetText("View v" + rel.Version + " Release on GitHub ↗")
					}
				}
				if isNewer {
					versionStatusLabel.SetText(fmt.Sprintf("⬆ New version available: v%s (Current: v%s)", rel.Version, curVer))
					installUpdateBtn.SetText("Update to v" + rel.Version + "...")
					installUpdateBtn.Show()
					if manual {
						openUpdateDialog()
					}
				} else {
					versionStatusLabel.SetText("✓ Up to date! Running latest version (v" + curVer + ").")
					installUpdateBtn.Hide()
				}
			})
		}()
	}

	checkUpdateBtn = widget.NewButtonWithIcon("Check for Updates", theme.SearchIcon(), func() {
		performVersionCheck(true)
	})

	updateButtonsRow := container.NewHBox(checkUpdateBtn, installUpdateBtn, layout.NewSpacer(), releaseLink)
	updateSection := container.NewVBox(
		widget.NewLabelWithStyle("Version & Updates:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		versionStatusLabel,
		updateButtonsRow,
	)

	// Footer with Settings Path & Quit button
	settingsInfo := ""
	if cfgMgr != nil {
		if p, err := cfgMgr.ConfigPath(); err == nil {
			settingsInfo = p
		}
	}
	settingsLabel := widget.NewLabelWithStyle(settingsInfo, fyne.TextAlignLeading, fyne.TextStyle{Italic: true})
	settingsLabel.Truncation = fyne.TextTruncateEllipsis

	quitBtn := widget.NewButtonWithIcon("Quit SVGTuber", theme.LogoutIcon(), func() {
		shutdownServer(srv)
		w.Close()
		fyneApp.Quit()
	})
	quitBtn.Importance = widget.DangerImportance

	footer := container.NewVBox(
		widget.NewSeparator(),
		container.NewBorder(nil, nil, nil, quitBtn, settingsLabel),
	)

	body := container.NewVScroll(container.NewVBox(
		headerRow,
		widget.NewSeparator(),
		quickLaunchSection,
		widget.NewSeparator(),
		avatarSection,
		widget.NewSeparator(),
		updateSection,
	))

	w.SetContent(container.NewPadded(container.NewBorder(nil, footer, nil, nil, body)))
	w.SetCloseIntercept(func() {
		shutdownServer(srv)
		w.Close()
		fyneApp.Quit()
	})

	// Keep avatar labels synced if user switches avatar inside Studio Web UI
	stopSync := make(chan struct{})
	defer close(stopSync)
	go func() {
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()
		var lastAvatar, lastDir string
		for {
			select {
			case <-stopSync:
				return
			case <-ticker.C:
				curA := srv.CurrentAvatar()
				curD := srv.AvatarDir()
				if curA != lastAvatar || curD != lastDir {
					lastAvatar = curA
					lastDir = curD
					fyne.Do(func() {
						avatarFileLabel.SetText("Active Avatar: " + curA)
						avatarDirLabel.SetText("Folder: " + curD)
					})
				}
			}
		}
	}()

	if openStudio {
		go openBrowser(studioURL)
	}

	// Automatically check for new versions on startup
	performVersionCheck(false)

	w.ShowAndRun()
}
