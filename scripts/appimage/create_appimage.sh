#!/bin/bash

# Exit on error
set -e

# Check platform
platform=$(uname)

if [[ "$platform" == "Darwin" ]]; then
    echo "Running on macOS. Note that the AppImage created will only work on Linux systems."
    if ! command -v docker &> /dev/null; then
        echo "Docker Desktop for Mac is not installed. Please install it from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
elif [[ "$platform" == "Linux" ]]; then
    echo "Running on Linux. Proceeding with AppImage creation..."
else
    echo "This script is intended to run on macOS or Linux. Current platform: $platform"
    exit 1
fi

# Enable BuildKit
export DOCKER_BUILDKIT=1

BUILD_IMAGE_NAME="vader-appimage-builder"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Check and install Buildx if needed
if ! docker buildx version >/dev/null 2>&1; then
    echo "Installing Docker Buildx..."
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/buildx/releases/download/v0.13.1/buildx-v0.13.1.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
    chmod +x ~/.docker/cli-plugins/docker-buildx
fi

# Download appimagetool if not present
if [ ! -f "appimagetool" ]; then
    echo "Downloading appimagetool..."
    wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool
fi

# Delete any existing AppImage to avoid bloating the build
rm -f Vader-x86_64.AppImage

# Create build Dockerfile
echo "Creating build Dockerfile..."
cat > Dockerfile.build << 'EOF'
# syntax=docker/dockerfile:1
FROM ubuntu:20.04

# Install required dependencies
RUN apt-get update && apt-get install -y \
    libfuse2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EOF

# Create .dockerignore file
echo "Creating .dockerignore file..."
cat > .dockerignore << EOF
Dockerfile.build
.dockerignore
.git
.gitignore
.DS_Store
*~
*.swp
*.swo
*.tmp
*.bak
*.log
*.err
node_modules/
venv/
*.egg-info/
*.tox/
dist/
EOF

# Build Docker image without cache
echo "Building Docker image (no cache)..."
docker build --no-cache -t "$BUILD_IMAGE_NAME" -f Dockerfile.build .

# Create AppImage using local appimagetool
echo "Creating AppImage..."
docker run --rm --privileged -v "$(pwd):/app" "$BUILD_IMAGE_NAME" bash -c '
cd /app && \
rm -rf VaderApp.AppDir && \
mkdir -p VaderApp.AppDir/usr/bin VaderApp.AppDir/usr/lib VaderApp.AppDir/usr/share/applications && \
find . -maxdepth 1 ! -name VaderApp.AppDir ! -name "." ! -name ".." -exec cp -r {} VaderApp.AppDir/usr/bin/ \; && \
cp vader.png VaderApp.AppDir/ && \
echo "[Desktop Entry]" > VaderApp.AppDir/vader.desktop && \
echo "Name=Vader" >> VaderApp.AppDir/vader.desktop && \
echo "Comment=Open source AI code editor." >> VaderApp.AppDir/vader.desktop && \
echo "GenericName=Text Editor" >> VaderApp.AppDir/vader.desktop && \
echo "Exec=vader %F" >> VaderApp.AppDir/vader.desktop && \
echo "Icon=vader" >> VaderApp.AppDir/vader.desktop && \
echo "Type=Application" >> VaderApp.AppDir/vader.desktop && \
echo "StartupNotify=false" >> VaderApp.AppDir/vader.desktop && \
echo "StartupWMClass=Vader" >> VaderApp.AppDir/vader.desktop && \
echo "Categories=TextEditor;Development;IDE;" >> VaderApp.AppDir/vader.desktop && \
echo "MimeType=application/x-vader-workspace;" >> VaderApp.AppDir/vader.desktop && \
echo "Keywords=vader;" >> VaderApp.AppDir/vader.desktop && \
echo "Actions=new-empty-window;" >> VaderApp.AppDir/vader.desktop && \
echo "[Desktop Action new-empty-window]" >> VaderApp.AppDir/vader.desktop && \
echo "Name=New Empty Window" >> VaderApp.AppDir/vader.desktop && \
echo "Name[de]=Neues leeres Fenster" >> VaderApp.AppDir/vader.desktop && \
echo "Name[es]=Nueva ventana vacía" >> VaderApp.AppDir/vader.desktop && \
echo "Name[fr]=Nouvelle fenêtre vide" >> VaderApp.AppDir/vader.desktop && \
echo "Name[it]=Nuova finestra vuota" >> VaderApp.AppDir/vader.desktop && \
echo "Name[ja]=新しい空のウィンドウ" >> VaderApp.AppDir/vader.desktop && \
echo "Name[ko]=새 빈 창" >> VaderApp.AppDir/vader.desktop && \
echo "Name[ru]=Новое пустое окно" >> VaderApp.AppDir/vader.desktop && \
echo "Name[zh_CN]=新建空窗口" >> VaderApp.AppDir/vader.desktop && \
echo "Name[zh_TW]=開新空視窗" >> VaderApp.AppDir/vader.desktop && \
echo "Exec=vader --new-window %F" >> VaderApp.AppDir/vader.desktop && \
echo "Icon=vader" >> VaderApp.AppDir/vader.desktop && \
chmod +x VaderApp.AppDir/vader.desktop && \
cp VaderApp.AppDir/vader.desktop VaderApp.AppDir/usr/share/applications/ && \
echo "[Desktop Entry]" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Name=Vader - URL Handler" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Comment=Open source AI code editor." > VaderApp.AppDir/vader-url-handler.desktop && \
echo "GenericName=Text Editor" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Exec=vader --open-url %U" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Icon=vader" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Type=Application" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "NoDisplay=true" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "StartupNotify=true" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Categories=Utility;TextEditor;Development;IDE;" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "MimeType=x-scheme-handler/vader;" > VaderApp.AppDir/vader-url-handler.desktop && \
echo "Keywords=vader;" > VaderApp.AppDir/vader-url-handler.desktop && \
chmod +x VaderApp.AppDir/vader-url-handler.desktop && \
cp VaderApp.AppDir/vader-url-handler.desktop VaderApp.AppDir/usr/share/applications/ && \
echo "#!/bin/bash" > VaderApp.AppDir/AppRun && \
echo "HERE=\$(dirname \"\$(readlink -f \"\${0}\")\")" >> VaderApp.AppDir/AppRun && \
echo "export PATH=\${HERE}/usr/bin:\${PATH}" >> VaderApp.AppDir/AppRun && \
echo "export LD_LIBRARY_PATH=\${HERE}/usr/lib:\${LD_LIBRARY_PATH}" >> VaderApp.AppDir/AppRun && \
echo "exec \${HERE}/usr/bin/vader --no-sandbox \"\$@\"" >> VaderApp.AppDir/AppRun && \
chmod +x VaderApp.AppDir/AppRun && \
chmod -R 755 VaderApp.AppDir && \

# Strip unneeded symbols from the binary to reduce size
strip --strip-unneeded VaderApp.AppDir/usr/bin/vader

ls -la VaderApp.AppDir/ && \
ARCH=x86_64 ./appimagetool -n VaderApp.AppDir Vader-x86_64.AppImage
'

# Clean up
rm -rf VaderApp.AppDir .dockerignore appimagetool

echo "AppImage creation complete! Your AppImage is: Vader-x86_64.AppImage"
