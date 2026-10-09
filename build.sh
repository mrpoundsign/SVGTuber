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
  check)
    "$0" vet
    "$0" test
    "$0" build
    ;;
  run)
    "$0" build
    ./svgtuber -avatar testdata/test_avatar.svg
    ;;
  *)
    echo "Usage: $0 [build|test|vet|check|run]"
    exit 1
    ;;
esac
