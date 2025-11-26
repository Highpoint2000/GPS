(() => {
  ////////////////////////////////////////////////////////////////
  ///                                                          ///
  ///  GPS CLIENT SCRIPT FOR FM-DX-WEBSERVER (V2.0a)           ///
  ///                                                          ///
  ///  by Highpoint                last update: 26.11.25       ///
  ///                                                          ///
  ///  https://github.com/Highpoint2000/gps                    ///
  ///                                                          ///
  ////////////////////////////////////////////////////////////////

  // ------------- Configuration ----------------
  const pluginSetupOnlyNotify = true;
  const CHECK_FOR_UPDATES = true;
  
  ///////////////////////////////////////////////////////////////

  // Plugin metadata
  
  const pluginVersion = '2.0a';
  const pluginName = "GPS";
  const pluginHomepageUrl = "https://github.com/Highpoint2000/GPS/releases";
  const pluginUpdateUrl = "https://raw.githubusercontent.com/highpoint2000/GPS/main/GPS/gps.js";
  let   isAuth = false;

  // WebSocket endpoint derived from current URL
  const url = new URL(window.location.href);
  const host = url.hostname;
  const path = url.pathname.replace(/setup/g, '');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_URL = `${proto}//${host}:${port}${path}data_plugins`;
  let ws = null;

// Function for update notification in /setup
function checkUpdate(setupOnly, pluginName, urlUpdateLink, urlFetchLink) {
    if (setupOnly && window.location.pathname !== '/setup') return;

    let pluginVersionCheck = typeof pluginVersion !== 'undefined' ? pluginVersion : typeof plugin_version !== 'undefined' ? plugin_version : typeof PLUGIN_VERSION !== 'undefined' ? PLUGIN_VERSION : 'Unknown';

    // Function to check for updates
    async function fetchFirstLine() {
        const urlCheckForUpdate = urlFetchLink;

        try {
            const response = await fetch(urlCheckForUpdate);
            if (!response.ok) {
                throw new Error(`[${pluginName}] update check HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            const lines = text.split('\n');

            let version;

            if (lines.length > 2) {
                const versionLine = lines.find(line => line.includes("const pluginVersion =") || line.includes("const plugin_version =") || line.includes("const PLUGIN_VERSION ="));
                if (versionLine) {
                    const match = versionLine.match(/const\s+(?:pluginVersion|plugin_version|PLUGIN_VERSION)\s*=\s*['"]([^'"]+)['"]/);
                    if (match) {
                        version = match[1];
                    }
                }
            }

            if (!version) {
                const firstLine = lines[0].trim();
                version = /^\d/.test(firstLine) ? firstLine : "Unknown"; // Check if first character is a number
            }

            return version;
        } catch (error) {
            console.error(`[${pluginName}] error fetching file:`, error);
            return null;
        }
    }

    // Check for updates
    fetchFirstLine().then(newVersion => {
        if (newVersion) {
            if (newVersion !== pluginVersionCheck) {
                let updateConsoleText = "There is a new version of this plugin available";
                // Any custom code here
                
                console.log(`[${pluginName}] ${updateConsoleText}`);
                setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink);
            }
        }
    });

    function setupNotify(pluginVersionCheck, newVersion, pluginName, urlUpdateLink) {
        if (window.location.pathname === '/setup') {
          const pluginSettings = document.getElementById('plugin-settings');
          if (pluginSettings) {
            const currentText = pluginSettings.textContent.trim();
            const newText = `<a href="${urlUpdateLink}" target="_blank">[${pluginName}] Update available: ${pluginVersionCheck} --> ${newVersion}</a><br>`;

            if (currentText === 'No plugin settings are available.') {
              pluginSettings.innerHTML = newText;
            } else {
              pluginSettings.innerHTML += ' ' + newText;
            }
          }

          const updateIcon = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece') || document.querySelector('.wrapper-outer .sidenav-content') || document.querySelector('.sidenav-content');

          const redDot = document.createElement('span');
          redDot.style.display = 'block';
          redDot.style.width = '12px';
          redDot.style.height = '12px';
          redDot.style.borderRadius = '50%';
          redDot.style.backgroundColor = '#FE0830' || 'var(--color-main-bright)'; // Theme colour set here as placeholder only
          redDot.style.marginLeft = '82px';
          redDot.style.marginTop = '-12px';

          updateIcon.appendChild(redDot);
        }
    }
}

if (CHECK_FOR_UPDATES) checkUpdate(pluginSetupOnlyNotify, pluginName, pluginHomepageUrl, pluginUpdateUrl);

  // ------------- WebSocket Setup ----------------
  async function setupWebSocket() {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      try {
        ws = new WebSocket(WS_URL);
        ws.addEventListener('open', () => console.log('WebSocket connected'));
        ws.addEventListener('message', handleMessage);
        ws.addEventListener('error', e => console.error('WebSocket error', e));
        ws.addEventListener('close', e => {
          console.log('WebSocket closed', e);
          setTimeout(setupWebSocket, 5000);
        });
      } catch (err) {
        console.error('WebSocket setup failed', err);
        sendToast('error important', pluginName, 'WebSocket setup failed', false, false);
        setTimeout(setupWebSocket, 5000);
      }
    }
  }

  // ------------- Handle Incoming Messages ----------------
  let lastStatus = null;
  function handleMessage(evt) {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'GPS' && msg.value) {
        const { status, lat, lon, alt, mode } = msg.value;

        // Update text fields
        document.getElementById('gps-status').textContent = status;
        document.getElementById('gps-lat')  .textContent = parseFloat(lat).toFixed(6);
        document.getElementById('gps-lon')  .textContent = parseFloat(lon).toFixed(6);
        document.getElementById('gps-alt')  .textContent = parseFloat(alt).toFixed(1);
        document.getElementById('gps-mode') .textContent = mode;

        // Update map marker and recenter map
        if (window.gpsMap && window.gpsMarker) {
          const y = parseFloat(lat), x = parseFloat(lon);
          window.gpsMarker.setLatLng([y, x]);
          window.gpsMap.setView([y, x]);
        }

        // Show toast when status changes
        if (status !== lastStatus) {
          const toastMap = {
            active:   ['success important', 'Received data'],
            inactive: ['warning', 'No data received'],
            off:      ['info',    'Receiver off'],
            error:    ['error important', 'Connection lost']
          };
          const [cls, txt] = toastMap[status] || ['warning', `Status: ${status}`];
          sendToast(cls, pluginName, txt, false, false);
          lastStatus = status;
        }
      }
    } catch (e) {
      console.error('Error parsing GPS message', e, evt.data);
    }
  }

  // ------------- Admin Check & Initialization ----------------
  function checkAdmin() {
    const text = document.body.textContent || document.body.innerText;
    isAuth = text.includes('You are logged in as an administrator.')
          || text.includes('You are logged in as an adminstrator.');
    console.log(isAuth ? 'Admin authentication OK' : 'Admin authentication failed');
  }

  setupWebSocket();
  checkAdmin();
  setTimeout(() => { if (updateInfo && isAuth) checkPluginVersion(); }, 200);

  // ------------- Leaflet Inclusion ----------------
  const leafletCSS = document.createElement('link');
  leafletCSS.rel = 'stylesheet';
  leafletCSS.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(leafletCSS);

  const leafletJS = document.createElement('script');
  leafletJS.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  document.head.appendChild(leafletJS);

  // ------------- Overlay & Map Elements ----------------
  const overlayStyle = document.createElement('style');
  overlayStyle.innerHTML = `
    #gps-overlay { position:fixed; padding:8px; display:none;
      background:transparent; color:#fff;
      font:14px sans-serif; border-radius:6px;
      z-index:1500; cursor:move; user-select:none;
    }
    #gps-overlay>div { display:flex; gap:8px; }
    #gps-data { flex-shrink:0; }
    #gps-data div { margin:2px 0; }
    #gps-map { width:200px; height:150px;
      border:1px solid rgba(255,255,255,0.3);
      border-radius:4px;
    }
  `;
  document.head.appendChild(overlayStyle);

  const overlay = document.createElement('div');
  overlay.id = 'gps-overlay';
  overlay.innerHTML = `
    <div>
    <!-- Header and map side by side -->
    <div id="gps-info" style="display: flex; flex-direction: column; gap: 8px;">
      <h3 style="margin: 0; font-size: 16px;">GPS Live Monitor</h3>
      <div id="gps-data" style="line-height: 1.4;">
        <div><strong>Status:</strong> <span id="gps-status">–</span></div>
        <div><strong>Lat:</strong>    <span id="gps-lat">–</span></div>
        <div><strong>Lon:</strong>    <span id="gps-lon">–</span></div>
        <div><strong>Height:</strong><span id="gps-alt">–</span> m</div>
        <div><strong>Mode:</strong>   <span id="gps-mode">–</span></div>
      </div>
    </div>      <div id="gps-map"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Restore saved overlay position or use defaults
  const posX = localStorage.getItem('gpsOverlayLeft');
  const posY = localStorage.getItem('gpsOverlayTop');
  overlay.style.left = posX || '20px';
  overlay.style.top  = posY || '60px';

  // ------------- Make Overlay Draggable ----------------
  (function() {
    let dragging = false, sx, sy, ox, oy;
    overlay.addEventListener('mousedown', e => {
      if (window.gpsMap && window.gpsMap.dragging) gpsMap.dragging.disable();
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = overlay.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      overlay.style.left = ox + (e.clientX - sx) + 'px';
      overlay.style.top  = oy + (e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (window.gpsMap && window.gpsMap.dragging) gpsMap.dragging.enable();
      localStorage.setItem('gpsOverlayLeft', overlay.style.left);
      localStorage.setItem('gpsOverlayTop',  overlay.style.top);
    });
  })();

  // ------------- Initialize Leaflet Map ----------------
  leafletJS.onload = () => {
    window.gpsMap = L.map('gps-map', { zoomControl:false, attributionControl:false })
      .setView([0,0],14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 })
      .addTo(window.gpsMap);
    window.gpsMarker = L.marker([0,0]).addTo(window.gpsMap);

    // Add crosshair at center
    const crosshair = document.createElement('style');
    crosshair.innerHTML = `
      #gps-map { position:relative; }
      #gps-map::after {
        content: '';
        position: absolute;
        top: 50%; left: 50%;
        width: 16px; height: 16px;
        margin: -8px 0 0 -8px;
        background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="3" fill="red" stroke="white" stroke-width="1"/></svg>') no-repeat center;
        pointer-events: none;
      }
    `;
    document.head.appendChild(crosshair);
  };

  // ------------- Toolbar Button ----------------
  (function() {
    const btnId = 'GPS-on-off';
    let active = false, found = false;
    const obs = new MutationObserver((_, o) => {
      if (typeof addIconToPluginPanel === 'function') {
        found = true; o.disconnect();
        addIconToPluginPanel(btnId, 'GPS', 'solid', 'location-dot', `Plugin Version: ${pluginVersion}`);
        const btnObs = new MutationObserver((_, o2) => {
          const $btn = $(`#${btnId}`);
		  $btn.addClass("hide-phone bg-color-2");
          if ($btn.length) {
            o2.disconnect();
            const css = `
              #${btnId}:hover { color: var(--color-5); filter: brightness(120%); }
              #${btnId}.active { background-color: var(--color-2)!important; filter: brightness(120%); }
            `;
            $("<style>").prop("type","text/css").html(css).appendTo("head");
            $btn.on('click', () => {
				active = !active;
				$btn.toggleClass('active', active);

				if (active) {
				// fade in
					$('#gps-overlay').stop(true,true).fadeIn(400, () => {
						if (window.gpsMap) {
							gpsMap.invalidateSize();
							const y = parseFloat($('#gps-lat').text()) || 0;
							const x = parseFloat($('#gps-lon').text()) || 0;
							gpsMap.setView([y, x]);
						}
					});
				} else {
				// fade out
					$('#gps-overlay').stop(true,true).fadeOut(400);
				}
			});

          }
        });
        btnObs.observe(document.body, { childList: true, subtree: true });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { if (!found) obs.disconnect(); }, 10000);
  })();

})();