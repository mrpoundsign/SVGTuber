//go:build cgo

package main

import (
	"os"

	"github.com/mrpoundsign/appinstaller/pkg/installerui"
)

func main() {
	spec := buildAppSpec()
	os.Exit(installerui.RunMain(spec, nil))
}
