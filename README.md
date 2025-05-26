# GPS Plugin for [FM-DX-Webserver](https://github.com/NoobishSVK/fm-dx-webserver)

This plugin provides GPS data for the FM-DX web server.

![image](https://github.com/user-attachments/assets/d6f84f67-be91-4e74-9e1a-93e884d790a5)


## v2.0

- Added GPS Button to toggle the GPS Live Monitor (movable)
- Added GPS simulation mode (to be activated in the header of gps_server.js)

Until the web server is updated, the tx_search.js file in the server directory must be replaced with the attached one!!! Otherwise the location in the web server will not be updated. 

## Installation notes:

1. [Download](https://github.com/Highpoint2000/gps/releases) the last repository as a zip
2. Unpack all files from the plugins folder to ..fm-dx-webserver-main\plugins\
3. Replace the ..fm-dx-webserver-main\server\tx_search.js with the attached one 
4. Stop or close the fm-dx-webserver
5. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
6. Activate the gps plugin in the settings
7. Stop or close the fm-dx-webserver
8. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
9. Configure your personal settings in the automatically created gps.json (in the folder: ../fm-dx-webserver-main/plugins_configs)
10. Stop or close the fm-dx-webserver
11. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations

## Configuration options:

The following variables can be changed in the gps.json:

	GPS_PORT: '',                  	// Connection port for GPS receiver (e.g.: 'COM1', '/dev/ttyACM0' or 'gpsd' / if empty then GPS off
    GPS_BAUDRATE: 4800,          	// Baud rate for GPS receiver (e.g.: 4800)        
    GPS_HEIGHT: '',              	// Enter fixed altitude in m (e.g.: '160' ) or leave blank for altitude via GPS signal 
	UpdateMapPos: true,		// Set the value true or false for updating the FM DX server map
	UpdateMapInterval: 60,		// Set the interval in s (e.g.: 60) for updating the FM DX server map
	BeepControl: false,  		// Acoustic control function for gps status (true or false)

The following variables can be changed in the gps_server.js:

        const SIMULATE_GPS = false;      // true = simulate GPS, false = use real GPS
        const simulatedLat = 52.520008; // Example latitude (Berlin with small random noise)
        const simulatedLon = 13.404954; // Example longitude (Berlin with small random noise)
        const simulatedAlt = 35;        //height in meters

## Important notes:

To youse gpsd set the GPS_PORT to 'gpsd' and make sure that only data in NMEA format is transmitted via the interface. If necessary, use the command: sudo gpsctl -n


## History:

### v1.2

- Fixed problems updating map status

### v1.1

- gpsd has been implemented, to do this, set the GPS_PORT to 'gpsd'

### v1.0a

- Node.js module speaker is only loaded if the sound control has been activated (some Linux systems have problems with the sound output!)
- Fixed problems with update info

### v1.0

- Provision of GPS data from compatible GPS receivers (e.g. VK-162) for the web server and plugins
- Acoustic signaling for gps status (Optional setting in gps.json)
- Updating the FMDX server map with the GPS coordinates (Interval adjustable - min. 15 seconds)
- Daily update check for admin

Until the web server is updated, the tx_search.js file in the server directory must be replaced with the attached one!!! Otherwise the location in the web server will not be updated. 
