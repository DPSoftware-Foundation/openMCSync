const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
// exports.REMOTE_DISTRO_URL = 'https://helios-files.geekcorner.eu.org/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://cdn.damp11113.xyz/dmb/instances/example/distro.json' // for development only with vscode live share

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)


exports.DistroAPI = api