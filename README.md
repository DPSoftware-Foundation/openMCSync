
# openMCSync Launcher
Based on [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) but more modern with contents checker.

# This project is use in private roleplay server before.

This project is closed source for content checker feature but now that project didn't pay any money for this modify version. So I think this feature is useful fo

## Development

This section details the setup of a basic developmentment environment.

### Getting Started

**System Requirements**

- nodejs v20

**Clone and Install Dependencies**
```console
> git clone https://github.com/dscalzi/HeliosLauncher.git
> cd HeliosLauncher
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