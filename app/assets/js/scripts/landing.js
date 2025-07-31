/*
 * Script for landing.ejs
 */
// Requirements
const axios = require('axios');
const { exec } = require('child_process');
const _ = require('lodash');
const fs = require('fs');
const { hashElement } = require('folder-hash');
const https = require('https'); // or 'http'
const zip_extract = require('extract-zip');
const crypto = require('crypto');
const { pipeline } = require('stream/promises'); // Node.js 16+

const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder');

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.style.width = percent + "%"
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind avatar overlay button.
document.getElementById('settingsbtn').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if (authUser.type != "dpcloudev") {
            if (authUser.uuid != null){
                document.getElementById('avatarContainer').style.backgroundImage = `url('https://cdn.damp11113.xyz/cache/mc_body_img/${authUser.uuid}?side=right')`
            }
        } else {
            document.getElementById('avatarContainer').style.backgroundImage = ``
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0
    console.log(statuses)
    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const DPCloudevstatusToHex = function(status) {
    switch (status) {
        case 'green':
            return '#00FF00'; // Green
        case 'yellow':
            return '#FFFF00'; // Yellow
        case 'red':
            return '#FF0000'; // Red
        case 'grey':
            return '#808080'; // Grey
        default:
            return '#000000'; // Default to black for unknown statuses
    }
}

const DPCloudevgetColorFromStatus = (status) => {
    switch (status) {
        case 200:
            return 'green';
        case 500:
            return 'red';
        case 429: // Example for too many requests
        case 503: // Example for service unavailable
            return 'yellow';
        default:
            return 'grey'; // Default for unexpected status codes
    }
};

const refreshDPCloudevStatuses = async function(){
    loggerLanding.info('Refreshing DPCloudev Statuses..')

    let status = 'grey'
    let tooltipNonEssentialHTML = ''
    const servicesToInclude = ['API', 'CDN', 'Dashboard'];

    const response = await axios.get("https://status.damp11113.xyz/")
    console.log(response)
    let statuses
    if (response.status === 200) {
        // Convert the data into the desired array format, filtering for specific services
        statuses = servicesToInclude.map(serviceName => ({
            service: serviceName,
            status: DPCloudevgetColorFromStatus(response.data.Service[serviceName.toLowerCase()]),
            name: serviceName // Assuming 'name' is the same as the 'service'
        }));
    } else {
        loggerLanding.warn('Unable to refresh DPCloudev service status.')
        statuses = [
            { "service": "api", "status": "red", "name": "API" },
            { "service": "cdn", "status": "red", "name": "CDN" },
            { "service": "dashboard", "status": "red", "name": "Dashboard" }
        ]
    }
    
    greenCount = 0
    greyCount = 0

    
    for (let i=0; i<statuses.length; i++){
        const service = statuses[i]
        console.log(service)

        const tooltipHTML = `<div class="dpcloudevStatusContainer">
            <span class="mojangStatusIcon" style="color: ${DPCloudevstatusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        tooltipNonEssentialHTML += tooltipHTML
        
        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }
    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('dpcloudevStatusContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('DPCloudev_status_icon').style.color = MojangRestAPI.statusToHex(status)
}


const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

//refreshMojangStatuses()
//refreshDPCloudevStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
// let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// let DPCloudevStatusListener = setInterval(() => refreshDPCloudevStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

function waitForAllow(commandlist, desc) {
    const overlayDetail = document.getElementById("overlayDetail");
    overlayDetail.style.display = "block"; // Make the textarea visible
    overlayDetail.value = ""; // Clear any existing content

    const overlayDesc2 = document.getElementById("overlayDesc2");
    overlayDesc2.style.visibility = "visible"; // Make the textarea visible
    overlayDesc2.textContent = ""; // Clear any existing content

    commandlist.forEach((command) => {
        overlayDetail.value += command + "\n"; // Add each command to a new line in the textarea
    });

    overlayDesc2.textContent = desc;

    setOverlayContent(
        Lang.queryJS('landing.pre_command.warningTitle'),
        Lang.queryJS('landing.pre_command.warningText'),
        Lang.queryJS('landing.pre_command.allow'),
        Lang.queryJS('landing.pre_command.deny')
    )
    setOverlayHandler(null);
    toggleOverlay(true, true, 'overlayContent', true);
    toggleLaunchArea(false);

    return new Promise((resolve) => {
        const trueButton = document.getElementById('overlayAcknowledge');
        const falseButton = document.getElementById('overlayDismiss');

        const handleChoice = (choice) => {
            resolve(choice);
            // Remove event listeners after choice is made
            trueButton.removeEventListener('click', handleTrue);
            falseButton.removeEventListener('click', handleFalse);
        };

        const handleTrue = () => handleChoice(true);
        const handleFalse = () => handleChoice(false);

        trueButton.addEventListener('click', handleTrue);
        falseButton.addEventListener('click', handleFalse);
    });
}

async function getFileChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const fd = fs.createReadStream(filePath);
        const hash = crypto.createHash('sha256');

        fd.on('end', () => {
            hash.end();
            const outhash = hash.read();
            resolve(outhash.toString('hex'));
        });

        fd.on('error', (err) => {
            reject(err);
        });

        fd.pipe(hash);
    });
}

async function downloadGameFileAsync(tempPath, gameFileURL) {
    try {
        const response = await new Promise((resolve, reject) => {
            https.get(gameFileURL, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
                } else {
                    resolve(res);
                }
            }).on('error', reject);
        });

        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        // Track progress
        response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes) {
                const percent = Math.trunc((downloadedBytes / totalBytes) * 100);
                setDownloadPercentage(percent);
            }
        });

        const fileStream = fs.createWriteStream(tempPath);

        await pipeline(response, fileStream); // async stream pipeline

        setDownloadPercentage(100); // Ensure 100% on finish
        loggerLaunchSuite.info('Game file downloaded successfully.');
        setLaunchDetails("waiting for checksums...");

    } catch (err) {
        loggerLaunchSuite.error(`Download failed: ${err.message}`);
        showLaunchFailure(
            Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'),
            Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
        );
        throw err;
    }
}

const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

async function calculateSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}

async function download_game_file(serv, part) {
    var game_file = serv?.rawServer?.game_file;
    var temp_path = path.join(ConfigManager.getLauncherDirectory(), `temp_${part}.zip`);

    var gamefile = game_file.files?.[part]
    console.log('Game file:', gamefile)
    var remove_folder_before_update = gamefile?.remove_folder_before_update;
    var content_folder = path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer(), part);

    // Remove the folder before update if needed.
    console.log(remove_folder_before_update)
    if (remove_folder_before_update) {
        try {
            loggerLaunchSuite.info(`Removing content folder: ${content_folder}`);
            await fs.promises.rm(content_folder, { recursive: true, force: true });
            loggerLaunchSuite.info('Content folder removed successfully.');
        } catch (err) {
            loggerLaunchSuite.error('Error deleting content.', err)
            loggerLanchSuite.error("Maybe it not existed.")
            return
        }
    } else {
        loggerLaunchSuite.warn('Temporary content does not exist, skipping deletion.');
    }

    if (game_file !== undefined) {
        loggerLaunchSuite.info('Downloading ${part} file.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        await downloadGameFileAsync(temp_path,
            gamefile?.url,
        );
    }

    remote.getCurrentWindow().setProgressBar(-1)

    // checksums temp.zip to SHA256
    if (game_file !== undefined) {
        loggerLaunchSuite.info('Validating game file checksums.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
        try {
            const checksum = await getFileChecksum(temp_path);
            console.log('Game file SHA256:', checksum);
            //showLaunchFailure("Debug!!! Here is output", checksum);
            if (checksum != gamefile?.sha256) {
                showLaunchFailure("Your Wifi or Ethernet Suck!", "The file is corrupted. Or maybe... contact@damp11113.xyz for help.");
                return
            }
        } catch (error) {
            console.error('Error calculating checksum:', error);
            showLaunchFailure("Error calculating checksum", error.message);
        }
    }

    // extract temp.zip to instance directory
    if (game_file !== undefined) {
        loggerLaunchSuite.info('Extracting game files.')
        setLaunchDetails("Extracting game files, please wait...")
        try {
            await zip_extract(temp_path, { dir: path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer()) });
            loggerLaunchSuite.info('Game files extracted successfully.');
        } catch (err) {
            loggerLaunchSuite.error('Error during game file extraction.', err)
            showLaunchFailure("Extract file failed", "please try again...")
            return
        }
    }

    // Remove the temp zip file.
    if (fs.existsSync(temp_path)) {
        try {
            fs.unlinkSync(temp_path);
            loggerLaunchSuite.info('Temporary game file zip deleted successfully.');
        } catch (err) {
            loggerLaunchSuite.error('Error deleting temporary game file zip.', err)
            showLaunchFailure("Delete temp file failed", "please try again...")
            return
        }
    } else {
        loggerLaunchSuite.warn('Temporary game file zip does not exist, skipping deletion.');
    }

    // update version
    ConfigManager.setContentVersion(ConfigManager.getSelectedServer(), part, gamefile?.version);
    ConfigManager.save();
}

async function contentChecker(serv, ProgressBar) {
    loggerLaunchSuite.info('Running content checker for server:', serv.rawServer.id);

    const needcheck = serv?.rawServer?.game_file.content_checker;

    var allow_external_content;
    var update_if_checksum_mismatch;
    var check_folder;

    var fonudexternalContent = {}
    var foundMissingContent = {}
    
    if (needcheck && Object.keys(needcheck).length > 0) {
        for (const [contentType, data] of Object.entries(needcheck)) {
            loggerLaunchSuite.info(`Checking content type: ${contentType}`);
            allow_external_content = data.allow_external_content;
            update_if_checksum_mismatch = data.update_if_checksum_mismatch;
            scan_subfolder = data.scan_subfolder || false;

            check_folder = path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer(), contentType);

            // Get all entries (files and folders) in the directory
            const allEntries = await fs.promises.readdir(check_folder);

            // Filter out directories, keeping only files
            if (scan_subfolder) {

            } else {
                var files = [];
                for (const entry of allEntries) {
                    const entryPath = path.join(check_folder, entry);
                    try {
                        const stats = await fs.promises.stat(entryPath);
                        if (stats.isFile()) {
                            files.push(entry);
                        }
                    } catch (err) {
                        loggerLaunchSuite.warn(`Could not stat ${entryPath}: ${err.message}`);
                        // Optionally handle errors, e.g., if file was deleted between readdir and stat
                    }
                }
            }

            const expectedNames = Object.keys(data.sha256);

            // Identify files present in the folder but not in the expected list.
            const extraFiles = files.filter(f => !expectedNames.includes(f));
            // Identify files expected but not found in the folder.
            const missingFiles = expectedNames.filter(f => !files.includes(f));

            // if there are extra files, we need to handle them.
            if (extraFiles.length > 0) {
                loggerLaunchSuite.warn(`Extra files found in ${check_folder}:`, extraFiles);
                if (!allow_external_content) {
                    fonudexternalContent[contentType] = extraFiles;
                }
            }

            // if there are missing files, we need to handle them.
            if (missingFiles.length > 0) {
                loggerLaunchSuite.warn(`Missing files in ${check_folder}:`, missingFiles);
                if (update_if_checksum_mismatch) {
                    loggerLaunchSuite.info(`Updating missing files in ${check_folder}.`);
                    // If we are allowed to update missing files, we can proceed with the download.
                    // Here you would implement the logic to download the missing files.
                    // For now, we will just return an error.
                    download_game_file(serv, contentType).then(() => {
                        loggerLaunchSuite.info(`Missing files in ${check_folder} downloaded successfully.`);
                    }).catch(err => {
                        loggerLaunchSuite.error(`Error downloading missing files in ${check_folder}:`, err);
                        showLaunchFailure(
                            Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'),
                            Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
                        );
                    });
                }
                loggerLaunchSuite.error(`Missing files in ${check_folder} and update not allowed.`);
                // If we are not allowed to update missing files, we need to handle the error.
                foundMissingContent[contentType] = missingFiles;
            }

             // Initialize progress to 0% before starting checksum verification.
            if (ProgressBar) ProgressBar(0);

            const totalFiles = files.length;

            var has_missing_checksums = false;
            // Iterate through each file to calculate and verify its checksum.
            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                const filePath = path.join(check_folder, file); // Construct the full file path.
                const hash = await calculateSha256(filePath); // Calculate the SHA256 hash of the file.
                const expected = data.sha256[file]; // Get the expected checksum for this file.

                // Calculate the current progress percentage.
                // Ensure it doesn't exceed 100% and is a whole number for cleaner display.
                const progress = Math.min(100, Math.floor(((i + 1) / totalFiles) * 100));
                // Report the current progress to the ProgressBar function.
                if (ProgressBar) ProgressBar(progress);

                // Compare the calculated hash with the expected hash.
                if (hash !== expected) {
                    loggerLaunchSuite.warn(`Checksum mismatch for file: ${file}. Expected: ${expected}, Found: ${hash}`);
                }
            }

            if (has_missing_checksums && update_if_checksum_mismatch) {
                loggerLaunchSuite.info(`Checksums mismatch in ${check_folder}, updating files.`);
                // If checksums mismatch and we are allowed to update, we can proceed with the download.
                // Here you would implement the logic to download the files.
                // For now, we will just return an error.
                download_game_file(serv, contentType).then(() => {
                    loggerLaunchSuite.info(`Files in ${check_folder} updated successfully.`);
                }).catch(err => {
                    loggerLaunchSuite.error(`Error updating files in ${check_folder}:`, err);
                    showLaunchFailure(
                        Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'),
                        Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
                    );
                });
            }
        }
    }
    console.log(fonudexternalContent)
    // successfully if no found external content or missing content.
    var isSuccess = Object.keys(fonudexternalContent).length === 0 && Object.keys(foundMissingContent).length === 0;

    if (isSuccess) {
        loggerLaunchSuite.info('Content check completed successfully, no issues found.');
        return {
            success: true,
        }
    } else {
        return {
            success: false,
            externalContent: fonudexternalContent,
            missingContent: foundMissingContent
        }
    }
}

async function isFolderEmpty(folderPath) {
    try {
        const files = await fs.promises.readdir(folderPath);
        return files.length === 0;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // The folder does not exist, so it can be considered "empty" in a sense,
            // or you might want to handle this as a specific error depending on your needs.
            console.log(`Folder "${folderPath}" does not exist.`);
            return true; // Or throw an error, or return false, based on your logic
        }
        // Other errors (e.g., permission denied)
        console.error(`Error checking folder "${folderPath}":`, error);
        throw error; // Re-throw the error for further handling
    }
}

async function dlAsync(login = true, skip_check=false, skip_accessibleDate=false) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    // check accessibleDate
    // if (serv?.rawServer?.accessibleDate !== undefined && !skip_accessibleDate) {
    //     // check if current local timestamp is >= accessibleDate
    //     const currentTimestamp = Date.now().getTime();
    //     if (currentTimestamp >= serv.rawServer.accessibleDate) {
    //         loggerLaunchSuite.warn('Server is not accessible yet, waiting for accessible date.')
    //         showLaunchFailure("You can't access this server yet!", `This server will be accessible on ${new Date(serv.rawServer.accessibleDate).toLocaleString()}.`)
    //         return
    //     }
    // }

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }


    // check if has pre command

    let platform = os.platform()
    let allow_pre_command;

    let pre_command = serv?.rawServer?.pre_command?.[platform]

    if (pre_command !== undefined) {
        allow_pre_command = await waitForAllow(pre_command, serv?.rawServer?.pre_command?.description);
        toggleOverlay(false)
        const overlayDesc2 = document.getElementById("overlayDesc2");
        overlayDesc2.style.visibility = "hidden"; // Make the textarea visible
        overlayDesc2.value = ""; // Clear any existing content
    } else {
        allow_pre_command = false;
    }

    if (allow_pre_command) {
        // Initialize an array to hold the compiled commands
        const commandsToExecute = [];

        if (platform === "win32") {
            commandsToExecute.push("@echo off");
        } 

        pre_command.forEach((commandTemplate) => {
            // Compile the command template
            const compiled = _.template(commandTemplate);
            console.log(ConfigManager.launcherDir);
            const command = compiled({ launcherDir: ConfigManager.getLauncherDirectory() });

            // Push the compiled command to the array
            commandsToExecute.push(command);
        });

        commandsToExecute.push("exit");

        // Define a temporary file path
        let tempFilePath;
        if (platform === "win32") {
            tempFilePath = path.join(os.tmpdir(), 'temp_command.bat'); // Windows batch file
        } else {
            tempFilePath = path.join(os.tmpdir(), 'temp_command.sh'); // Unix shell script
        }

        // Create the command file and write all commands into it
        fs.writeFileSync(tempFilePath, commandsToExecute.join('\n'));

        // Make the file executable on Unix-based systems
        if (platform === 'linux' || platform === 'darwin') {
            execSync(`chmod +x ${tempFilePath}`);
        }

        // Execute the temporary command file based on the OS
        if (platform === 'win32') {
            exec(`start cmd.exe /k "${tempFilePath}"`, { stdio: 'inherit' });
        } else if (platform === 'darwin') {
            exec(`open -a Terminal "${tempFilePath}"`, { stdio: 'inherit' });
        } else if (platform === 'linux') {
            exec(`xterm -e "${tempFilePath}"`, { stdio: 'inherit' });
        }

        // Optionally, delete the temporary file after execution
        // fs.unlinkSync(tempFilePath);
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    // download file
    const isInstanceEmpty = await isFolderEmpty(path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer()));

    if (isInstanceEmpty) {
        loggerLaunchSuite.info('Instance folder is empty, downloading game file.')
        // If the instance folder is empty, we need to download the game file.
        // create folder
        if (!fs.existsSync(path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer()))) {
            fs.mkdirSync(path.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer()), { recursive: true });
            loggerLaunchSuite.info('Created instance directory.');
        } else {
            loggerLaunchSuite.info('Instance directory already exists, skipping creation.');
        }

        // download game file
        if (serv?.rawServer?.game_file !== undefined) {
            loggerLaunchSuite.info('Downloading game file.')
            setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
            setLaunchPercentage(0)
            try {
                // download all file in "files"
                content = serv?.rawServer?.game_file?.files;
                if (content && Object.keys(content).length > 0) {
                    for (const [file, data] of Object.entries(content)) {
                        await download_game_file(serv, file);
                    }
                } else {
                    loggerLaunchSuite.warn('No game file found, skipping download.')
                    showLaunchFailure(Lang.queryJS('landing.dlAsync.noGameFileFoundTitle'), Lang.queryJS('landing.dlAsync.noGameFileFoundText'))
                    return
                }
                
            } catch (err) {
                loggerLaunchSuite.error('Error during game file download.', err)
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
                return
            }
        } else {
            loggerLaunchSuite.warn('No game file found, skipping download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.noGameFileFoundTitle'), Lang.queryJS('landing.dlAsync.noGameFileFoundText'))
            return
        }
    } else {
        loggerLaunchSuite.info('Instance folder is not empty, checking content version.')
        // check content version
        if (serv?.rawServer?.game_file?.files !== undefined) {
            loggerLaunchSuite.info('Checking content version.')
            setLaunchDetails("Checking content version, please wait...")
            try {
                content = serv?.rawServer?.game_file?.files;
                if (content && Object.keys(content).length > 0) {
                    for (const [file, data] of Object.entries(content)) {
                        const current_version = ConfigManager.getContentVersion(ConfigManager.getSelectedServer(), file);
                        const mod_version = data.version;
                        if (current_version !== mod_version) {
                            loggerLaunchSuite.info(`Content version mismatch for ${file}. Current: ${current_version}, Expected: ${mod_version}`);
                            // If the content version does not match, we need to download the game file.
                            await download_game_file(serv, file);
                        }
                    }
                } else {
                    loggerLaunchSuite.warn('No game file found, skipping download.')
                    showLaunchFailure("No game file found", "Please check your server configuration or contact support.")
                    return
                }
            } catch (err) {
                loggerLaunchSuite.error('Error during content version check.', err)
                showLaunchFailure("Error during content version check", err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
                return
            }
        } else {
            loggerLaunchSuite.warn('No content version found, skipping check.')
            showLaunchFailure(Lang.queryJS("landing.dlAsync.noGameFileFoundTitle"), Lang.queryJS('landing.dlAsync.noGameFileFoundText'))
            return
        }
    }

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // verify mods
    if (!skip_check) {
        loggerLaunchSuite.info('Running content check.')
        setLaunchDetails("Running content check, please wait...")
        const contentCheckResult = await contentChecker(serv, (percent) => {
            setLaunchPercentage(percent)
        });
        
        if (!contentCheckResult.success) {
            loggerLaunchSuite.warn('Content check found issues:', contentCheckResult);
            
            // if found external content, show a warning. (convert to string)
            if (Object.keys(contentCheckResult.externalContent).length > 0) {
                let externalContentStr = '';
                for (const [contentType, files] of Object.entries(contentCheckResult.externalContent)) {
                    externalContentStr += `${contentType}: ${files.join(', ')}\n`;
                }
                loggerLaunchSuite.warn('Found external content:', externalContentStr);
                showLaunchFailure("External content found", `The following external content was found:\n${externalContentStr}\nPlease check the console for more details.`);
                return;
            }
        }
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }
            

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0


// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = true

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews() {

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        console.log('News Articles:', newsArr)
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }
}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index) {
    console.log('Displaying article:', articleObject, 'at index', index)
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleFeedServerIcon.innerHTML = `<img src="${articleObject.feedIcon}" alt="icon of feed server" style="width: 50%; height: auto;">`
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews() {

    const distroData = await DistroAPI.getDistribution();
    if (!distroData.rawDistribution.rcf) {
        loggerLanding.debug('No RCF feed provided.');
        return null;
    }

    const promise = new Promise((resolve, reject) => {

        const newsFeed = distroData.rawDistribution.rcf;
        $.ajax({
            url: newsFeed,
            dataType: 'json', // Specify that we expect JSON data
            success: (data) => {
                const feedInfo = data.info; // General feed info
                const items = data.feeds; // Content items (array)
                const articles = [];
                const feed_server_icon_url = data.image.icon;

                for (let i = 0; i < items.length; i++) {
                    const el = items[i];

                    // Resolve date
                    const date = new Date(el.public_date * 1000).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'
                    });

                    // Resolve comments count if available in insights
                    let comments = el.insights?.comments?.count || '0';
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's');

                    // Resolve content (if summary is provided in text or HTML)
                    let content = el.summary?.content || "No summary available";

                    // Handle images if available (like in RSS feeds)
                    let banner = el.image?.banner || '';
                    let footer = el.image?.footer || '';

                    // Construct article object
                    let article = {
                        title: el.title,
                        date: date,
                        author: el.authors?.[0]?.name || 'Unknown Author',
                        content: content,
                        comments: comments,
                        feedIcon: feed_server_icon_url || '',
                        banner: banner,
                        footer: footer
                    };

                    articles.push(article);
                }

                resolve({
                    articles
                });
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            });
        });
    });

    return await promise;
}
