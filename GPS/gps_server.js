///////////////////////////////////////////////////////////////
///                                                         ///
///  GPS SERVER SCRIPT FOR FM-DX-WEBSERVER (V2.1)           ///
///                                                         ///
///  by Highpoint               last update: 29.01.26       ///
///                                                         ///
///  https://github.com/Highpoint2000/gps                   ///
///                                                         ///
///////////////////////////////////////////////////////////////

const SIMULATE_GPS = false; // true = simulate GPS, false = use real GPS

// Example coordinates (Berlin with small random noise)
const simulatedLat = 52.520008;
const simulatedLon = 13.404954;
const simulatedAlt = 35; // height in meters

///////////////////////////////////////////////////////////////

// Default values for the configuration file (do not touch this!)
const defaultConfig = {
  GPS_PORT: '',                 // Connection port for GPS receiver (e.g.: 'COM1' or '/dev/ttyACM0') / if empty then GPS off
  GPS_BAUDRATE: 4800,           // Baud rate for GPS receiver (e.g.: 4800)
  GPS_HEIGHT: '',               // Fixed altitude in m (e.g.: '160') or leave blank for altitude via GPS signal
  GPS_HOST: '127.0.0.1',        // gpsd host (used if GPS_PORT == 'gpsd')
  GPSD_PORT: 2947,              // gpsd TCP port
  UpdateMapPos: false,          // true/false for updating the FM-DX server map
  UpdateMapInterval: 60,        // interval in seconds for updating the FM-DX server map
  BeepControl: false            // acoustic control function for gps status (true/false)
};

////////////////////////////////////////////////////////////////

const https = require('https');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

const { logInfo, logError, logWarn } = require('./../../server/console');
const ConfigFilePath = path.join(__dirname, './../../plugins_configs/gps.json');
const config = require('./../../config.json');
const { serverConfig } = require('./../../server/server_config');
const pjson = require('./../../package.json');

// Function to merge default config with existing config
function mergeConfig(defaultCfg, existingCfg) {
  const updated = {};
  for (const key in defaultCfg) {
    updated[key] = (key in existingCfg) ? existingCfg[key] : defaultCfg[key];
  }
  return updated;
}

// Function to load or create the configuration file
function loadConfig(filePath) {
  let existingConfig = {};

  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logInfo(`Directory created: ${dirPath}`);
  }

  if (fs.existsSync(filePath)) {
    existingConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    logInfo('GPS configuration not found. Creating gps.json.');
  }

  const finalConfig = mergeConfig(defaultConfig, existingConfig);
  fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2), 'utf-8');
  return finalConfig;
}

// Store for satellite data { "GPS": [...], "GLONASS": [...] }
let satView = {}; 

// Hold current HDOP/Accuracy
let currentHDOP = null;

function simulateGPSData() {
  const simulatedRandomLat = simulatedLat + (Math.random() - 0.5) * 0.001;
  const simulatedRandomLon = simulatedLon + (Math.random() - 0.5) * 0.001;
  const simulatedRandomAlt = simulatedAlt + (Math.random() - 0.5) * 5;
  const simulatedTime = new Date().toISOString();

  LAT = simulatedRandomLat;
  LON = simulatedRandomLon;
  ALT = simulatedRandomAlt;
  gpstime = simulatedTime;
  gpsmode = 3;
  currentStatus = 'active';
  currentHDOP = 1.2;
  
  // Simulate some satellites
  satView = {
      'GPS': [
          {prn: 5, el: 45, az: 100, snr: 35, sys: 'GPS'},
          {prn: 12, el: 80, az: 180, snr: 42, sys: 'GPS'},
          {prn: 24, el: 15, az: 270, snr: 15, sys: 'GPS'}
      ]
  };
}

// Load or create the configuration file
const configPlugin = loadConfig(ConfigFilePath);

let GPS_PORT = configPlugin.GPS_PORT;
let GPS_BAUDRATE = configPlugin.GPS_BAUDRATE;
let GPS_HEIGHT = configPlugin.GPS_HEIGHT;
let GPS_HOST = configPlugin.GPS_HOST || '127.0.0.1';
let GPSD_PORT = Number(configPlugin.GPSD_PORT) || 2947;
let UpdateMapPos = configPlugin.UpdateMapPos;
let UpdateMapInterval = configPlugin.UpdateMapInterval;
let BeepControl = configPlugin.BeepControl;

const sentMessages = new Set();
const { execSync } = require('child_process');
let NewModules;

NewModules = ['serialport', '@serialport/parser-readline', 'ws'];

if (BeepControl) {
  NewModules.push('speaker');
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
        logError(`Error installing module ${module}: ${error.message}`);
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

// --- GPS value holders (avoid undeclared globals) ---
let LAT = null;
let LON = null;

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

// --- Simulation timer guard ---
let simTimer = null;

// --- gpsd TCP client state ---
let gpsdSock = null;
let gpsdBuf = '';
let gpsdReconnectTimer = null;

let lastGpsdDataMs = 0;
let gpsdReconnectDelayMs = 1000; // exponential backoff
const GPSD_RECONNECT_MAX_MS = 30000;
const GPSD_DATA_TIMEOUT_MS = 15000; // if no data for 15s -> reconnect

function beepActive() {
  if (!BeepControl) return;
  try {
    fs.createReadStream('./plugins/GPS/sounds/beep_short_double.wav').pipe(new Speaker());
  } catch (e) {}
}

function beepInactive() {
  if (!BeepControl) return;
  try {
    fs.createReadStream('./plugins/GPS/sounds/beep_long_double.wav').pipe(new Speaker());
  } catch (e) {}
}

function setStatus(newStatus) {
  if (newStatus !== lastStatus) {
    currentStatus = newStatus;
    lastStatus = newStatus;

    if (newStatus === 'active') beepActive();
    if (newStatus === 'inactive') beepInactive();
  } else {
    currentStatus = newStatus;
  }
}

function markGpsdAlive() {
  lastGpsdDataMs = Date.now();
  gpsdReconnectDelayMs = 1000; // reset backoff once we see data again
}

function stopGpsdClient() {
  if (gpsdReconnectTimer) {
    clearTimeout(gpsdReconnectTimer);
    gpsdReconnectTimer = null;
  }
  if (gpsdSock) {
    try { gpsdSock.removeAllListeners(); } catch (e) {}
    try { gpsdSock.destroy(); } catch (e) {}
  }
  gpsdSock = null;
  gpsdBuf = '';
}

function scheduleGpsdReconnect(reason) {
  if (gpsdReconnectTimer) return;

  logWarn(`GPS Plugin lost connection. Attempting to reconnect... (${reason})`);
  gpsdReconnectTimer = setTimeout(() => {
    gpsdReconnectTimer = null;
    stopGpsdClient();
    startGPSConnection(true); // force reconnect
    gpsdReconnectDelayMs = Math.min(gpsdReconnectDelayMs * 2, GPSD_RECONNECT_MAX_MS);
  }, gpsdReconnectDelayMs);
}

function parseGpsdJsonLine(line) {
  if (!line || line[0] !== '{') return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return; // ignore malformed/partial lines
  }
  
  // Handle Satellite View (SKY)
  if (msg.class === 'SKY') {
      if(Array.isArray(msg.satellites)) {
        const sats = msg.satellites.map(s => ({
            prn: s.PRN,
            el: s.el,
            az: s.az,
            snr: s.ss,
            sys: 'GPSD' // gpsd often normalizes this, or provides it in 'type'
        }));
        satView['GPSD'] = sats;
      }
      // gpsd SKY class often contains hdop/pdop/vdop
      if (typeof msg.hdop !== 'undefined') currentHDOP = msg.hdop;
  }

  if (!msg || msg.class !== 'TPV') return;

  // gpsd can send TPV with mode 1 (no fix)
  const mode = Number(msg.mode || 0);

  if (typeof msg.lat === 'number') LAT = msg.lat;
  if (typeof msg.lon === 'number') LON = msg.lon;

  // alt may be missing for 2D fix; keep last ALT if missing
  if (typeof msg.alt === 'number') ALT = msg.alt;
  
  // Sometimes TPV also has error estimates (epx, epy) which are better than HDOP,
  // but for simplicity we'll stick to HDOP if available in SKY or compute roughly here if needed.
  // We'll rely on SKY class for HDOP usually.

  gpstime = msg.time;
  gpsmode = mode;

  // Height override behavior (keep your original logic)
  if (GPS_HEIGHT) {
    gpsmode = 2;
    ALT = GPS_HEIGHT;
  } else if (gpsalt !== undefined && gpsalt !== null && !isNaN(parseFloat(gpsalt))) {
    gpsmode = 3;
    ALT = gpsalt;
  }

  const latOk = (typeof LAT === 'number' && !isNaN(LAT));
  const lonOk = (typeof LON === 'number' && !isNaN(LON));
  const fixOk = (mode >= 2 && latOk && lonOk);

  // Detection logs like your serial logic
  if (!GPSmodulOn) {
    GPSmodulOn = true;
    GPSmodulOff = false;
    logInfo(`GPS Plugin detected gpsd at ${GPS_HOST}:${GPSD_PORT}`);
    setStatus('inactive');
    GPSdetectionOn = false;
  }

  if (!GPSdetectionOn && fixOk) {
    logInfo('GPS Plugin received data');
    GPSdetectionOn = true;
    GPSdetectionOff = false;
  }

  if (!GPSdetectionOff && !fixOk) {
    logWarn('GPS Plugin received no data');
    GPSdetectionOff = true;
    GPSdetectionOn = false;
  }

  setStatus(fixOk ? 'active' : 'inactive');
}

function startGpsdClient() {
  // Do not create duplicates
  if (gpsdSock && !gpsdSock.destroyed) return;

  gpsdBuf = '';
  lastGpsdDataMs = Date.now();

  const sock = new net.Socket();
  gpsdSock = sock;

  sock.setNoDelay(true);

  sock.on('connect', () => {
    gpsdReconnectDelayMs = 1000; // reset backoff after successful connect
    logInfo(`GPS Plugin using gpsd for GPS data (${GPS_HOST}:${GPSD_PORT})`);

    // Enable JSON stream
    try {
      sock.write('?WATCH={"enable":true,"json":true};\n');
    } catch (e) {}
  });

  sock.on('data', (chunk) => {
    if (sock !== gpsdSock) return;

    markGpsdAlive();
    gpsdBuf += chunk.toString('utf8');

    let idx;
    while ((idx = gpsdBuf.indexOf('\n')) >= 0) {
      const line = gpsdBuf.slice(0, idx).trim();
      gpsdBuf = gpsdBuf.slice(idx + 1);
      if (!line) continue;
      parseGpsdJsonLine(line);
    }

    // prevent buffer runaway if gpsd sends unexpected data
    if (gpsdBuf.length > 200000) gpsdBuf = gpsdBuf.slice(-50000);
  });

  sock.on('error', (err) => {
    if (sock !== gpsdSock) return;
    logError(`GPS Plugin gpsd socket error: ${err.message}`);
    setStatus('inactive');
    scheduleGpsdReconnect('gpsd socket error');
  });

  sock.on('close', () => {
    if (sock !== gpsdSock) return;
    setStatus('inactive');
    scheduleGpsdReconnect('gpsd socket closed');
  });

  // Connect
  sock.connect(GPSD_PORT, GPS_HOST);
}

function startSerialClient(force = false) {
  const gpsBaudRate = Number(GPS_BAUDRATE) || 4800;

  // Open the port only if not open
  if (!port || port.isOpen === false || force) {
    try {
      if (port) {
        try { port.removeAllListeners(); } catch (e) {}
        try { port.close(); } catch (e) {}
      }
    } catch (e) {}

    port = new SerialPort({ path: GPS_PORT, baudRate: gpsBaudRate });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  } else if (!parser) {
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  }

  // Prevent duplicate listeners if reconnect logic triggers
  if (parser) parser.removeAllListeners('data');
  if (port) {
    port.removeAllListeners('error');
    port.removeAllListeners('close');
  }

  // Convert coordinates to decimal degrees
  function convertToDecimalDegrees(degree, minute) {
    return degree + minute / 60;
  }

  // Format time into hh:mm:ss
  function formatTime(time) {
    const hours = time.slice(0, 2);
    const minutes = time.slice(2, 4);
    const seconds = time.slice(4, 6);
    return `${hours}:${minutes}:${seconds}`;
  }

  // Format GPS date + time into UTC ISO string
  function formatDateTime(date, time) {
    const year = `20${date.slice(4, 6)}`;
    const month = date.slice(2, 4);
    const day = date.slice(0, 2);
    const formattedTime = formatTime(time);
    return `${year}-${month}-${day}T${formattedTime}Z`;
  }

  // Get NMEA sentence type: $GPRMC/$GNRMC/... => "RMC"
  function getNmeaType(header) {
    if (!header) return '';
    const h = String(header).trim();
    if (h.startsWith('$') && h.length >= 6) return h.substring(3, 6);
    return '';
  }
  
  // Determine System from Talker ID
  function getSystemName(header) {
      if (!header || header.length < 3) return 'GPS';
      const id = header.substring(1, 3);
      if (id === 'GP') return 'GPS';
      if (id === 'GL') return 'GLONASS';
      if (id === 'GA') return 'Galileo';
      if (id === 'BD' || id === 'GB') return 'BeiDou';
      if (id === 'GN') return 'GNSS';
      return 'GPS';
  }

  parser.on('data', (data) => {
    const line = String(data || '').trim();
    if (!line) return;

    // Remove Checksum if present
    const rawContent = line.split('*')[0];
    const parts = rawContent.split(',');
    const header = (parts[0] || '').trim();
    const msgType = getNmeaType(header);
    const system = getSystemName(header);

    // Satellites in View (GSV) parsing
    // $GPGSV, NoMsg, MsgNo, TotalSats, {PRN, El, Az, SNR} x 4
    if (msgType === 'GSV') {
        const numMsgs = parseInt(parts[1], 10);
        const msgNum = parseInt(parts[2], 10);
        // parts[3] is total Sats in view
        
        // Ensure array exists for this system
        if (!satView[system]) satView[system] = [];

        // If it's the first message of the sequence, clear previous data for this system
        if (msgNum === 1) {
            satView[system] = [];
        }

        // Iterate through satellite blocks (max 4 per message)
        // Fields start at index 4: PRN, Elev, Azim, SNR
        for (let i = 4; i < parts.length - 3; i += 4) {
            const prn = parseInt(parts[i]);
            const el = parseInt(parts[i+1]);
            const az = parseInt(parts[i+2]);
            const snr = parseInt(parts[i+3]) || 0; // Sometimes SNR is empty

            if (!isNaN(prn) && !isNaN(el) && !isNaN(az)) {
                satView[system].push({ prn, el, az, snr, sys: system });
            }
        }
    }

    // RMC
    else if (msgType === 'RMC' && parts.length > 9) {
      const time = parts[1];
      const status = parts[2];
      const latitude = parts[3];
      const latitudeDirection = parts[4];
      const longitude = parts[5];
      const longitudeDirection = parts[6];
      const date = parts[9];

      if (status === 'A' && latitude && longitude && latitudeDirection && longitudeDirection) {
        const latDegrees = parseFloat(latitude.slice(0, 2));
        const latMinutes = parseFloat(latitude.slice(2));
        const lonDegrees = parseFloat(longitude.slice(0, 3));
        const lonMinutes = parseFloat(longitude.slice(3));

        if (!isNaN(latDegrees) && !isNaN(latMinutes) && !isNaN(lonDegrees) && !isNaN(lonMinutes)) {
          const latDecimal = convertToDecimalDegrees(latDegrees, latMinutes);
          const lonDecimal = convertToDecimalDegrees(lonDegrees, lonMinutes);

          LAT = (latitudeDirection === 'S') ? -latDecimal : latDecimal;
          LON = (longitudeDirection === 'W') ? -lonDecimal : lonDecimal;

          if (date && time && date.length >= 6 && time.length >= 6) {
            gpstime = formatDateTime(date, time);
          }

          setStatus('active');
        }
      } else {
        setStatus('inactive');
      }

    // GGA (Also GSA contains HDOP, but GGA contains it at index 8)
    // $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
    // Index 8 is HDOP (0.9 in example)
    } else if (msgType === 'GGA' && parts.length > 9) {
      gpsalt = parts[9];
      const hdop = parts[8]; // HDOP is index 8 in GGA
      
      if (hdop) currentHDOP = hdop;

      if (GPS_HEIGHT) {
        gpsmode = 2;
        ALT = GPS_HEIGHT;
      } else if (gpsalt !== undefined && gpsalt !== null && !isNaN(parseFloat(gpsalt))) {
        gpsmode = 3;
        ALT = gpsalt;
        setStatus('active');
      }
    }
    // GSA also contains HDOP/PDOP/VDOP but GGA is convenient as we already parse it
    else if (msgType === 'GSA' && parts.length > 16) {
        // GSA structure differs slightly by talker but usually:
        // Mode, FixType, PRNs..., PDOP, HDOP, VDOP
        // HDOP is typically the second to last or third to last field before checksum
        // Index 16 is HDOP in standard GSA
        const hdop = parts[16];
        if (hdop) currentHDOP = hdop;
    }

    // Receiver detected (first time)
    if (!GPSmodulOn) {
      GPSmodulOn = true;
      GPSmodulOff = false;
      logInfo(`GPS Plugin detected Receiver: ${GPS_PORT} with ${GPS_BAUDRATE} bps`);
      setStatus('inactive');
      GPSdetectionOn = false;
    }

    if (!GPSdetectionOn && currentStatus === 'active') {
      logInfo('GPS Plugin received data');
      GPSdetectionOn = true;
      GPSdetectionOff = false;
    }

    if (!GPSdetectionOff && currentStatus === 'inactive') {
      logWarn('GPS Plugin received no data');
      GPSdetectionOff = true;
      GPSdetectionOn = false;
    }
  });

  port.on('error', (err) => {
    if (!GPSmodulOff) {
      logError(`GPS Plugin Error: ${err.message}`);
      GPSmodulOff = true;
      GPSmodulOn = false;
      GPSdetectionOn = false;
      setStatus('inactive');
    }
    setTimeout(() => startSerialClient(true), 2000);
  });

  port.on('close', () => {
    if (!GPSmodulOff) {
      logError('GPS Plugin Error: Connection closed');
      GPSmodulOff = true;
      GPSmodulOn = false;
      setStatus('inactive');
    }
    setTimeout(() => startSerialClient(true), 2000);
  });
}

function startGPSConnection(force = false) {
  if (SIMULATE_GPS) {
    logInfo('GPS Plugin: Simulation mode enabled');
    if (!simTimer) {
      simTimer = setInterval(simulateGPSData, 1000);
    }
    return;
  }

  if (!GPS_PORT) return;

  // gpsd mode
  if (GPS_PORT === 'gpsd') {
    // stop serial if somehow open
    if (port) {
      try { port.removeAllListeners(); } catch (e) {}
      try { port.close(); } catch (e) {}
      port = null;
      parser = null;
    }
    if (force) stopGpsdClient();
    startGpsdClient();
    return;
  }

  // serial mode
  stopGpsdClient();
  startSerialClient(force);
}

// Connection health check (serial + gpsd)
function checkGPSConnection() {
  if (!GPS_PORT || SIMULATE_GPS) return;

  // gpsd mode: reconnect if socket dead or no data for a while
  if (GPS_PORT === 'gpsd') {
    const now = Date.now();
    const dead = (!gpsdSock || gpsdSock.destroyed);
    const stale = (now - lastGpsdDataMs) > GPSD_DATA_TIMEOUT_MS;

    if (dead) {
      setStatus('inactive');
      startGPSConnection(true);
    } else if (stale) {
      logWarn('GPS Plugin: gpsd data timeout (stale). Reconnecting...');
      setStatus('inactive');
      startGPSConnection(true);
    }
    return;
  }

  // serial mode
  if (GPS_PORT && GPS_BAUDRATE && (!port || !port.isOpen)) {
    logWarn('GPS Plugin lost connection. Attempting to reconnect...');
    startGPSConnection(true);
    setStatus('inactive');
  }
}

// Monitor connection every 10 seconds (fast recovery)
gpsDetectionInterval = setInterval(checkGPSConnection, 10000);

// Initialize GPS Connection
if (SIMULATE_GPS || GPS_PORT) {
  logInfo('GPS Plugin starting connection...');
  startGPSConnection();
}

// Cleanup on exit to avoid orphan sockets/ports
process.on('SIGTERM', () => {
  try { clearInterval(gpsDetectionInterval); } catch (e) {}
  try { stopGpsdClient(); } catch (e) {}
  try { if (port) port.close(); } catch (e) {}
  process.exit(0);
});
process.on('SIGINT', () => {
  try { clearInterval(gpsDetectionInterval); } catch (e) {}
  try { stopGpsdClient(); } catch (e) {}
  try { if (port) port.close(); } catch (e) {}
  process.exit(0);
});

/////////////////////////////////////////////  GPS END //////////////////////////////////////////////////////////////////

async function sendGPSDATA(request) {
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
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
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

  if (serverConfig.identification.token) {
    request.token = serverConfig.identification.token;
  }

  if (serverConfig.identification.proxyIp.length) {
    request.url = serverConfig.identification.proxyIp;
  } else {
    request.port = serverConfig.webserver.webserverPort;
  }

  return sendGPSDATA(request).then((response) => {
    if (response.token && response.success) {
      logInfo("GPS update FM-DX Server Map:", parseFloat(GPSLAT).toFixed(6), parseFloat(GPSLON).toFixed(6), "successful");
      if (BeepControl) {
        try { fs.createReadStream('./plugins/GPS/sounds/beep_short.wav').pipe(new Speaker()); } catch (e) {}
      }
    } else {
      logWarn("GPS failed to update FM-DX Server Map: " + (response.error ? response.error : 'unknown error'));
    }
  }).catch((error) => {
    logWarn("Failed to send request: " + error);
  });
}

// Ensure map update interval is at least 15 seconds
const intervalInMilliseconds = Math.max(UpdateMapInterval, 15) * 1000;
logInfo('GPS update interval for FM-DX Server Map is', intervalInMilliseconds / 1000, 'seconds');

setInterval(async () => {
  if (UpdateMapPos && currentStatus === 'active') {
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
    setTimeout(connectToWebSocket, 5000);
  });
}

connectToWebSocket();

function output() {
  // Prepare GPS data
  GPSLAT = (typeof LAT === 'number' && !isNaN(LAT))
    ? `${LAT.toFixed(9)}`
    : (!GPS_PORT && config.identification.lat && !isNaN(parseFloat(config.identification.lat)))
      ? `${parseFloat(config.identification.lat).toFixed(9)}`
      : "";

  GPSLON = (typeof LON === 'number' && !isNaN(LON))
    ? `${LON.toFixed(9)}`
    : (!GPS_PORT && config.identification.lon && !isNaN(parseFloat(config.identification.lon)))
      ? `${parseFloat(config.identification.lon).toFixed(9)}`
      : "";

  GPSMODE = (currentStatus === 'active')
    ? `${gpsmode}`
    : (ALT !== undefined && ALT !== null && !isNaN(parseFloat(ALT)) ? '2' : '');

  GPSALT = ALT ? `${parseFloat(ALT).toFixed(3)}` : '';

  // Robust time handling to prevent RangeError crash
  let dateObj;
  try {
    dateObj = gpstime ? new Date(gpstime) : new Date();
    if (isNaN(dateObj.getTime())) dateObj = new Date();
  } catch (err) {
    dateObj = new Date();
  }

  GPSTIME = dateObj.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  
  // Flatten satellites from different systems into one list
  const flatSats = Object.values(satView).flat();

  const gpsMessage = JSON.stringify({
    type: 'GPS',
    value: {
      status: currentStatus,
      time: GPSTIME,
      lat: GPSLAT,
      lon: GPSLON,
      alt: GPSALT,
      mode: GPSMODE,
      hdop: currentHDOP,
      satellites: flatSats
    }
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(gpsMessage);
  } else {
    logWarn('WebSocket is not open. Unable to send GPS data.');
  }
}

setInterval(output, 1000);