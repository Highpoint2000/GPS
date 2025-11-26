///////////////////////////////////////////////////////////////
///                                                         ///
///  GPS SERVER SCRIPT FOR FM-DX-WEBSERVER (V2.0a)          ///
///                                                         ///
///  by Highpoint               last update: 26.11.25       ///
///                                                         ///
///  https://github.com/Highpoint2000/gps                   ///
///                                                         ///
///////////////////////////////////////////////////////////////

const SIMULATE_GPS = false; // true = simulate GPS, false = use real GPS

// Example coordinates (Berlin with small random noise)
const simulatedLat = 52.520008; 
const simulatedLon = 13.404954;
const simulatedAlt = 35; //height in meters

///////////////////////////////////////////////////////////////

// Default values for the configuration file (do not touch this!)
const defaultConfig = {
	GPS_PORT: '',                       // Connection port for GPS receiver (e.g.: 'COM1' or ('/dev/ttyACM0') / if empty then GPS off
    GPS_BAUDRATE: 4800,                 // Baud rate for GPS receiver (e.g.: 4800)        
    GPS_HEIGHT: '',                     // Enter fixed altitude in m (e.g.: '160' ) or leave blank for altitude via GPS signal 
	UpdateMapPos: false,				// Set the value true or false for updating the FM DX server map
	UpdateMapInterval: 60,				// Set the interval in s (e.g.: 60) for updating the FM DX server map
	BeepControl: false,  				// Acoustic control function for gps status (true or false)
};

////////////////////////////////////////////////////////////////

const https = require('https');
const path = require('path');
const fs = require('fs');
const { logInfo, logError, logWarn } = require('./../../server/console');
const ConfigFilePath = path.join(__dirname, './../../plugins_configs/gps.json');
const config = require('./../../config.json');
const { serverConfig, configUpdate, configSave } = require('./../../server/server_config');
var pjson = require('./../../package.json');
var os = require('os');

// Function to merge default config with existing config and remove undefined values
function mergeConfig(defaultConfig, existingConfig) {
    const updatedConfig = {};

    // Add the existing values that match defaultConfig keys
    for (const key in defaultConfig) {
        updatedConfig[key] = key in existingConfig ? existingConfig[key] : defaultConfig[key];
    }

    return updatedConfig;
}

// Function to load or create the configuration file
function loadConfig(filePath) {
    let existingConfig = {};

    // Ensure the directory exists
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logInfo(`Directory created: ${dirPath}`);
    }

    // Check if the configuration file exists
    if (fs.existsSync(filePath)) {
        // Read the existing configuration file
        existingConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } else {
        logInfo('Scanner configuration not found. Creating scanner.json.');
    }

    // Merge the default config with the existing one
    const finalConfig = mergeConfig(defaultConfig, existingConfig);

    // Write the updated configuration back to the file
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2), 'utf-8');

    return finalConfig; // Ensure this is properly returned
}

function simulateGPSData() {
    // Example coordinates (e.g., Berlin)
    const simulatedRandomLat = simulatedLat + (Math.random() - 0.5) * 0.001; // slight random variation
    const simulatedRandomLon = simulatedLon + (Math.random() - 0.5) * 0.001;
    const simulatedRandomAlt = simulatedAlt + (Math.random() - 0.5) * 5; // altitude in meters
    const simulatedTime = new Date().toISOString();

    LAT = simulatedRandomLat;
    LON = simulatedRandomLon;
    ALT = simulatedRandomAlt;
    gpstime = simulatedTime;
    gpsmode = 3; // 3D fix

    currentStatus = 'active';
}

// Load or create the configuration file
const configPlugin = loadConfig(ConfigFilePath);

let GPS_PORT = configPlugin.GPS_PORT;
let GPS_BAUDRATE = configPlugin.GPS_BAUDRATE;
let GPS_HEIGHT = configPlugin.GPS_HEIGHT;
let UpdateMapPos = configPlugin.UpdateMapPos;
let UpdateMapInterval = configPlugin.UpdateMapInterval;
let BeepControl = configPlugin.BeepControl;

const sentMessages = new Set();
const { execSync } = require('child_process');
let NewModules;

NewModules = ['serialport', '@serialport/parser-readline'];

if (BeepControl) {
    NewModules.push('speaker');
}

if (GPS_PORT === 'gpsd') {
    NewModules.push('child_process');
}

function checkAndInstallNewModules() {
    NewModules.forEach(module => {
        const modulePath = path.join(__dirname, './../../node_modules', module);
        if (!fs.existsSync(modulePath)) {
            logInfo(`Module ${module} is missing. Installing...`);
            try {
                execSync(`npm install ${module}`, { stdio: 'inherit' });
                logInfo(`Module ${module} installed successfully.`);
            } catch (error) {
                logError(`Error installing module ${module}:`, error);
                process.exit(1);
            }
        }
    });
}

checkAndInstallNewModules();

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const webserverPort = config.webserver.webserverPort || 8080;
const externalWsUrl = `ws://127.0.0.1:${webserverPort}`;

let Speaker;
if (BeepControl) {
  Speaker = require('speaker');
}


let ws;
let gpstime;
let ALT = GPS_HEIGHT;
let gpsalt;
let currentStatus = 'off';
let gpsmode = GPS_HEIGHT ? 2 : ''; 
let GPSdetectionOn = false;
let GPSdetectionOff = true;
let GPSmodulOn = false;
let GPSmodulOff = false;
let GPSLAT;
let GPSLON;
let GPSMODE;
let GPSALT;
let GPSTIME;

/////////////////////////////////////////////  GPS //////////////////////////////////////////////////////////////////

let port;
let parser;
let gpsDetectionInterval;
let lastStatus = null;

const { spawn } = require('child_process');

function startGPSConnection() {
    if (SIMULATE_GPS) {
        logInfo('GPS Plugin: Simulation mode enabled');

        // Simulate GPS data every second
        setInterval(() => {
            // Example coordinates (Berlin with small random noise)
            const simulatedLat = 52.520008 + (Math.random() - 0.5) * 0.001;
            const simulatedLon = 13.404954 + (Math.random() - 0.5) * 0.001;
            const simulatedAlt = 35 + (Math.random() - 0.5) * 5; // meters altitude
            const simulatedTime = new Date().toISOString();

            LAT = simulatedLat;
            LON = simulatedLon;
            ALT = simulatedAlt;
            gpstime = simulatedTime;
            gpsmode = 3;  // 3D fix
            currentStatus = 'active';
        }, 1000);

    } else {

        if (GPS_PORT === 'gpsd') {
            logInfo('GPS Plugin using gpsd for GPS data');
            const gpsPipe = spawn('gpspipe', ['-w']);

            gpsPipe.stdout.on('data', (data) => {
                try {
                    const lines = data.toString().trim().split('\n');
                    lines.forEach((line) => {
                        const gpsData = JSON.parse(line);

                        if (gpsData.class === 'TPV') {
                            LAT = gpsData.lat;
                            LON = gpsData.lon;
                            ALT = gpsData.alt;
                            gpstime = gpsData.time;
                            gpsmode = gpsData.mode;

                            if (GPS_HEIGHT) {
                                gpsmode = 2;
                                ALT = GPS_HEIGHT;
                            } else if (gpsalt !== undefined && gpsalt !== null && !isNaN(parseFloat(gpsalt))) {
                                gpsmode = 3;
                                ALT = gpsalt;
                            }

                            const currentLatValid = LAT !== undefined && LAT !== null && !isNaN(parseFloat(LAT));
                            const newStatus = currentLatValid ? 'active' : 'inactive';

                            if (newStatus !== lastStatus) {
                                currentStatus = newStatus;
                                lastStatus = newStatus;

                                if (currentStatus === 'active' && BeepControl) {
                                    fs.createReadStream('./plugins/GPS/sounds/beep_short_double.wav').pipe(new Speaker());
                                } else if (currentStatus === 'inactive' && BeepControl) {
                                    fs.createReadStream('./plugins/GPS/sounds/beep_long_double.wav').pipe(new Speaker());
                                }
                            }
                        }
                    });

                } catch (err) {
                    logError(`GPS Plugin Error parsing gpsd data: ${err.message}`);
                }
            });

            gpsPipe.stderr.on('data', (data) => {
                logError(`GPS Plugin gpspipe error: ${data}`);
            });

            gpsPipe.on('close', (code) => {
                logWarn(`GPS Plugin gpspipe process exited with code ${code}`);
            });

        } else {
            const gpsBaudRate = Number(GPS_BAUDRATE) || 4800;

            // Open the port only if it's not open
            if (!port || port.isOpen === false) {
                port = new SerialPort({ path: GPS_PORT, baudRate: gpsBaudRate });
                parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
            }

            // Function to convert coordinates to decimal degrees
            function convertToDecimalDegrees(degree, minute) {
                return degree + minute / 60;
            }

            // Function to format time into hh:mm:ss
            function formatTime(time) {
                const hours = time.slice(0, 2);
                const minutes = time.slice(2, 4);
                const seconds = time.slice(4, 6);
                return `${hours}:${minutes}:${seconds}`;
            }

            // Function to format GPS date and time into UTC format
            function formatDateTime(date, time) {
                const year = `20${date.slice(4, 6)}`; // Year (e.g., 231205 -> 2023)
                const month = date.slice(2, 4);
                const day = date.slice(0, 2);
                const formattedTime = formatTime(time);
                return `${year}-${month}-${day}T${formattedTime}Z`;
            }

            // Read and process data
            parser.on('data', (data) => {
                const parts = data.split(',');

                if (parts[0] === '$GPRMC' && parts.length > 5) {
                    const date = parts[9];
                    const time = parts[1];
                    const status = parts[2];
                    const latitude = parts[3];
                    const latitudeDirection = parts[4];
                    const longitude = parts[5];
                    const longitudeDirection = parts[6];

                    if (status === 'A') {
                        const latDegrees = parseFloat(latitude.slice(0, 2));
                        const latMinutes = parseFloat(latitude.slice(2));
                        const latDecimal = convertToDecimalDegrees(latDegrees, latMinutes);

                        const lonDegrees = parseFloat(longitude.slice(0, 3));
                        const lonMinutes = parseFloat(longitude.slice(3));
                        const lonDecimal = convertToDecimalDegrees(lonDegrees, lonMinutes);

                        LAT = latitudeDirection === 'S' ? -latDecimal : latDecimal;
                        LON = longitudeDirection === 'W' ? -lonDecimal : lonDecimal;

                        gpstime = formatDateTime(date, time);
                        currentStatus = 'active';
                    }
                } else if (parts[0] === '$GPGGA' && parts.length > 9) {
                    gpsalt = parts[9];

                    if (GPS_HEIGHT) {
                        gpsmode = 2;
                        ALT = GPS_HEIGHT;
                    } else if (gpsalt !== undefined && gpsalt !== null && !isNaN(parseFloat(gpsalt))) {
                        gpsmode = 3;
                        ALT = gpsalt;
                        currentStatus = 'active';
                    }
                }

                if (!GPSmodulOn) {
                    GPSmodulOn = true;
                    GPSmodulOff = false;
                    logInfo(`GPS Plugin detected Receiver: ${GPS_PORT} with ${GPS_BAUDRATE} bps`);
                    currentStatus = 'inactive';
                    GPSdetectionOn = false;
                }

                if (!GPSdetectionOn && currentStatus === 'active') {
                    logInfo(`GPS Plugin received data`);
                    GPSdetectionOn = true;
                    GPSdetectionOff = false;
                    if (BeepControl) {
                        fs.createReadStream('./plugins/GPS/sounds/beep_short_double.wav').pipe(new Speaker());
                    }
                }

                if (!GPSdetectionOff && currentStatus === 'inactive') {
                    logWarn(`GPS Plugin received no data `);
                    GPSdetectionOff = true;
                    GPSdetectionOn = false;
                    if (BeepControl) {
                        fs.createReadStream('./plugins/GPS/sounds/beep_long_double.wav').pipe(new Speaker());
                    }
                }
            });

            // Error handling for the serial port
            port.on('error', (err) => {
                if (!GPSmodulOff) {
                    logError(`GPS Plugin Error: ${err.message}`);
                    GPSmodulOff = true;
                    GPSmodulOn = false;
                    GPSdetectionOn = false;
                    currentStatus = 'inactive';
                    if (BeepControl) {
                        fs.createReadStream('./plugins/GPS/sounds/beep_long_double.wav').pipe(new Speaker());
                    }
                }

                // Retry logic to handle connection loss
                setTimeout(() => {
                    startGPSConnection(); // Attempt to reconnect
                }, 5000); // Retry after 5 seconds
            });

            // Monitor connection close and restart if necessary
            port.on('close', () => {
                if (!GPSmodulOff) {
                    logError(`GPS Plugin Error: Connection closed`);
                    GPSmodulOff = true;
                    GPSmodulOn = false;
                    currentStatus = 'error';
                    if (BeepControl) {
                        fs.createReadStream('./plugins/GPS/sounds/beep_long_double.wav').pipe(new Speaker());
                    }
                }

                setTimeout(() => {
                    startGPSConnection(); // Retry after 5 seconds
                }, 5000);
            });
        }
    }
}

// Function to check if the GPS is connected and try to reconnect
function checkGPSConnection() {
  if (GPS_PORT && GPS_BAUDRATE && (!port || !port.isOpen)) {
    logWarn('GPS Plugin lost connection. Attempting to reconnect...');
    startGPSConnection();
    currentStatus = 'inactive';
  }
}

// Monitor the connection every 60 seconds
gpsDetectionInterval = setInterval(checkGPSConnection, 60000); // Check every 60 seconds

// Initialize GPS Connection
if (SIMULATE_GPS || GPS_PORT) {
  logInfo('GPS Plugin starting connection...');
  startGPSConnection();
}

/////////////////////////////////////////////  GPS END //////////////////////////////////////////////////////////////////


async function sendGPSDATA(request) {
    //logInfo('GPS sending request:', request);
    const url = "https://servers.fmdx.org/api/";

    const options = {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const data = JSON.stringify(request);
        const req = https.request(url, options, (res) => {
            //logInfo(`HTTP Status: ${res.statusCode}`);
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                //logInfo('Server Response:', body);
                try {
                    const json = JSON.parse(body);
                    resolve(json);
                } catch (error) {
                    logError('GPS failed to parse response:', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            logError('GPS request failed:', error);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

function sendUpdateGPSDATA() {
	
	let currentOs = os.type() + ' ' + os.release();

	let bwLimit = '';
	if (serverConfig.webserver.tuningLimit === true) {
		bwLimit = serverConfig.webserver.tuningLowerLimit + ' - ' + serverConfig.webserver.tuningUpperLimit + ' MHz';
	}

	const request = {
        status: ((serverConfig.lockToAdmin || !serverConfig.publicTuner) ? 2 : 1),
        coords: [
            parseFloat(GPSLAT).toFixed(6),
            parseFloat(GPSLON).toFixed(6),
        ],
		name: serverConfig.identification.tunerName,
		desc: serverConfig.identification.tunerDesc,
		audioChannels: serverConfig.audio.audioChannels,
		audioQuality: serverConfig.audio.audioBitrate,
		contact: serverConfig.identification.contact || '',
		tuner: serverConfig.device || '',
		bwLimit: bwLimit,
		os: currentOs,
		version: pjson.version 
    };

	if (serverConfig.identification.token)
	{
		request.token = serverConfig.identification.token;
	}

	if (serverConfig.identification.proxyIp.length)
	{
		request.url = serverConfig.identification.proxyIp;
	}
	else
	{
		request.port = serverConfig.webserver.webserverPort;
	}

    return sendGPSDATA(request).then((response) => {
        if (response.token && response.success) {
            logInfo("GPS update FM-DX Server Map:",parseFloat(GPSLAT).toFixed(6),parseFloat(GPSLON).toFixed(6),"successful");
			//console.log(serverConfig.lockToAdmin);
			//console.log(serverConfig.publicTuner);
			//console.log(request.status);
			if (BeepControl) {
				fs.createReadStream('./plugins/GPS/sounds/beep_short.wav').pipe(new Speaker());
			}
        } else {
            logWarn("GPS failed to update FM-DX Server Map: " + (response.error ? response.error : 'unknown error'));
        }
    }).catch((error) => {
        logWarn("Failed to send request: " + error);
    });
}

// Ensure the map update interval is at least 15 seconds
const intervalInMilliseconds = Math.max(UpdateMapInterval, 15) * 1000;
logInfo('GPS update interval for FM-DX Server Map is',intervalInMilliseconds / 1000,'seconds');

// Execute the function at the defined interval
setInterval(async () => {
    if (UpdateMapPos && currentStatus === 'active') { // Check if updates are allowed
        try {
            await sendUpdateGPSDATA();
        } catch (error) {
            logError('Error updating Map data:', error);
        }
    }
}, intervalInMilliseconds);


function connectToWebSocket() {
    ws = new WebSocket(externalWsUrl + '/data_plugins');

    ws.on('open', () => {
        logInfo(`GPS WebSocket connected to ${externalWsUrl}/data_plugins`);
    });

    ws.on('error', (error) => console.error('WebSocket error:', error));

    ws.on('close', (code, reason) => {
        logInfo(`GPS WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        setTimeout(connectToWebSocket, 5000); // Retry connection after 5 seconds
    });
}

connectToWebSocket();

function output() {
    // Prepare GPS data	
    GPSLAT = typeof LAT === 'number' && !isNaN(LAT)
        ? `${LAT.toFixed(9)}`
        : (!GPS_PORT && config.identification.lat && !isNaN(parseFloat(config.identification.lat))) 
            ? `${parseFloat(config.identification.lat).toFixed(9)}`
            : "";

    GPSLON = typeof LON === 'number' && !isNaN(LON)
        ? `${LON.toFixed(9)}`
        : (!GPS_PORT && config.identification.lon && !isNaN(parseFloat(config.identification.lon))) 
            ? `${parseFloat(config.identification.lon).toFixed(9)}`
            : "";

    GPSMODE = currentStatus === 'active' ? `${gpsmode}` : (ALT !== undefined && ALT !== null && !isNaN(parseFloat(ALT)) ? '2' : '');

    GPSALT = ALT ? `${parseFloat(ALT).toFixed(3)}` : '';
    GPSTIME = gpstime
        ? new Date(gpstime).toISOString().replace(/\.\d{3}Z$/, '.000Z') // Format gpstime
        : new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

    // Prepare the data to send
    const gpsMessage = JSON.stringify({
		type: 'GPS',
        value: {
		status: currentStatus,
        time: GPSTIME,
        lat: GPSLAT,
        lon: GPSLON,
        alt: GPSALT,
        mode: GPSMODE
		}
    });

    // Send data over WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(gpsMessage);
        //logInfo('Data sent via WebSocket:', gpsMessage);
    } else {
        logWarn('WebSocket is not open. Unable to send GPS data.');
    }
	
}

// Update the output every second
setInterval(output, 1000);


		