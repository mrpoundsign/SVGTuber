//go:build !cgo

package main

import (
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/server"
)

func runAppUI(srv *server.Server, cfgMgr *config.Manager, studioURL, overlayURL string, openStudio, _ bool) {
	runHeadlessLoop(srv, cfgMgr, studioURL, overlayURL, openStudio)
}
