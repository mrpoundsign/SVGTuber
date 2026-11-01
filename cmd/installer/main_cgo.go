//go:build cgo

package main

import (
	"os"

	"github.com/mrpoundsign/appinstaller/pkg/installerui"

	"github.com/mrpoundsign/SVGTuber/assets"
)

func main() {
	spec := buildAppSpec()
	os.Exit(installerui.RunMain(spec, assets.AppIcon))
}
