package web

import "embed"

// StaticFS contains all embedded static assets for the overlay and studio web interfaces.
//
//go:embed overlay/* studio/*
var StaticFS embed.FS
