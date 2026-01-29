(() => {
  ////////////////////////////////////////////////////////////////
  ///                                                          ///
  ///  GPS CLIENT SCRIPT FOR FM-DX-WEBSERVER (V2.1)           ///
  ///                                                          ///
  ///  by Highpoint                last update: 29.01.26       ///
  ///                                                          ///
  ///  https://github.com/Highpoint2000/gps                    ///
  ///                                                          ///
  ////////////////////////////////////////////////////////////////

  // ------------- Configuration ----------------
  const pluginSetupOnlyNotify = true;
  const CHECK_FOR_UPDATES = true;

  ///////////////////////////////////////////////////////////////

  // Plugin metadata
  const pluginVersion = '2.1';
  const pluginName = "GPS";
  const pluginHomepageUrl = "https://github.com/Highpoint2000/GPS/releases";
  const pluginUpdateUrl = "https://raw.githubusercontent.com/highpoint2000/GPS/main/GPS/gps.js";
  let isAuth = false;

  // WebSocket endpoint derived from current URL
  const url = new URL(window.location.href);
  const host = url.hostname;
  const path = url.pathname.replace(/setup/g, '');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_URL = `${proto}//${host}:${port}${path}data_plugins`;
  let ws = null;

  // Store drawn satellite positions for mouseover detection
  let drawnSatellites = [];

  // ------------------------------------------------------------------
  // Fallback for sendToast() if not provided by the main webserver UI
  // ------------------------------------------------------------------
  if (typeof sendToast !== "function") {
    window.sendToast = function (cls, src, txt) {
      console.log(`[TOAST-Fallback] ${src}: ${cls} → ${txt}`);
    };
  }

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
          version = /^\d/.test(firstLine) ? firstLine : "Unknown";
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
        redDot.style.backgroundColor = '#FE0830';
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
        const { status, lat, lon, alt, mode, hdop, satellites } = msg.value;

        // Update text fields and apply color logic
        const statusEl = document.getElementById('gps-status');
        if (statusEl) {
            statusEl.textContent = status;
            if (status === 'active') {
                statusEl.style.color = '#55ff55'; // Light Green
            } else if (status === 'inactive') {
                statusEl.style.color = '#ff5555'; // Red
            } else {
                statusEl.style.color = '#aaa'; // Default Gray
            }
        }

        document.getElementById('gps-lat').textContent = parseFloat(lat).toFixed(6);
        document.getElementById('gps-lon').textContent = parseFloat(lon).toFixed(6);
        document.getElementById('gps-alt').textContent = parseFloat(alt).toFixed(1);
        
        // Added unit "m" to Accuracy
        document.getElementById('gps-acc').textContent = hdop ? (parseFloat(hdop).toFixed(1) + ' m') : '–';
        
        document.getElementById('gps-mode').textContent = mode;

        // Update map marker and recenter map
        if (window.gpsMap && window.gpsMarker) {
          const y = parseFloat(lat), x = parseFloat(lon);
          if (!isNaN(y) && !isNaN(x)) {
            window.gpsMarker.setLatLng([y, x]);
            window.gpsMap.setView([y, x]);
          }
        }

        // Draw Satellites if available
        if (Array.isArray(satellites)) {
            drawSatelliteView(satellites);
        } else {
            drawSatelliteView([]); // Clear if no data
        }

        // Show toast when status changes
        if (status !== lastStatus) {
          const toastMap = {
            active: ['success important', 'Received data'],
            inactive: ['warning', 'No data received'],
            off: ['info', 'Receiver off'],
            error: ['error important', 'Connection lost']
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

  // ------------- Satellite View Drawer ----------------
  function drawSatelliteView(sats) {
      const canvas = document.getElementById('gps-sat-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      
      const r = (Math.min(w, h) / 2) - 18; 

      // Clear Canvas and Reset detected sats
      ctx.clearRect(0, 0, w, h);
      drawnSatellites = []; // Reset storage for hover detection

      // Draw Grid (Polar Plot)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;

      // Outer circle (0 deg elevation)
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
      // Middle circle (45 deg)
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI); ctx.stroke();
      // Center dot (90 deg)
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 2 * Math.PI); ctx.fill();

      // Crosshairs
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();

      // Directions
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px Arial';
      
      // North
      ctx.textAlign = 'center'; 
      ctx.textBaseline = 'bottom';
      ctx.fillText('N', cx, cy - r - 3);
      
      // East
      ctx.textAlign = 'left'; 
      ctx.textBaseline = 'middle';
      ctx.fillText('E', cx + r + 4, cy);
      
      // South
      ctx.textAlign = 'center'; 
      ctx.textBaseline = 'top';
      ctx.fillText('S', cx, cy + r + 3);
      
      // West
      ctx.textAlign = 'right'; 
      ctx.textBaseline = 'middle';
      ctx.fillText('W', cx - r - 4, cy);

      // Draw Satellites
      sats.forEach(sat => {
          if (typeof sat.az === 'undefined' || typeof sat.el === 'undefined') return;

          // Convert Azimuth (0=N, 90=E) to Canvas Angle (0=E, 90=S)
          // Math Angle = (Az - 90) radians
          const angleRad = (sat.az - 90) * (Math.PI / 180);
          
          // Radius: 90 deg elev = 0 radius, 0 deg elev = max radius
          const dist = r * (1 - (sat.el / 90));

          const x = cx + dist * Math.cos(angleRad);
          const y = cy + dist * Math.sin(angleRad);

          // Store for hover detection
          drawnSatellites.push({ x, y, radius: 6, data: sat });

          // Color by SNR
          let color = '#888'; // No signal
          if (sat.snr > 40) color = '#0f0'; // Strong
          else if (sat.snr > 30) color = '#adff2f'; // Good
          else if (sat.snr > 15) color = '#ffa500'; // Weak
          else if (sat.snr > 0) color = '#f00'; // Bad

          // Draw Sat Dot
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
          
          // Draw PRN
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px Arial';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(sat.prn, x + 6, y);
      });
  }

  // ------------- Tooltip Logic ----------------
  function setupTooltip() {
      const canvas = document.getElementById('gps-sat-canvas');
      const tooltip = document.getElementById('gps-tooltip');
      
      if (!canvas || !tooltip) return;

      canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          let found = false;

          // Check if mouse is over any satellite
          for (const sat of drawnSatellites) {
              const dx = mouseX - sat.x;
              const dy = mouseY - sat.y;
              // Check distance (hitbox slightly larger than drawn dot)
              if (dx*dx + dy*dy <= sat.radius * sat.radius * 2) {
                  found = true;
                  
                  // Populate Tooltip
                  tooltip.innerHTML = `
                    <strong>PRN:</strong> ${sat.data.prn}<br>
                    <strong>Sys:</strong> ${sat.data.sys}<br>
                    <strong>SNR:</strong> ${sat.data.snr} dB<br>
                    <strong>Az:</strong> ${sat.data.az}°<br>
                    <strong>El:</strong> ${sat.data.el}°
                  `;
                  
                  // Position Tooltip
                  tooltip.style.left = (e.clientX + 10) + 'px';
                  tooltip.style.top = (e.clientY + 10) + 'px';
                  tooltip.style.display = 'block';
                  
                  canvas.style.cursor = 'pointer';
                  break;
              }
          }

          if (!found) {
              tooltip.style.display = 'none';
              canvas.style.cursor = 'default';
          }
      });

      canvas.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
      });
  }

  // Wait for DOM elements to exist before attaching event listeners
  const tooltipObserver = new MutationObserver((_, obs) => {
      if (document.getElementById('gps-sat-canvas')) {
          setupTooltip();
          obs.disconnect();
      }
  });
  tooltipObserver.observe(document.body, { childList: true, subtree: true });


  // ------------- Admin Check & Initialization ----------------
  function checkAdmin() {
    const text = document.body.textContent || document.body.innerText;
    isAuth = text.includes('You are logged in as an administrator.')
      || text.includes('You are logged in as an adminstrator.');
    console.log(isAuth ? 'Admin authentication OK' : 'Admin authentication failed');
  }

  setupWebSocket();
  checkAdmin();

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
    #gps-overlay { position:fixed; padding:10px; display:none;
      background-color: var(--color-1);
      color:#fff;
      font-family: sans-serif; 
      border-radius:8px;
      z-index:1500; cursor:move; user-select:none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      border: 1px solid #444;
    }
    #gps-container { display:flex; flex-direction: row; gap: 15px; align-items: stretch; }
    
    /* Info Column */
    #gps-info-col { 
        display:flex; flex-direction: column; 
        min-width: 140px; 
        justify-content: center;
    }
    #gps-info-col h3 {
        margin: 0 0 10px 0;
        font-size: 16px;
        color: #4da6ff; /* Header Blue */
        border-bottom: 1px solid #555;
        padding-bottom: 5px;
        font-weight: bold;
    }
    #gps-data { font-size: 13px; line-height: 1.6; }
    #gps-data div { margin:0; white-space: nowrap; color: #ddd; }
    #gps-data strong { color: #fff; display: inline-block; width: 60px; }

    /* Map Column */
    #gps-map-container {
        width: 160px; height: 160px;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid #666;
    }
    #gps-map { width: 100%; height: 100%; }

    /* Satellite View Column */
    #gps-sat-container {
        width: 160px; height: 160px;
        border: 1px solid #666;
        border-radius: 6px;
        background: transparent;
        display: flex; align-items: center; justify-content: center;
    }
    #gps-sat-canvas { width: 160px; height: 160px; display: block; }

    /* Tooltip Styling */
    #gps-tooltip {
        position: fixed;
        background: var(--color-1);
        border: 1px solid #777;
        color: #fff;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        display: none;
        z-index: 2000;
        box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        line-height: 1.4;
    }
  `;
  document.head.appendChild(overlayStyle);

  const overlay = document.createElement('div');
  overlay.id = 'gps-overlay';
  overlay.innerHTML = `
    <div id="gps-container">
        <!-- 1. Left: Satellite View -->
        <div id="gps-sat-container">
            <canvas id="gps-sat-canvas" width="160" height="160"></canvas>
        </div>

        <!-- 2. Middle: Info Column -->
        <div id="gps-info-col">
            <h3>GPS Monitor</h3>
            <div id="gps-data">
                <div><strong>Status:</strong> <span id="gps-status" style="color:#aaa">–</span></div>
                <div><strong>Lat:</strong> <span id="gps-lat">–</span></div>
                <div><strong>Lon:</strong> <span id="gps-lon">–</span></div>
                <div><strong>Alt:</strong> <span id="gps-alt">–</span> m</div>
                <div><strong>Acc:</strong> <span id="gps-acc">–</span></div>
                <div><strong>Mode:</strong> <span id="gps-mode">–</span></div>
            </div>
        </div>
        
        <!-- 3. Right: Map -->
        <div id="gps-map-container">
             <div id="gps-map"></div>
        </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Create Tooltip Element
  const tooltip = document.createElement('div');
  tooltip.id = 'gps-tooltip';
  document.body.appendChild(tooltip);

  // Restore saved overlay position or use defaults
  const posX = localStorage.getItem('gpsOverlayLeft');
  const posY = localStorage.getItem('gpsOverlayTop');
  overlay.style.left = posX || '20px';
  overlay.style.top = posY || '60px';

  // ------------- Make Overlay Draggable ----------------
  (function () {
    let dragging = false, sx, sy, ox, oy;
    overlay.addEventListener('mousedown', e => {
      // Prevent drag if clicking on canvas (so we can interact if needed, though dragging usually takes precedence)
      // But we want the whole card to be draggable.
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
      overlay.style.top = oy + (e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (window.gpsMap && window.gpsMap.dragging) gpsMap.dragging.enable();
      localStorage.setItem('gpsOverlayLeft', overlay.style.left);
      localStorage.setItem('gpsOverlayTop', overlay.style.top);
    });
  })();

  // ------------- Initialize Leaflet Map ----------------
  leafletJS.onload = () => {
    window.gpsMap = L.map('gps-map', { zoomControl: false, attributionControl: false })
      .setView([0, 0], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 })
      .addTo(window.gpsMap);
    window.gpsMarker = L.marker([0, 0]).addTo(window.gpsMap);

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
  (function () {
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
            $("<style>").prop("type", "text/css").html(css).appendTo("head");
            $btn.on('click', () => {
              active = !active;
              $btn.toggleClass('active', active);

              if (active) {
                // fade in
                $('#gps-overlay').stop(true, true).fadeIn(400, () => {
                  if (window.gpsMap) {
                    gpsMap.invalidateSize();
                    const y = parseFloat($('#gps-lat').text()) || 0;
                    const x = parseFloat($('#gps-lon').text()) || 0;
                    gpsMap.setView([y, x]);
                  }
                });
              } else {
                // fade out
                $('#gps-overlay').stop(true, true).fadeOut(400);
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