#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-build}"

case "$TARGET" in
  build)
    echo "==> Building svgtuber binary..."
    CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.1.0-dev -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'none') -X main.date=$(date -u +%Y-%m-%d)" -o svgtuber ./cmd/svgtuber
    echo "==> Successfully built svgtuber"
    ;;
  test)
    echo "==> Running unit tests..."
    go test -v -count=1 ./...
    ;;
  vet)
    echo "==> Running go vet..."
    go vet ./...
    ;;
  windows)
    echo "==> Building svgtuber.exe (Windows amd64)..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.1.0-dev -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'none') -X main.date=$(date -u +%Y-%m-%d)" -o svgtuber.exe ./cmd/svgtuber
    echo "==> Successfully built svgtuber.exe"
    ;;
  all)
    "$0" build
    "$0" windows
    ;;
  check)
    "$0" vet
    "$0" test
    "$0" all
    ;;
  run)
    "$0" build
    ./svgtuber -avatar testdata/test_avatar.svg
    ;;
  *)
    echo "Usage: $0 [build|windows|all|test|vet|check|run]"
    exit 1
    ;;
esac
