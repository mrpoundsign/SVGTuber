package main

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
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

	"github.com/mrpoundsign/SVGTuber/assets"
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/server"
	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
)

const defaultReleasesURL = "https://github.com/mrpoundsign/SVGTuber/releases"

func runAppUI(srv *server.Server, cfgMgr *config.Manager, logSink *AppLogSink, studioURL, overlayURL string, openStudio, headless bool) {
	if headless {
		runHeadlessLoop(srv, cfgMgr, studioURL, overlayURL, openStudio)
		return
	}

	curVer := currentNormalizedVersion()
	fyneApp := fyneapp.NewWithID("com.github.mrpoundsign.svgtuber")
	fyneApp.Settings().SetTheme(installerui.NewObsidianTheme())
	fyneApp.SetIcon(assets.AppIcon)

	w := fyneApp.NewWindow("SVGTuber v" + curVer + " — Vector VTuber Engine")
	w.SetIcon(assets.AppIcon)
	w.Resize(fyne.NewSize(560, 560))
	w.CenterOnScreen()

	// Header section
	titleLabel := widget.NewLabelWithStyle(
		"SVGTuber v"+curVer,
		fyne.TextAlignLeading,
		fyne.TextStyle{Bold: true},
	)
	formatStatusText := func(streamer bool) string {
		if streamer {
			return "● Server Running (🛡️ Streamer Mode: URLs Hidden)"
		}
		return "● Server Running (" + studioURL + ")"
	}
	// Streamer Mode Privacy Toggle button in Header
	var streamerBtn *widget.Button
	formatStreamerBtnText := func(enabled bool) string {
		if enabled {
			return "🛡️ Streamer Mode: ON"
		}
		return "🛡️ Streamer Mode: OFF"
	}

	initialStreamer := cfgMgr != nil && cfgMgr.GetStreamerMode()
	statusLabel := widget.NewLabelWithStyle(
		formatStatusText(initialStreamer),
		fyne.TextAlignLeading,
		fyne.TextStyle{Italic: true},
	)

	var applyStreamerUI func(enabled bool)
	streamerBtn = widget.NewButton(formatStreamerBtnText(initialStreamer), func() {
		next := true
		if cfgMgr != nil {
			next = !cfgMgr.GetStreamerMode()
			_ = cfgMgr.SetStreamerMode(next)
		}
		srv.BroadcastStreamerMode(next)
		if applyStreamerUI != nil {
			applyStreamerUI(next)
		}
	})
	if initialStreamer {
		streamerBtn.Importance = widget.SuccessImportance
	}

	headerRow := container.NewBorder(
		nil,
		nil,
		container.NewHBox(titleLabel, statusLabel),
		streamerBtn,
	)

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

	activePort := srv.Port()
	if cfgMgr != nil {
		activePort = cfgMgr.GetPort()
	}
	portEntry := widget.NewEntry()
	portEntry.SetPlaceHolder(strconv.Itoa(config.DefaultPort))
	portEntry.SetText(strconv.Itoa(activePort))

	portStatusLabel := widget.NewLabel("")
	savePortBtn := widget.NewButtonWithIcon("Save Port", theme.ConfirmIcon(), func() {
		p, err := strconv.Atoi(strings.TrimSpace(portEntry.Text))
		if err != nil || p <= 0 || p > 65535 {
			portStatusLabel.SetText("⚠️ Port must be 1..65535")
			return
		}
		if cfgMgr != nil {
			if err := cfgMgr.SetPort(p); err != nil {
				portStatusLabel.SetText(fmt.Sprintf("⚠️ %v", err))
				return
			}
		}
		activePort = p
		if streamdeck.IsPluginInstalled(srv.StreamDeckPluginsDir()) {
			_, _ = streamdeck.InstallPluginWithPort(srv.StreamDeckPluginsDir(), p)
		}
		if cfgMgr != nil && cfgMgr.GetStreamerMode() {
			portStatusLabel.SetText("✓ Saved port (restart SVGTuber to rebind)")
		} else {
			portStatusLabel.SetText(fmt.Sprintf("✓ Saved port %d (restart SVGTuber to rebind)", p))
		}
	})
	portRow := container.NewBorder(
		nil, nil,
		widget.NewLabel("Server Port:"),
		savePortBtn,
		portEntry,
	)

	// Live Connected Studios & Overlays indicators
	formatStudioConnText := func(count int) string {
		if count > 0 {
			return fmt.Sprintf("🟢 Connected Studios: %d", count)
		}
		return "⚪ Connected Studios: 0"
	}
	formatOverlayConnText := func(count int) string {
		if count > 0 {
			return fmt.Sprintf("🟢 Connected Overlays: %d", count)
		}
		return "⚪ Connected Overlays: 0"
	}

	studioConnLabel := widget.NewLabelWithStyle(
		formatStudioConnText(srv.ConnectedStudioCount()),
		fyne.TextAlignLeading,
		fyne.TextStyle{Bold: true},
	)
	overlayConnLabel := widget.NewLabelWithStyle(
		formatOverlayConnText(srv.ConnectedOverlayCount()),
		fyne.TextAlignLeading,
		fyne.TextStyle{Bold: true},
	)
	liveConnRow := container.NewGridWithColumns(2, studioConnLabel, overlayConnLabel)

	quickLaunchSection := container.NewVBox(
		widget.NewLabelWithStyle("Quick Launch & OBS Browser Source:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		liveConnRow,
		openStudioBtn,
		container.NewGridWithColumns(2, copyOBSBtn, openOBSBtn),
		portRow,
		portStatusLabel,
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

	// Elgato Stream Deck Plugin Section
	sdStatusLabel := widget.NewLabel("")
	sdStatusLabel.Wrapping = fyne.TextWrapWord

	var sdInstallBtn *widget.Button
	refreshStreamDeckUI := func(justInstalledPath string) {
		st := streamdeck.CheckPluginStatus(srv.StreamDeckPluginsDir())
		if !st.Installed {
			sdStatusLabel.SetText("Stream Deck Plugin: Not installed (Bundled: v" + st.BundledVersion + ")")
			if sdInstallBtn != nil {
				sdInstallBtn.SetText("Install Elgato Stream Deck Plugin (v" + st.BundledVersion + ")")
				sdInstallBtn.Importance = widget.HighImportance
				sdInstallBtn.Refresh()
			}
			return
		}
		if st.NeedsUpdate {
			sdStatusLabel.SetText(fmt.Sprintf("⬆ Stream Deck Plugin update available: v%s -> v%s", st.InstalledVersion, st.BundledVersion))
			if sdInstallBtn != nil {
				sdInstallBtn.SetText("Update Elgato Stream Deck Plugin to v" + st.BundledVersion)
				sdInstallBtn.Importance = widget.HighImportance
				sdInstallBtn.Refresh()
			}
			return
		}
		if justInstalledPath != "" {
			if cfgMgr != nil && cfgMgr.GetStreamerMode() {
				sdStatusLabel.SetText("✓ Stream Deck Plugin v" + st.InstalledVersion + " installed (restart Stream Deck app to load)")
			} else {
				sdStatusLabel.SetText(fmt.Sprintf("✓ Stream Deck Plugin v%s installed (port %d) to %s (restart Stream Deck app to load)", st.InstalledVersion, activePort, justInstalledPath))
			}
		} else {
			sdStatusLabel.SetText("✓ Stream Deck Plugin v" + st.InstalledVersion + " installed (up to date)")
		}
		if sdInstallBtn != nil {
			sdInstallBtn.SetText("Reinstall Elgato Stream Deck Plugin (v" + st.BundledVersion + ")")
			sdInstallBtn.Importance = widget.MediumImportance
			sdInstallBtn.Refresh()
		}
	}

	sdInstallBtn = widget.NewButtonWithIcon("Install Elgato Stream Deck Plugin", theme.DownloadIcon(), func() {
		installedPath, err := streamdeck.InstallPluginWithPort(srv.StreamDeckPluginsDir(), activePort)
		if err != nil {
			sdStatusLabel.SetText(fmt.Sprintf("⚠️ Stream Deck plugin install failed: %v", err))
			return
		}
		refreshStreamDeckUI(installedPath)
	})
	refreshStreamDeckUI("")

	streamDeckSection := container.NewVBox(
		widget.NewLabelWithStyle("Elgato Stream Deck Integration:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		sdStatusLabel,
		sdInstallBtn,
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

	// Server Activity Log Section (Live Connections + Log Count + Latest Event + Open Log File)
	logFilePath := ""
	if logSink != nil {
		logFilePath = logSink.FilePath()
	}
	formatLogSummary := func(studios, overlays int, count int64, lastLine string, streamer bool) string {
		if streamer {
			return fmt.Sprintf("Studios: %d  •  Overlays: %d  •  Log Entries: %d  •  [Details hidden in Streamer Mode]", studios, overlays, count)
		}
		if lastLine == "" {
			return fmt.Sprintf("Studios: %d  •  Overlays: %d  •  Log Entries: %d", studios, overlays, count)
		}
		return fmt.Sprintf("Studios: %d  •  Overlays: %d  •  Log Entries: %d  •  Latest: %s", studios, overlays, count, lastLine)
	}
	logCountLabel := widget.NewLabel(formatLogSummary(
		srv.ConnectedStudioCount(),
		srv.ConnectedOverlayCount(),
		logSink.Count(),
		logSink.LastLine(),
		initialStreamer,
	))
	logCountLabel.Truncation = fyne.TextTruncateEllipsis

	logPathLabel := widget.NewLabelWithStyle(
		"Log File: "+logFilePath,
		fyne.TextAlignLeading,
		fyne.TextStyle{Monospace: true},
	)
	logPathLabel.Truncation = fyne.TextTruncateEllipsis

	openLogFileBtn := widget.NewButtonWithIcon("Open Log File", theme.DocumentIcon(), func() {
		if logFilePath != "" {
			go openFileInOS(logFilePath)
		}
	})
	openLogDirBtn := widget.NewButtonWithIcon("Open Log Folder", theme.FolderOpenIcon(), func() {
		if logFilePath != "" {
			_ = server.OpenDirectory(filepath.Dir(logFilePath))
		}
	})

	logSection := container.NewVBox(
		widget.NewLabelWithStyle("Server Activity Log:", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		logCountLabel,
		logPathLabel,
		container.NewGridWithColumns(2, openLogFileBtn, openLogDirBtn),
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
		streamDeckSection,
		widget.NewSeparator(),
		logSection,
		widget.NewSeparator(),
		updateSection,
	))

	w.SetContent(container.NewPadded(container.NewBorder(nil, footer, nil, nil, body)))
	w.SetCloseIntercept(func() {
		shutdownServer(srv)
		w.Close()
		fyneApp.Quit()
	})

	applyStreamerUI = func(curS bool) {
		if curS {
			avatarDirLabel.SetText("Folder: [Hidden in Streamer Mode]")
			logPathLabel.SetText("Log File: [Hidden in Streamer Mode]")
			settingsLabel.SetText("[Path Hidden in Streamer Mode]")
			streamerBtn.Importance = widget.SuccessImportance
		} else {
			avatarDirLabel.SetText("Folder: " + srv.AvatarDir())
			logPathLabel.SetText("Log File: " + logFilePath)
			settingsLabel.SetText(settingsInfo)
			streamerBtn.Importance = widget.MediumImportance
		}
		curStudios := srv.ConnectedStudioCount()
		curOverlays := srv.ConnectedOverlayCount()
		studioConnLabel.SetText(formatStudioConnText(curStudios))
		overlayConnLabel.SetText(formatOverlayConnText(curOverlays))
		logCountLabel.SetText(formatLogSummary(curStudios, curOverlays, logSink.Count(), logSink.LastLine(), curS))
		streamerBtn.SetText(formatStreamerBtnText(curS))
		streamerBtn.Refresh()
		statusLabel.SetText(formatStatusText(curS))
		portEntry.Password = curS
		portEntry.Refresh()
	}
	applyStreamerUI(initialStreamer)

	// Keep avatar, streamer mode, connected clients, and live log count synced
	stopSync := make(chan struct{})
	defer close(stopSync)
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		lastAvatar := srv.CurrentAvatar()
		lastDir := srv.AvatarDir()
		lastStreamer := initialStreamer
		lastStudios := srv.ConnectedStudioCount()
		lastOverlays := srv.ConnectedOverlayCount()
		lastLogCount := logSink.Count()
		for {
			select {
			case <-stopSync:
				return
			case <-ticker.C:
				curA := srv.CurrentAvatar()
				curD := srv.AvatarDir()
				curS := cfgMgr != nil && cfgMgr.GetStreamerMode()
				curStudios := srv.ConnectedStudioCount()
				curOverlays := srv.ConnectedOverlayCount()
				curLogs := logSink.Count()
				if curA != lastAvatar || curD != lastDir || curS != lastStreamer || curStudios != lastStudios || curOverlays != lastOverlays || curLogs != lastLogCount {
					lastAvatar = curA
					lastDir = curD
					lastStreamer = curS
					lastStudios = curStudios
					lastOverlays = curOverlays
					lastLogCount = curLogs
					fyne.Do(func() {
						avatarFileLabel.SetText("Active Avatar: " + curA)
						applyStreamerUI(curS)
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
