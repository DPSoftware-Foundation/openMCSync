
# openMCSync Launcher
Based on [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) but more modern with contents checker.

# This project is use in private roleplay server before.

While the content checker feature of this project was initially closed source, the lack of ongoing funding for this modified version has led us to believe it would be highly beneficial to make it open source. We think this feature could be incredibly useful for anyone needing to manage and control client-related content.

## Development

This section details the setup of a basic developmentment environment.

### Getting Started

**System Requirements**

- nodejs v20

**Clone and Install Dependencies**
```console
> git clone https://github.com/DPSoftware-Foundation/openMCSync.git
> cd openMCSync
> npm install
```

**Launch Application**
```console
> npm start
```

**Build Installers**

To build for your current platform.

```console
> npm run dist
```

Build for a specific platform.

| Platform    | Command              |
| ----------- | -------------------- |
| Windows x64 | `npm run dist:win`   |
| macOS       | `npm run dist:mac`   |
| Linux x64   | `npm run dist:linux` |

Builds for macOS may not work on Windows/Linux and vice-versa.
