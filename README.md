# GPS Plugin for [FM-DX-Webserver](https://github.com/NoobishSVK/fm-dx-webserver)

![image](https://github.com/user-attachments/assets/4d589495-74c8-4e9f-bd69-82f0f4a964f5)

 
This plugin provides GPS data for the FM-DX web server.

## v1.0
- Provision of GPS data from compatible GPS receivers (e.g. VK-162) for the web server and plugins
- Acoustic signaling for gps status (Optional setting in gps.json)
- Updating the FMDX server map with the GPS coordinates (Interval adjustable - min. 15 seconds)
- Daily update check for admin

## Installation notes:

1. [Download](https://github.com/Highpoint2000/gps/releases) the last repository as a zip
2. Unpack all files from the plugins folder to ..fm-dx-webserver-main\plugins\ 
3. Stop or close the fm-dx-webserver
4. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
5. Activate the gps plugin in the settings
6. Stop or close the fm-dx-webserver
7. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
8. Configure your personal settings in the automatically created gps.json (in the folder: ../fm-dx-webserver-main/plugins_configs)
9. Stop or close the fm-dx-webserver
10. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations

## Configuration options:

The following variables can be changed in the gps.json:

	GPS_PORT: '',                        // Connection port for GPS receiver (e.g.: 'COM1' or ('/dev/ttyACM0') / if empty then GPS off
    GPS_BAUDRATE: 4800,                  // Baud rate for GPS receiver (e.g.: 4800)        
    GPS_HEIGHT: '',                      // Enter fixed altitude in m (e.g.: '160' ) or leave blank for altitude via GPS signal 
	UpdateMapPos: true,			// Set the value true or false for updating the FM DX server map
	UpdateMapInterval: 60,			// Set the interval in s (e.g.: 60) for updating the FM DX server map
	BeepControl: false,  			// Acoustic control function for gps status (true or false)

