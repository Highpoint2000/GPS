(() => {
////////////////////////////////////////////////////////////////
///                                                          ///
///  GPS CLIENT SCRIPT FOR FM-DX-WEBSERVER (V1.0)  			 ///
///                                                          ///
///  by Highpoint                last update: 06.01.25       ///
///                                                          ///
///  https://github.com/Highpoint2000/gps               ///
///                                                          ///
////////////////////////////////////////////////////////////////

const updateInfo = true; // Enable or disable version check

/////////////////////////////////////////////////////////////////

    const plugin_version = '1.0';
	const plugin_path = 'https://raw.githubusercontent.com/highpoint2000/GPS/';
	const plugin_JSfile = 'main/GPS/gps.js'
	const plugin_name = 'GPS Plugin'; 
    var isTuneAuthenticated = false;
	const PluginUpdateKey = `${plugin_name}_lastUpdateNotification`; // Unique key for localStorage

    // data_pluginsct WebserverURL and WebserverPORT from the current page URL
    const currentURL = new URL(window.location.href);
    const WebserverURL = currentURL.hostname;
    const WebserverPath = currentURL.pathname.replace(/setup/g, '');
    let WebserverPORT = currentURL.port || (currentURL.protocol === 'https:' ? '443' : '80'); // Default ports if not specified

    // Determine WebSocket protocol and port
    const protocol = currentURL.protocol === 'https:' ? 'wss:' : 'ws:'; // Determine WebSocket protocol
    const WebsocketPORT = WebserverPORT; // Use the same port as HTTP/HTTPS
    const WEBSOCKET_URL = `${protocol}//${WebserverURL}:${WebsocketPORT}${WebserverPath}data_plugins`; // WebSocket URL with /data_plugins

	let wsSocket = null; // Global variable for WebSocket connection

	// Function to check if the notification was shown today
  function shouldShowNotification() {
    const lastNotificationDate = localStorage.getItem(PluginUpdateKey);
    const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

    if (lastNotificationDate === today) {
      return false; // Notification already shown today
    }
    // Update the date in localStorage to today
    localStorage.setItem(PluginUpdateKey, today);
    return true;
  }

  // Function to check plugin version
  function checkplugin_version() {
    // Fetch and evaluate the plugin script
    fetch(`${plugin_path}${plugin_JSfile}`)
      .then(response => response.text())
      .then(script => {
        // Search for plugin_version in the external script
        const plugin_versionMatch = script.match(/const plugin_version = '([\d.]+[a-z]*)?';/);
        if (!plugin_versionMatch) {
          console.error(`${plugin_name}: Plugin version could not be found`);
          return;
        }

        const externalplugin_version = plugin_versionMatch[1];

        // Function to compare versions
		function compareVersions(local, remote) {
			const parseVersion = (version) =>
				version.split(/(\d+|[a-z]+)/i).filter(Boolean).map((part) => (isNaN(part) ? part : parseInt(part, 10)));

			const localParts = parseVersion(local);
			const remoteParts = parseVersion(remote);

			for (let i = 0; i < Math.max(localParts.length, remoteParts.length); i++) {
				const localPart = localParts[i] || 0; // Default to 0 if part is missing
				const remotePart = remoteParts[i] || 0;

				if (typeof localPart === 'number' && typeof remotePart === 'number') {
					if (localPart > remotePart) return 1;
					if (localPart < remotePart) return -1;
				} else if (typeof localPart === 'string' && typeof remotePart === 'string') {
					// Lexicographical comparison for strings
					if (localPart > remotePart) return 1;
					if (localPart < remotePart) return -1;
				} else {
					// Numeric parts are "less than" string parts (e.g., `3.5` < `3.5a`)
					return typeof localPart === 'number' ? -1 : 1;
				}
			}

			return 0; // Versions are equal
		}


        // Check version and show notification if needed
        const comparisonResult = compareVersions(plugin_version, externalplugin_version);
        if (comparisonResult === 1) {
          // Local version is newer than the external version
          console.log(`${plugin_name}: The local version is newer than the plugin version.`);
        } else if (comparisonResult === -1) {
          // External version is newer and notification should be shown
          if (shouldShowNotification()) {
            console.log(`${plugin_name}: Plugin update available: ${plugin_version} -> ${externalplugin_version}`);
			sendToast('warning important', `${plugin_name}`, `Update available:<br>${plugin_version} -> ${externalplugin_version}`, false, false);
            }
        } else {
          // Versions are the same
          console.log(`${plugin_name}: The local version matches the plugin version.`);
        }
      })
      .catch(error => {
        console.error(`${plugin_name}: Error fetching the plugin script:`, error);
      });
	}

    // Function to set up WebSocket connection for sending messages
    async function setupWebSocket() {
        if (!wsSocket || wsSocket.readyState === WebSocket.CLOSED) {
            try {
                wsSocket = new WebSocket(WEBSOCKET_URL);
                wsSocket.addEventListener("open", () => {
                    console.log("WebSocket connected.");
                });
                wsSocket.addEventListener("message", handleWebSocketMessage);
                wsSocket.addEventListener("error", (error) => console.error("Send WebSocket error:", error));
                wsSocket.addEventListener("close", (event) => {
                    console.log("WebSocket closed:", event);
                    setTimeout(setupWebSocket, 5000); // Reconnect after 5 seconds
                });
            } catch (error) {
                console.error("Failed to setup Send WebSocket:", error);
				sendToast('error important', 'GPS Plugin', `Failed to setup WebSocket`, false, false);	
                setTimeout(setupWebSocket, 5000); // Reconnect after 5 seconds
            }
        }
    }

// Variable to store the previous status
let previousStatus = null;

// Function to handle WebSocket messages
function handleWebSocketMessage(event) {
    try {
        const eventData = JSON.parse(event.data);

        // Check if the message type is 'GPS'
        if (eventData.type === 'GPS') {
            let { status } = eventData.value || {}; // Safeguard against undefined `value`

            // Only proceed if the status has changed
            if (status !== previousStatus) {
                switch (status) {
                    case 'active':
                        sendToast('success important', 'GPS Plugin', `received GPS data`, false, false);
                        console.log("Server response: GPS Plugin received data");
                        break;
                    case 'inactive':
                        sendToast('warning', 'GPS Plugin', 'Warning! No received GPS data', false, false);
                        console.warn("Server response: GPS Plugin received no data");
                        break;
                    case 'off':
                        sendToast('info', 'GPS Plugin', 'GPS receiver not activated', false, false);
                        console.log("Server response: GPS receiver not activated");
                        break;
                    case 'error':
                        sendToast('error important', 'GPS Plugin', 'GPS connection lost', false, false);
                        console.error("Server response: GPS connection lost");
                        break;
                    default:
                        console.warn("Unhandled GPS status:", status);
                        sendToast('warning', 'GPS Plugin', `Unhandled GPS status: ${status}`, false, false);
                }

                // Update the previous status
                previousStatus = status;
            }
        } else {
            console.warn("Unhandled WebSocket message type:", eventData.type);
        }
    } catch (error) {
        console.error("Error handling WebSocket message:", error, "Event data:", event.data);
    }
}


    function checkAdminMode() {
        const bodyText = document.body.textContent || document.body.innerText;
        isTuneAuthenticated = bodyText.includes("You are logged in as an administrator.") || bodyText.includes("You are logged in as an adminstrator.");
        console.log(isTuneAuthenticated ? `URDS Upload Authentication successful.` : "Authentication failed.");
    }
	
	// Initialize the alert button once the DOM is fully loaded
    setTimeout(() => {
        setupWebSocket();
        checkAdminMode();
     }, 1000);
	
	setTimeout(() => {
	// Execute the plugin version check if updateInfo is true and admin ist logged on
	if (updateInfo && isTuneAuthenticated) {
		checkplugin_version();
		}
	}, 200);

})();
