/**
 * app.js
 * 
 * Vanilla JavaScript Single-Page Application for Singapore Carpark & EV Locator.
 * Strictly adheres to Material Design 3 and WCAG 2.1 AA standards.
 * 
 * Every function is thoroughly documented below to guide HTML/CSS developers.
 */

// Global State Management Object
const appState = {
  // Current active map center coordinates (Default: Raffles Place, Singapore)
  currentLat: 1.2838,
  currentLng: 103.8515,
  currentLocationName: "Raffles Place, Singapore",
  
  // Search radius in kilometers (Bounded between 1.0 km and 3.0 km)
  searchRadiusKm: 1.5,
  
  // EV charging filter toggle state (true = EV lots only)
  evOnlyFilter: false,
  
  // List of parsed carpark objects returned by /api/insight
  carparksList: [],
  
  // 60-Second Auto Refresh Timer tracking variables
  refreshIntervalSeconds: 60,
  secondsRemaining: 60,
  timerIntervalId: null,
  isFetchingData: false,
  
  // Active selected carpark object for the modal
  selectedCarpark: null
};

// Map & Layer References
let leafletMap = null;
let userLocationMarker = null;
let radiusCircleLayer = null;
let carparkMarkersLayerGroup = null;

// Debounce timer handle for slider adjustments
let sliderDebounceTimer = null;

/**
 * =========================================================================
 * 1. INITIALIZATION & LIFECYCLE
 * =========================================================================
 * Entry point executed when the DOM content has fully loaded in the browser.
 */
document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize the interactive map canvas
  initInteractiveMap();

  // 2. Attach UI event listeners to all interactive buttons, inputs and toggles
  setupEventListeners();

  // 3. Request user's device geolocation, with graceful fallback to Singapore center
  requestUserGeolocation();

  // 4. Start the 1-minute auto-refresh countdown loop
  startAutoRefreshTimer();
});

/**
 * Initializes the Leaflet map viewport centered on Singapore.
 * Uses official OneMap Singapore Land Authority (SLA) base map tiles.
 */
function initInteractiveMap() {
  // Default coordinates: Singapore Central Area (Raffles Place)
  const initialCoordinates = [appState.currentLat, appState.currentLng];

  // Instantiate Leaflet map on the #map-container DOM element with Singapore bounds
  const singaporeBounds = L.latLngBounds(
    [1.1304753, 103.602084],
    [1.4784001, 104.094504]
  );

  leafletMap = L.map("map-container", {
    center: initialCoordinates,
    zoom: 15,
    minZoom: 11,
    maxZoom: 19,
    maxBounds: singaporeBounds,
    maxBoundsViscosity: 0.8,
    zoomControl: false // Reposition zoom controls for clean mobile layout
  });

  // Add zoom control to top-left
  L.control.zoom({ position: "topleft" }).addTo(leafletMap);

  // Load official Singapore OneMap SLA raster tiles
  L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
    minZoom: 11,
    maxZoom: 19,
    bounds: singaporeBounds,
    attribution: 'Map &copy; <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; Singapore Land Authority | Data: LTA DataMall'
  }).addTo(leafletMap);

  // Initialize marker layer groups
  carparkMarkersLayerGroup = L.layerGroup().addTo(leafletMap);

  // Draw user's current location pin
  updateUserLocationMarker(appState.currentLat, appState.currentLng);

  // Draw radius boundary circle on map (1.5km initial)
  updateRadiusCircle(appState.currentLat, appState.currentLng, appState.searchRadiusKm);

  // Allow user to click anywhere on OneMap to inspect carparks around that point
  leafletMap.on("click", (e) => {
    const { lat, lng } = e.latlng;
    handleMapClickLocation(lat, lng);
  });
}

/**
 * Handles map click event by reverse geocoding via OneMap and updating search center.
 * @param {number} lat 
 * @param {number} lng 
 */
async function handleMapClickLocation(lat, lng) {
  appState.currentLat = lat;
  appState.currentLng = lng;
  appState.currentLocationName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  updateUserLocationMarker(lat, lng);
  updateRadiusCircle(lat, lng, appState.searchRadiusKm);

  // Deselect active quick chips
  const chipButtons = document.querySelectorAll(".chip-button");
  chipButtons.forEach(c => c.classList.remove("active"));

  // Attempt OneMap reverse geocode
  try {
    const revUrl = `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=40&addressType=All`;
    const res = await fetch(revUrl);
    if (res.ok) {
      const revData = await res.json();
      if (revData && revData.GeocodeInfo && revData.GeocodeInfo.length > 0) {
        const info = revData.GeocodeInfo[0];
        const addr = [info.BUILDINGNAME, info.ROAD, info.POSTALCODE].filter(Boolean).join(", ");
        if (addr) {
          appState.currentLocationName = addr;
        }
      }
    }
  } catch (e) {
    console.debug("OneMap reverse geocoding skipped:", e);
  }

  announceAccessibilityMessage(`Selected location on OneMap: ${appState.currentLocationName}. Fetching carparks.`);
  fetchNearbyCarparks();
}

/**
 * =========================================================================
 * 2. GEOLOCATION & LOCATION MANAGEMENT
 * =========================================================================
 */

/**
 * Requests the user's real physical coordinates via HTML5 Geolocation API.
 * If permission is denied, gracefully defaults to Singapore Central.
 */
function requestUserGeolocation() {
  showLoadingOverlay(true, "Detecting your location...");

  if (!navigator.geolocation) {
    announceAccessibilityMessage("Geolocation is not supported by your browser. Defaulting to Singapore city center.");
    fetchNearbyCarparks();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Successfully received device coordinates
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Ensure coordinates are reasonably within Singapore region (approx 1.1 to 1.5 lat, 103.6 to 104.1 lng)
      const isWithinSingapore = lat >= 1.15 && lat <= 1.48 && lng >= 103.58 && lng <= 104.08;

      if (isWithinSingapore) {
        appState.currentLat = lat;
        appState.currentLng = lng;
        appState.currentLocationName = "My Current Location";
      } else {
        // Outside Singapore, center on Singapore's core business district for testing
        appState.currentLat = 1.2838;
        appState.currentLng = 103.8515;
        appState.currentLocationName = "Raffles Place, Singapore";
      }

      updateUserLocationMarker(appState.currentLat, appState.currentLng);
      updateRadiusCircle(appState.currentLat, appState.currentLng, appState.searchRadiusKm);
      leafletMap.setView([appState.currentLat, appState.currentLng], 15);

      announceAccessibilityMessage(`Location set to ${appState.currentLocationName}. Loading carparks.`);
      fetchNearbyCarparks();
    },
    (error) => {
      console.warn("Geolocation access denied or unavailable:", error.message);
      announceAccessibilityMessage("Location access denied. Centering on Singapore Central.");
      fetchNearbyCarparks();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

/**
 * Updates or creates the user's location pin with animated pulse ring.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
function updateUserLocationMarker(lat, lng) {
  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lng]);
  } else {
    // Custom HTML div marker for user pin
    const userPinIcon = L.divIcon({
      className: "custom-user-marker-wrapper",
      html: `
        <div class="custom-user-marker">
          <div class="user-marker-pulse"></div>
          <div class="user-marker-dot"></div>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    userLocationMarker = L.marker([lat, lng], {
      icon: userPinIcon,
      zIndexOffset: 1000,
      title: "Your Target Location"
    }).addTo(leafletMap);
  }
}

/**
 * Draws or updates the radius visual boundary circle on the map.
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radiusKm - Search radius in kilometers
 */
function updateRadiusCircle(lat, lng, radiusKm) {
  const radiusMeters = radiusKm * 1000;

  if (radiusCircleLayer) {
    radiusCircleLayer.setLatLng([lat, lng]);
    radiusCircleLayer.setRadius(radiusMeters);
  } else {
    radiusCircleLayer = L.circle([lat, lng], {
      radius: radiusMeters,
      color: "#1565C0",
      weight: 2,
      dashArray: "6, 8",
      fillColor: "#2196F3",
      fillOpacity: 0.12
    }).addTo(leafletMap);
  }
}

/**
 * =========================================================================
 * 3. DATA FETCHING & API INTEGRATION (/api/insight)
 * =========================================================================
 */

/**
 * Queries the backend serverless API (/api/insight) with current user parameters.
 * Validates responses, maps markers on the map, and populates the list drawer.
 */
async function fetchNearbyCarparks() {
  if (appState.isFetchingData) return;
  appState.isFetchingData = true;

  showLoadingOverlay(true, "Fetching live lot availability...");
  spinRefreshIcon(true);

  // Construct API endpoint URL with query parameters
  const params = new URLSearchParams({
    lat: appState.currentLat.toFixed(5),
    lng: appState.currentLng.toFixed(5),
    radius: appState.searchRadiusKm.toFixed(1),
    evOnly: appState.evOnlyFilter ? "true" : "false",
    lotType: "C"
  });

  const apiUrl = `/api/insight?${params.toString()}`;

  try {
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`API returned HTTP status ${response.status}`);
    }

    const data = await response.json();
    appState.carparksList = data.carparks || [];

    // Render results to map markers and side list
    renderCarparkMarkersOnMap(appState.carparksList);
    renderCarparkCardsInDrawer(appState.carparksList, data.summary);
    updateSummaryBadges(data.summary);

    // Announce count to screen readers
    const total = appState.carparksList.length;
    announceAccessibilityMessage(`Found ${total} carparks within ${appState.searchRadiusKm} kilometers.`);

  } catch (error) {
    console.error("Failed to load carpark availability data:", error);
    renderErrorMessage("Unable to fetch live carpark data. Retrying on next cycle.");
  } finally {
    appState.isFetchingData = false;
    showLoadingOverlay(false);
    spinRefreshIcon(false);
    resetCountdownTimer();
  }
}

/**
 * =========================================================================
 * 4. MAP RENDERING & MARKERS
 * =========================================================================
 */

/**
 * Plots color-coded carpark pins on the Leaflet map.
 * Pins are colored based on lot availability rules:
 * - Red (< 5 lots)
 * - Orange (< 10 lots)
 * - Green (>= 10 lots)
 * - Lightning bolt indicator for EV charging
 * @param {Array} carparks - Array of processed carpark objects
 */
function renderCarparkMarkersOnMap(carparks) {
  // Clear any existing carpark markers from the map
  carparkMarkersLayerGroup.clearLayers();

  if (!carparks || carparks.length === 0) return;

  carparks.forEach((cp) => {
    // Determine pin CSS class and EV badge
    const colorClass = `pin-${cp.statusColor}`;
    const evIconHtml = cp.hasEvCharging ? `<span class="material-symbols-outlined pin-ev-icon">bolt</span>` : "";

    // Create custom HTML marker element
    const customIcon = L.divIcon({
      className: "custom-carpark-pin-container",
      html: `
        <div class="custom-carpark-pin ${colorClass}" title="${cp.development}: ${cp.availableLots} lots">
          ${evIconHtml}
          <span>${cp.availableLots}</span>
        </div>
      `,
      iconSize: [36, 32],
      iconAnchor: [18, 16]
    });

    const marker = L.marker([cp.latitude, cp.longitude], {
      icon: customIcon,
      title: `${cp.development} (${cp.availableLots} lots available)`
    });

    // Build interactive Leaflet popup content
    const popupContent = `
      <div class="popup-container">
        <div class="popup-title">${escapeHtml(cp.development)}</div>
        <div class="popup-lots-row">
          <span class="popup-badge" style="background-color: ${cp.hexColor};">${cp.availableLots} Available Lots</span>
          ${cp.hasEvCharging ? '<span class="card-ev-chip"><span class="material-symbols-outlined" style="font-size:13px;">bolt</span> EV</span>' : ''}
        </div>
        <div style="font-size: 0.8125rem; color: #64748B;">
          Distance: <strong>${cp.distanceKm} km</strong> | Agency: ${cp.agency}
        </div>
        <button type="button" class="popup-btn-nav" onclick="window.openCarparkModalById('${cp.id}')">
          View Details &amp; Directions
        </button>
      </div>
    `;

    marker.bindPopup(popupContent);
    marker.on("click", () => {
      appState.selectedCarpark = cp;
    });

    carparkMarkersLayerGroup.addLayer(marker);
  });
}

/**
 * =========================================================================
 * 5. LIST DRAWER & CARDS RENDERING
 * =========================================================================
 */

/**
 * Populates the side / slide-out drawer with detailed carpark cards.
 * @param {Array} carparks - Sorted carparks list
 * @param {Object} summary - Count metrics
 */
function renderCarparkCardsInDrawer(carparks, summary) {
  const container = document.getElementById("carparks-list-container");
  const statsLabel = document.getElementById("drawer-stats");
  const countBadge = document.getElementById("list-count-badge");

  if (!container) return;

  const total = carparks ? carparks.length : 0;
  countBadge.textContent = total;
  statsLabel.textContent = `Showing ${total} carparks within ${appState.searchRadiusKm} km`;

  if (total === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon" aria-hidden="true">local_parking</span>
        <p>No carparks found matching your criteria.</p>
        <p style="font-size: 0.8125rem; margin-top: 6px; color: #64748B;">Try increasing the search radius with the slider below or turning off the EV filter.</p>
      </div>
    `;
    return;
  }

  // Generate HTML for each carpark card
  const cardsHtml = carparks.map((cp) => {
    return `
      <article 
        class="carpark-card" 
        role="button" 
        tabindex="0" 
        data-id="${escapeHtml(cp.id)}"
        aria-label="${escapeHtml(cp.development)}, ${cp.availableLots} lots available, ${cp.distanceKm} kilometers away"
      >
        <div class="card-top-row">
          <h3 class="card-dev-name">${escapeHtml(cp.development)}</h3>
          <span class="card-agency-tag">${escapeHtml(cp.agency)}</span>
        </div>

        <div class="card-middle-row">
          <span class="card-lots-badge ${cp.badgeClass}">
            <span class="material-symbols-outlined" style="font-size: 16px;">directions_car</span>
            <strong>${cp.availableLots}</strong> Lots
          </span>

          <div class="card-meta-group">
            <span>${cp.distanceKm} km</span>
            ${cp.hasEvCharging ? `
              <span class="card-ev-chip" title="EV charging stations available">
                <span class="material-symbols-outlined" style="font-size: 14px;">bolt</span> EV
              </span>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }).join("");

  container.innerHTML = cardsHtml;

  // Add click and keyboard listeners to cards
  const cards = container.querySelectorAll(".carpark-card");
  cards.forEach((card) => {
    const cpId = card.getAttribute("data-id");
    const cp = carparks.find(item => item.id === cpId);

    const selectAction = () => {
      if (cp) {
        // Center map on this carpark
        leafletMap.setView([cp.latitude, cp.longitude], 16);
        openCarparkModal(cp);
      }
    };

    card.addEventListener("click", selectAction);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectAction();
      }
    });
  });
}

/**
 * Updates the summary pills on the drawer and bottom panel.
 * @param {Object} summary 
 */
function updateSummaryBadges(summary) {
  if (!summary) return;

  const totalEl = document.getElementById("lots-total-number");
  const greenEl = document.getElementById("stat-green-count");
  const orangeEl = document.getElementById("stat-orange-count");
  const redEl = document.getElementById("stat-red-count");
  const evEl = document.getElementById("stat-ev-count");

  if (totalEl) totalEl.textContent = summary.totalFound || 0;
  if (greenEl) greenEl.textContent = summary.greenCount || 0;
  if (orangeEl) orangeEl.textContent = summary.orangeCount || 0;
  if (redEl) redEl.textContent = summary.redCount || 0;
  if (evEl) evEl.textContent = summary.evCount || 0;
}

/**
 * =========================================================================
 * 6. MODAL DETAIL DIALOG
 * =========================================================================
 */

/**
 * Opens the carpark detail modal dialog.
 * @param {Object} cp - Carpark data object
 */
function openCarparkModal(cp) {
  if (!cp) return;
  appState.selectedCarpark = cp;

  const modal = document.getElementById("carpark-detail-modal");
  const nameEl = document.getElementById("modal-carpark-name");
  const agencyEl = document.getElementById("modal-agency-badge");
  const lotsEl = document.getElementById("modal-available-lots");
  const bannerEl = document.getElementById("modal-lot-banner");
  const statusTextEl = document.getElementById("modal-status-text");
  const distanceEl = document.getElementById("modal-distance-val");
  const vehicleEl = document.getElementById("modal-vehicle-val");
  const evEl = document.getElementById("modal-ev-val");
  const codeEl = document.getElementById("modal-code-val");
  const navBtn = document.getElementById("btn-modal-navigate");

  nameEl.textContent = cp.development;
  agencyEl.textContent = cp.agency;
  lotsEl.textContent = cp.availableLots;
  statusTextEl.textContent = cp.statusText;
  
  // Set banner color class
  bannerEl.className = `modal-lot-banner status-${cp.statusColor}`;

  distanceEl.textContent = `${cp.distanceKm} km away (~${Math.round(cp.distanceKm * 3)} mins drive)`;
  vehicleEl.textContent = cp.lotType === "C" ? "Cars (Class C)" : `Vehicle Type ${cp.lotType}`;
  codeEl.textContent = `#${cp.id}`;

  if (cp.hasEvCharging) {
    evEl.innerHTML = `<span class="ev-status-tag"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">bolt</span> EV Charging Available</span>`;
  } else {
    evEl.textContent = "No EV chargers listed";
  }

  // OneMap navigation driving route link
  const directionsUrl = `https://www.onemap.gov.sg/main/v2/route?start=${appState.currentLat},${appState.currentLng}&end=${cp.latitude},${cp.longitude}&routeType=drive`;
  navBtn.setAttribute("href", directionsUrl);
  navBtn.setAttribute("title", "Open directions on OneMap");

  modal.classList.remove("is-hidden");
  announceAccessibilityMessage(`Details opened for ${cp.development}. ${cp.availableLots} lots available.`);
}

/**
 * Global helper attached to window so Leaflet popup HTML strings can trigger modal.
 */
window.openCarparkModalById = function(cpId) {
  const cp = appState.carparksList.find(item => item.id === cpId);
  if (cp) {
    openCarparkModal(cp);
  }
};

/**
 * Closes the modal detail dialog.
 */
function closeCarparkModal() {
  const modal = document.getElementById("carpark-detail-modal");
  if (modal) {
    modal.classList.add("is-hidden");
  }
}

/**
 * =========================================================================
 * 7. 1-MINUTE AUTO REFRESH LOOP
 * =========================================================================
 */

/**
 * Starts the 60-second auto-refresh countdown loop.
 */
function startAutoRefreshTimer() {
  if (appState.timerIntervalId) {
    clearInterval(appState.timerIntervalId);
  }

  appState.secondsRemaining = appState.refreshIntervalSeconds;
  updateCountdownDisplay();

  appState.timerIntervalId = setInterval(() => {
    appState.secondsRemaining--;

    if (appState.secondsRemaining <= 0) {
      // Time to refresh
      fetchNearbyCarparks();
    } else {
      updateCountdownDisplay();
    }
  }, 1000);
}

/**
 * Resets the 60-second countdown counter back to 60.
 */
function resetCountdownTimer() {
  appState.secondsRemaining = appState.refreshIntervalSeconds;
  updateCountdownDisplay();
}

/**
 * Updates the visual countdown timer text in the header.
 */
function updateCountdownDisplay() {
  const timerEl = document.getElementById("countdown-timer");
  if (timerEl) {
    timerEl.textContent = `${appState.secondsRemaining}s`;
  }
}

/**
 * Spins the refresh icon during network activity.
 * @param {boolean} isSpinning 
 */
function spinRefreshIcon(isSpinning) {
  const icon = document.getElementById("refresh-spinner");
  if (icon) {
    if (isSpinning) {
      icon.classList.add("is-spinning");
    } else {
      icon.classList.remove("is-spinning");
    }
  }
}

/**
 * =========================================================================
 * 8. EVENT LISTENERS SETUP
 * =========================================================================
 */

/**
 * Hooks up all interactive controls to event listeners cleanly (No inline JS).
 */
function setupEventListeners() {
  // 1. Radius Slider Event Listener (1km to 3km)
  const radiusSlider = document.getElementById("input-radius-slider");
  const radiusDisplay = document.getElementById("radius-value-display");

  if (radiusSlider) {
    radiusSlider.addEventListener("input", (e) => {
      const newRadius = parseFloat(e.target.value);
      appState.searchRadiusKm = newRadius;
      
      // Update text label immediately for instant UI feedback
      if (radiusDisplay) {
        radiusDisplay.textContent = `${newRadius.toFixed(1)} km`;
      }
      
      // Update radius circle boundary on map
      updateRadiusCircle(appState.currentLat, appState.currentLng, newRadius);

      // Debounce server API calls to prevent flooding on slider drag
      clearTimeout(sliderDebounceTimer);
      sliderDebounceTimer = setTimeout(() => {
        announceAccessibilityMessage(`Search radius updated to ${newRadius.toFixed(1)} kilometers.`);
        fetchNearbyCarparks();
      }, 350);
    });
  }

  // 2. EV Charging Toggle Filter Switch
  const evToggle = document.getElementById("toggle-ev-charging");
  if (evToggle) {
    evToggle.addEventListener("change", (e) => {
      appState.evOnlyFilter = e.target.checked;
      evToggle.setAttribute("aria-checked", appState.evOnlyFilter ? "true" : "false");
      announceAccessibilityMessage(`EV charging filter ${appState.evOnlyFilter ? "enabled" : "disabled"}.`);
      fetchNearbyCarparks();
    });
  }

  // 3. Manual Refresh Button
  const btnRefresh = document.getElementById("btn-manual-refresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      fetchNearbyCarparks();
    });
  }

  // 4. Recenter Map FAB
  const btnRecenter = document.getElementById("btn-recenter-map");
  if (btnRecenter) {
    btnRecenter.addEventListener("click", () => {
      if (leafletMap) {
        leafletMap.setView([appState.currentLat, appState.currentLng], 15);
      }
    });
  }

  // 5. Drawer Toggle Buttons
  const btnToggleList = document.getElementById("btn-toggle-list");
  const btnCloseDrawer = document.getElementById("btn-close-drawer");
  const drawer = document.getElementById("carparks-list-drawer");

  if (btnToggleList && drawer) {
    btnToggleList.addEventListener("click", () => {
      const isClosed = drawer.classList.contains("is-closed");
      if (isClosed) {
        drawer.classList.remove("is-closed");
        drawer.setAttribute("aria-hidden", "false");
        btnToggleList.setAttribute("aria-expanded", "true");
      } else {
        drawer.classList.add("is-closed");
        drawer.setAttribute("aria-hidden", "true");
        btnToggleList.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (btnCloseDrawer && drawer) {
    btnCloseDrawer.addEventListener("click", () => {
      drawer.classList.add("is-closed");
      drawer.setAttribute("aria-hidden", "true");
      if (btnToggleList) {
        btnToggleList.setAttribute("aria-expanded", "false");
      }
    });
  }

  // 6. Modal Close Buttons & Backdrop Click
  const btnCloseModal = document.getElementById("btn-close-modal");
  const btnModalCloseAction = document.getElementById("btn-modal-close-action");
  const modal = document.getElementById("carpark-detail-modal");

  if (btnCloseModal) btnCloseModal.addEventListener("click", closeCarparkModal);
  if (btnModalCloseAction) btnModalCloseAction.addEventListener("click", closeCarparkModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeCarparkModal();
      }
    });
  }

  // Escape key closes modal or drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCarparkModal();
      if (drawer && !drawer.classList.contains("is-closed")) {
        drawer.classList.add("is-closed");
      }
    }
  });

  // 7. Location Search Input
  const searchInput = document.getElementById("input-location-search");
  const btnClearSearch = document.getElementById("btn-clear-search");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      if (btnClearSearch) {
        if (e.target.value.trim().length > 0) {
          btnClearSearch.classList.remove("is-hidden");
        } else {
          btnClearSearch.classList.add("is-hidden");
        }
      }
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performLocationSearch(searchInput.value);
      }
    });
  }

  if (btnClearSearch && searchInput) {
    btnClearSearch.addEventListener("click", () => {
      searchInput.value = "";
      btnClearSearch.classList.add("is-hidden");
      searchInput.focus();
    });
  }

  // 8. Quick Location Chips
  const chipButtons = document.querySelectorAll(".chip-button");
  chipButtons.forEach((chip) => {
    chip.addEventListener("click", () => {
      // Mark active chip
      chipButtons.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");

      if (chip.id === "chip-my-location") {
        requestUserGeolocation();
      } else {
        const lat = parseFloat(chip.getAttribute("data-lat"));
        const lng = parseFloat(chip.getAttribute("data-lng"));
        const name = chip.getAttribute("data-name");

        if (!isNaN(lat) && !isNaN(lng)) {
          appState.currentLat = lat;
          appState.currentLng = lng;
          appState.currentLocationName = name || "Singapore Location";

          updateUserLocationMarker(lat, lng);
          updateRadiusCircle(lat, lng, appState.searchRadiusKm);
          leafletMap.setView([lat, lng], 15);

          announceAccessibilityMessage(`Location switched to ${appState.currentLocationName}.`);
          fetchNearbyCarparks();
        }
      }
    });
  });
}

/**
 * Searches for a Singapore address / landmark using OneMap Elastic search or landmark registry.
 * @param {string} queryText 
 */
async function performLocationSearch(queryText) {
  const query = queryText ? queryText.trim() : "";
  if (!query) return;

  showLoadingOverlay(true, `Searching for "${query}"...`);

  // Singapore known landmark database for instant client-side resolution
  const LANDMARKS = {
    "marina bay": { lat: 1.2834, lng: 103.8607, name: "Marina Bay Sands" },
    "mbs": { lat: 1.2834, lng: 103.8607, name: "Marina Bay Sands" },
    "orchard": { lat: 1.3048, lng: 103.8318, name: "Orchard Road" },
    "raffles": { lat: 1.2838, lng: 103.8515, name: "Raffles Place" },
    "jurong": { lat: 1.3331, lng: 103.7423, name: "Jurong East Gateway" },
    "tampines": { lat: 1.3532, lng: 103.9452, name: "Tampines Central" },
    "bugis": { lat: 1.3005, lng: 103.8558, name: "Bugis Junction" },
    "changi": { lat: 1.3644, lng: 103.9915, name: "Changi Airport Jewel" },
    "vivocity": { lat: 1.2644, lng: 103.8222, name: "VivoCity / HarbourFront" },
    "woodlands": { lat: 1.4382, lng: 103.7890, name: "Woodlands Square" },
    "yishun": { lat: 1.4295, lng: 103.8350, name: "Northpoint City / Yishun" },
    "bishan": { lat: 1.3508, lng: 103.8488, name: "Junction 8 / Bishan" },
    "sengkang": { lat: 1.3916, lng: 103.8954, name: "Compass One / Sengkang" },
    "punggol": { lat: 1.4052, lng: 103.9023, name: "Waterway Point / Punggol" }
  };

  const lowerQuery = query.toLowerCase();
  for (const [key, landmark] of Object.entries(LANDMARKS)) {
    if (lowerQuery.includes(key)) {
      appState.currentLat = landmark.lat;
      appState.currentLng = landmark.lng;
      appState.currentLocationName = landmark.name;

      updateUserLocationMarker(landmark.lat, landmark.lng);
      updateRadiusCircle(landmark.lat, landmark.lng, appState.searchRadiusKm);
      leafletMap.setView([landmark.lat, landmark.lng], 15);

      fetchNearbyCarparks();
      return;
    }
  }

  // Attempt OneMap public search
  try {
    const omUrl = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const response = await fetch(omUrl);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const first = data.results[0];
      const lat = parseFloat(first.LATITUDE);
      const lng = parseFloat(first.LONGITUDE);

      if (!isNaN(lat) && !isNaN(lng)) {
        appState.currentLat = lat;
        appState.currentLng = lng;
        appState.currentLocationName = first.SEARCHVAL || query;

        updateUserLocationMarker(lat, lng);
        updateRadiusCircle(lat, lng, appState.searchRadiusKm);
        leafletMap.setView([lat, lng], 15);

        fetchNearbyCarparks();
        return;
      }
    }
  } catch (err) {
    console.warn("OneMap search fallback failed:", err);
  }

  // If no specific match found, center on Singapore central with query title
  appState.currentLocationName = query;
  fetchNearbyCarparks();
}

/**
 * =========================================================================
 * 9. ACCESSIBILITY & UTILITY HELPERS
 * =========================================================================
 */

/**
 * Sends dynamic message to screen readers via aria-live region.
 * @param {string} message 
 */
function announceAccessibilityMessage(message) {
  const announcer = document.getElementById("screen-reader-announcer");
  if (announcer) {
    announcer.textContent = message;
  }
}

/**
 * Toggles the map loading spinner overlay.
 * @param {boolean} isVisible 
 * @param {string} text 
 */
function showLoadingOverlay(isVisible, text) {
  const overlay = document.getElementById("map-loading-overlay");
  const label = document.getElementById("loading-overlay-text");

  if (!overlay) return;

  if (isVisible) {
    if (label && text) label.textContent = text;
    overlay.classList.remove("is-hidden");
    overlay.setAttribute("aria-hidden", "false");
  } else {
    overlay.classList.add("is-hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
}

/**
 * Renders an error toast or banner to the user.
 * @param {string} msg 
 */
function renderErrorMessage(msg) {
  announceAccessibilityMessage(`Error: ${msg}`);
  const container = document.getElementById("carparks-list-container");
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon" style="color:#D32F2F;" aria-hidden="true">error</span>
        <p style="color:#D32F2F; font-weight:700;">${escapeHtml(msg)}</p>
        <button type="button" class="action-button" style="margin-top:12px;" onclick="window.location.reload()">
          Reload Application
        </button>
      </div>
    `;
  }
}

/**
 * Safely escapes HTML strings to prevent XSS.
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
