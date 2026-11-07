#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-all}"
VERSION="${VERSION:-0.0.9}"
VERSION="${VERSION#v}"

for dir in "$HOME/go/bin" "/usr/local/go/bin" "$HOME/.asdf/shims" "$HOME/.asdf/bin" "/home/linuxbrew/.linuxbrew/bin" "/home/linuxbrew/.linuxbrew/sbin"; do
  if [ -d "$dir" ] && [[ ":$PATH:" != *":$dir:"* ]]; then
    export PATH="$dir:$PATH"
  fi
done

bundle_frontend() {
  if [ -f "package.json" ]; then
    echo "==> Bundling frontend TypeScript..."
    if [ -d "node_modules/@esbuild/win32-x64" ] && [ ! -d "node_modules/@esbuild/linux-x64" ] && command -v cmd.exe &>/dev/null; then
      cmd.exe /c "npm run build"
    elif command -v npm &>/dev/null; then
      npm run build
    fi
  fi
}

bundle_accessories() {
  echo "==> Bundling default avatars & accessories into build/..."
  mkdir -p build/accessories
  for av in cow_avatar.svg robot_avatar.svg triangle_robot_avatar.svg; do
    [ -f "testdata/$av" ] && cp -f "testdata/$av" "build/$av"
  done
  if [ -d "testdata/accessories" ]; then
    cp -u testdata/accessories/*.svg build/accessories/ 2>/dev/null || cp testdata/accessories/*.svg build/accessories/
  fi
}

build_binary_linux() {
  echo "==> Building svgtuber binary (CGO_ENABLED=1)..."
  mkdir -p build
  CGO_ENABLED=1 go build -trimpath -ldflags "-s -w -X main.version=${VERSION} -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'none') -X main.date=$(date -u +%Y-%m-%d)" -o build/svgtuber ./cmd/svgtuber
  echo "==> Successfully built build/svgtuber"
}

build_binary_windows() {
  mkdir -p build
  local commit_hash
  commit_hash="$(git rev-parse --short HEAD 2>/dev/null || echo 'none')"
  local build_date
  build_date="$(date -u +%Y-%m-%d)"

  if command -v x86_64-w64-mingw32-windres &>/dev/null && [ -f "assets/icon.ico" ]; then
    echo "==> Compiling Windows icon resources (.syso)..."
    local rc_file="build/icon.rc"
    echo 'IDI_ICON1 ICON "../assets/icon.ico"' > "$rc_file"
    (cd build && x86_64-w64-mingw32-windres icon.rc -O coff -o ../cmd/svgtuber/rsrc_windows_amd64.syso)
    cp -f cmd/svgtuber/rsrc_windows_amd64.syso cmd/installer/rsrc_windows_amd64.syso
    rm -f "$rc_file"
  fi

  if [ -f "build/svgtuber.exe" ]; then
    rm -f "build/svgtuber.exe" 2>/dev/null || mv -f "build/svgtuber.exe" "build/svgtuber.exe.old" 2>/dev/null || true
  fi

  if command -v x86_64-w64-mingw32-gcc &>/dev/null; then
    echo "==> Building svgtuber.exe (Windows amd64, Fyne Mini UI CGO_ENABLED=1 + MinGW)..."
    CC=x86_64-w64-mingw32-gcc GOOS=windows GOARCH=amd64 CGO_ENABLED=1 \
      go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=${VERSION} -X main.commit=${commit_hash} -X main.date=${build_date} -extldflags '-static-libgcc'" \
      -o build/svgtuber.exe ./cmd/svgtuber
  elif [ "$(go env GOOS)" = "windows" ]; then
    echo "==> Building svgtuber.exe (Windows amd64, Fyne Mini UI CGO_ENABLED=1)..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=1 \
      go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=${VERSION} -X main.commit=${commit_hash} -X main.date=${build_date} -extldflags '-Wl,--subsystem,windows'" \
      -o build/svgtuber.exe ./cmd/svgtuber
  else
    echo "==> Building svgtuber.exe (Windows amd64, CGO_ENABLED=0 fallback)..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=${VERSION} -X main.commit=${commit_hash} -X main.date=${build_date}" \
      -o build/svgtuber.exe ./cmd/svgtuber
  fi
  echo "==> Successfully built build/svgtuber.exe"
}

clean_installer_payload() {
  local payload_dir="cmd/installer/payload"
  mkdir -p "$payload_dir"
  find "$payload_dir" -mindepth 1 ! -name 'placeholder.txt' -exec rm -rf {} + 2>/dev/null || true
  touch "$payload_dir/placeholder.txt"
}

build_installer_windows() {
  if [ ! -f "build/svgtuber.exe" ]; then
    build_binary_windows
  fi

  echo "==> Staging Windows payload for SVGTuber-Setup.exe..."
  local payload_dir="cmd/installer/payload"
  clean_installer_payload
  trap 'clean_installer_payload' RETURN

  mkdir -p "$payload_dir/accessories" "$payload_dir/docs"
  cp -f build/svgtuber.exe "$payload_dir/svgtuber.exe"
  [ -f "testdata/test_avatar.svg" ] && cp -f testdata/test_avatar.svg "$payload_dir/avatar.svg"
  for av in cow_avatar.svg robot_avatar.svg triangle_robot_avatar.svg; do
    [ -f "testdata/$av" ] && cp -f "testdata/$av" "$payload_dir/$av"
  done
  if [ -d "testdata/accessories" ]; then
    cp -f testdata/accessories/*.svg "$payload_dir/accessories/"
  fi
  if [ -d "docs" ]; then
    cp -f docs/*.md "$payload_dir/docs/" 2>/dev/null || true
  fi
  [ -f "LICENSE" ] && cp -f LICENSE "$payload_dir/LICENSE"
  [ -f "README.md" ] && cp -f README.md "$payload_dir/README.md"
  [ -f "CHANGELOG.md" ] && cp -f CHANGELOG.md "$payload_dir/CHANGELOG.md"

  mkdir -p build dist
  local setup_out="build/SVGTuber-Setup.exe"
  local dist_setup="dist/SVGTuber-v${VERSION}-windows-amd64-setup.exe"

  if command -v x86_64-w64-mingw32-gcc &>/dev/null; then
    echo "==> Building Fyne GUI installer SVGTuber-Setup.exe v${VERSION} (CGO_ENABLED=1 + MinGW)..."
    CC=x86_64-w64-mingw32-gcc CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
      go build -trimpath -ldflags="-H windowsgui -s -w -X main.AppVersion=${VERSION} -extldflags '-static-libgcc'" \
      -o "$setup_out" ./cmd/installer
  elif [ "$(go env GOOS)" = "windows" ] && command -v gcc &>/dev/null; then
    echo "==> Building Fyne GUI installer SVGTuber-Setup.exe v${VERSION} (CGO_ENABLED=1 + native gcc)..."
    CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
      go build -trimpath -ldflags="-H windowsgui -s -w -X main.AppVersion=${VERSION}" \
      -o "$setup_out" ./cmd/installer
  else
    echo "==> Building installer SVGTuber-Setup.exe v${VERSION} (CGO_ENABLED=0 fallback)..."
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
      go build -trimpath -ldflags="-s -w -X main.AppVersion=${VERSION}" \
      -o "$setup_out" ./cmd/installer
  fi

  cp -f "$setup_out" "$dist_setup"
  clean_installer_payload
  trap - RETURN
  echo "==> Successfully built $setup_out and $dist_setup"
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
  installer)
    bundle_frontend
    bundle_accessories
    build_binary_windows
    build_installer_windows
    ;;
  all)
    bundle_frontend
    bundle_accessories
    build_binary_linux
    build_binary_windows
    build_installer_windows
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
    clean_installer_payload
    rm -rf build/ dist/
    echo "==> Clean complete"
    ;;
  *)
    echo "Usage: $0 [build|windows|installer|all|zip|test|race|vet|lint|fix|check|run|clean]"
    exit 1
    ;;
esac
