#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-build}"

bundle_frontend() {
  if command -v npm &>/dev/null && [ -f "package.json" ]; then
    echo "==> Bundling frontend TypeScript..."
    npm run build
  fi
}

bundle_accessories() {
  echo "==> Bundling default accessories into build/accessories..."
  mkdir -p build/accessories
  if [ -d "testdata/accessories" ]; then
    cp -u testdata/accessories/*.svg build/accessories/ 2>/dev/null || cp testdata/accessories/*.svg build/accessories/
  fi
}

build_binary_linux() {
  echo "==> Building svgtuber binary..."
  mkdir -p build
  CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.0.4-dev -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'none') -X main.date=$(date -u +%Y-%m-%d)" -o build/svgtuber ./cmd/svgtuber
  echo "==> Successfully built build/svgtuber"
}

build_binary_windows() {
  echo "==> Building svgtuber.exe (Windows amd64)..."
  mkdir -p build
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.0.4-dev -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'none') -X main.date=$(date -u +%Y-%m-%d)" -o build/svgtuber.exe ./cmd/svgtuber
  echo "==> Successfully built build/svgtuber.exe"
}

case "$TARGET" in
  build)
    bundle_frontend
    bundle_accessories
    build_binary_linux
    ;;
  test)
    if command -v npm &>/dev/null && [ -f "package.json" ]; then
      echo "==> Running TypeScript unit tests..."
      npm test
    fi
    echo "==> Running Go unit tests..."
    go test -v -count=1 ./...
    ;;
  race)
    echo "==> Running tests with Go race detector..."
    go test -race ./...
    ;;
  vet)
    echo "==> Running go vet..."
    go vet ./...
    ;;
  windows)
    bundle_frontend
    bundle_accessories
    build_binary_windows
    ;;
  all)
    bundle_frontend
    bundle_accessories
    build_binary_linux
    build_binary_windows
    ;;
  lint)
    echo "==> Running golangci-lint-v2..."
    if command -v golangci-lint-v2 &>/dev/null; then
        golangci-lint-v2 run ./...
    elif command -v golangci-lint &>/dev/null; then
        golangci-lint run ./...
    else
        echo "Error: golangci-lint-v2 not found in PATH"
        exit 1
    fi
    echo "==> Lint complete"
    ;;
  fix)
    echo "==> Running go fix..."
    go fix ./...
    echo "==> Fix complete"
    ;;
  check)
    "$0" fix
    "$0" vet
    "$0" lint
    "$0" test
    "$0" all
    ;;
  run)
    "$0" build
    ./build/svgtuber -avatar testdata/test_avatar.svg
    ;;
  zip)
    "$0" windows
    echo "==> Creating Windows distribution zip..."
    (
      rm -f build/svgtuber_windows.zip
      cd build
      if command -v zip &>/dev/null; then
        zip -r svgtuber_windows.zip svgtuber.exe accessories/
      else
        python3 -c "import zipfile, os; z = zipfile.ZipFile('svgtuber_windows.zip', 'w'); z.write('svgtuber.exe'); [z.write(os.path.join(root, f)) for root, _, files in os.walk('accessories') for f in files]; z.close()"
      fi
    )
    echo "==> Created build/svgtuber_windows.zip"
    ;;
  clean)
    echo "==> Cleaning build artifacts..."
    rm -rf build/
    echo "==> Clean complete"
    ;;
  *)
    echo "Usage: $0 [build|windows|all|zip|test|race|vet|lint|fix|check|run|clean]"
    exit 1
    ;;
esac
