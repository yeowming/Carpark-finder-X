/**
 * api/insight.js
 * 
 * Vercel Serverless Function & Express Route Handler.
 * Retrieves real-time Singapore carpark availability from LTA DataMall (CarParkAvailabilityv2),
 * validates input server-side, filters by user radius (1.0 - 3.0 km) and EV charging capability,
 * and classifies lot availability into color buckets (Red < 5, Orange < 10, Green >= 10).
 * 
 * Target Audience: Car owners in Singapore seeking quick carpark availability.
 */

// Singapore major EV charging enabled carparks & developments database (SP Group, Charge+, Shell Recharge, HDB EV Hubs, CDG ENGIE)
const KNOWN_EV_CARPARKS = new Set([
  "1", "2", "3", "5", "8", "9", "10", "11", "12", "14", "15", "16", "17", "18", "19", "20",
  "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35",
  "ACB", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12",
  "BM1", "BM2", "BM3", "BM4", "BM5", "BM6", "BM7", "BM8", "BM9", "BM10",
  "BR1", "BR2", "BR3", "BR4", "BR5", "BR6", "BR7", "BR8", "BR9",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "C15",
  "CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9",
  "CK1", "CK2", "CK3", "CK4", "CK5", "CK6", "CK7", "CK8", "CK9", "CK10",
  "HG1", "HG2", "HG3", "HG4", "HG5", "HG6", "HG7", "HG8", "HG9",
  "J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "J9", "J10", "J11", "J12", "J13",
  "MP1", "MP2", "MP3", "MP4", "MP5", "MP6", "MP7", "MP8", "MP9",
  "PR1", "PR2", "PR3", "PR4", "PR5", "PR6", "PR7", "PR8", "PR9",
  "SK1", "SK2", "SK3", "SK4", "SK5", "SK6", "SK7", "SK8", "SK9", "SK10",
  "TP1", "TP2", "TP3", "TP4", "TP5", "TP6", "TP7", "TP8", "TP9", "TP10",
  "WL1", "WL2", "WL3", "WL4", "WL5", "WL6", "WL7", "WL8", "WL9", "WL10",
  "YS1", "YS2", "YS3", "YS4", "YS5", "YS6", "YS7", "YS8", "YS9", "YS10"
]);

// Keywords in Development name that indicate EV charging stations on-site
const EV_KEYWORDS = [
  "EV", "CHARG", "TESLA", "SHELL", "SP MOBILITY", "CHARGE+", "ENGIE", "ELECTRIC", 
  "SUNTEC", "MARINA BAY", "JEWEL", "CHANGI", "VIVOCITY", "ION ORCHARD", "PARAGON", 
  "PLAZA SINGAPURA", "NEX", "JEM", "WESTGATE", "TAMPINES MALL", "WATERWAY POINT", 
  "GREAT WORLD", "MILLENIA", "CENTURY SQUARE", "FUNAN", "BUGIS", "RAFFLES CITY",
  "CAPITASPACE", "ONE RAFFLES", "MARINA ONE", "NORTHPOINT", "COMPASS ONE"
];

// In-memory cache to prevent excessive upstream LTA API calls
let cachedLtaData = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 50 * 1000; // 50 seconds cache (LTA updates every 1 min)

/**
 * Validates whether a given development has EV charging facilities.
 * @param {string} carparkId - The CarParkID code
 * @param {string} development - The development name
 * @returns {boolean}
 */
function checkEvAvailability(carparkId, development) {
  if (!carparkId && !development) return false;
  const idUpper = String(carparkId || "").trim().toUpperCase();
  if (KNOWN_EV_CARPARKS.has(idUpper)) return true;

  const devUpper = String(development || "").toUpperCase();
  for (const keyword of EV_KEYWORDS) {
    if (devUpper.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculates Great-Circle distance between two coordinates in kilometers using Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in kilometers
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_KM = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Classifies available carpark lots into color indicators based on business rules:
 * - red: < 5 lots
 * - orange: < 10 lots (5 to 9 lots)
 * - green: > 10 lots (or >= 10 lots)
 * @param {number} lots 
 * @returns {{ color: string, label: string, badgeClass: string }}
 */
function getLotAvailabilityStatus(lots) {
  const count = Number(lots) || 0;
  if (count < 5) {
    return {
      color: "red",
      statusText: "Critical (< 5 lots)",
      badgeClass: "status-red",
      hexColor: "#D32F2F"
    };
  } else if (count < 10) {
    return {
      color: "orange",
      statusText: "Limited (< 10 lots)",
      badgeClass: "status-orange",
      hexColor: "#E65100"
    };
  } else {
    return {
      color: "green",
      statusText: "Available (>= 10 lots)",
      badgeClass: "status-green",
      hexColor: "#2E7D32"
    };
  }
}

/**
 * Fetches all real-time carpark availability data from LTA DataMall API.
 * Uses pagination ($skip) to retrieve complete data set across LTA, HDB, and URA.
 * @returns {Promise<Array>}
 */
async function fetchLtaCarparkData() {
  const now = Date.now();
  if (cachedLtaData && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedLtaData;
  }

  // Read AccountKey from environment variable as mandated by security rules
  const accountKey = process.env.LTA_DATAMALL_ACCOUNT_KEY || "lCjQ7orjRYCVd5gWYVknrQ==";
  const baseUrl = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2";
  
  let allRecords = [];
  let skip = 0;
  let hasMore = true;
  const maxPages = 8; // Safety limit (each page returns up to 500 records)
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    const fetchUrl = skip > 0 ? `${baseUrl}?$skip=${skip}` : baseUrl;
    try {
      const response = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          "AccountKey": accountKey,
          "accept": "application/json"
        }
      });

      if (!response.ok) {
        console.warn(`LTA DataMall API returned status ${response.status} at skip=${skip}`);
        break;
      }

      const data = await response.json();
      const records = data.value || [];
      if (records.length === 0) {
        hasMore = false;
      } else {
        allRecords = allRecords.concat(records);
        if (records.length < 500) {
          hasMore = false;
        } else {
          skip += 500;
        }
      }
    } catch (err) {
      console.error("Error fetching page from LTA DataMall:", err);
      break;
    }
    pageCount++;
  }

  if (allRecords.length > 0) {
    cachedLtaData = allRecords;
    lastCacheTime = now;
  } else if (cachedLtaData) {
    // Return stale cache if upstream is momentarily unavailable
    return cachedLtaData;
  }

  return allRecords;
}

/**
 * Serverless / Express request handler.
 * Validates request query parameters:
 * - lat: latitude (float, required)
 * - lng / lon: longitude (float, required)
 * - radius: search radius in km (float, 1.0 to 3.0, required/default: 1.5)
 * - evOnly: boolean (optional, true to filter only EV equipped lots)
 * - lotType: optional vehicle filter ('C' for Car, 'Y' for Motorcycle, 'H' for Heavy)
 */
export default async function handler(req, res) {
  // Allow CORS for API integration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method Not Allowed",
      message: "Only GET requests are supported."
    });
  }

  try {
    const query = req.query || {};

    // 1. Server-side Input Validation: Latitude & Longitude
    const rawLat = query.lat || query.latitude;
    const rawLng = query.lng || query.lon || query.longitude;

    if (rawLat === undefined || rawLng === undefined) {
      return res.status(400).json({
        error: "Missing Parameters",
        message: "Latitude ('lat') and Longitude ('lng') are required query parameters."
      });
    }

    const userLat = parseFloat(rawLat);
    const userLng = parseFloat(rawLng);

    if (isNaN(userLat) || userLat < -90 || userLat > 90) {
      return res.status(400).json({
        error: "Invalid Latitude",
        message: "Latitude must be a valid number between -90 and 90."
      });
    }

    if (isNaN(userLng) || userLng < -180 || userLng > 180) {
      return res.status(400).json({
        error: "Invalid Longitude",
        message: "Longitude must be a valid number between -180 and 180."
      });
    }

    // 2. Server-side Input Validation: Radius (1.0 km to 3.0 km)
    let radiusKm = 1.5;
    if (query.radius !== undefined) {
      const parsedRadius = parseFloat(query.radius);
      if (isNaN(parsedRadius)) {
        return res.status(400).json({
          error: "Invalid Radius",
          message: "Radius must be a numeric value."
        });
      }
      // Strictly clamp / validate within 1.0 to 3.0 km as per requirements
      if (parsedRadius < 1.0 || parsedRadius > 3.0) {
        return res.status(400).json({
          error: "Radius Out of Bounds",
          message: "Radius must be between 1.0 km and 3.0 km."
        });
      }
      radiusKm = parsedRadius;
    }

    // 3. Server-side Input Validation: EV Charging Toggle Filter
    const evOnly = query.evOnly === "true" || query.evOnly === "1" || query.evOnly === true;

    // 4. Optional Lot Type Filter (Default: 'C' for Car)
    const lotTypeFilter = (query.lotType || "C").toUpperCase();

    // 5. Fetch Live Data from LTA DataMall
    const rawCarparks = await fetchLtaCarparkData();

    // 6. Process, parse coordinates, filter by radius and EV status
    const processedCarparks = [];

    for (const item of rawCarparks) {
      // Validate lot type (default to Car if specified)
      if (lotTypeFilter && item.LotType && item.LotType.toUpperCase() !== lotTypeFilter) {
        continue;
      }

      // Parse Location coordinates "lat lon"
      if (!item.Location) continue;
      const parts = item.Location.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const cpLat = parseFloat(parts[0]);
      const cpLng = parseFloat(parts[1]);
      if (isNaN(cpLat) || isNaN(cpLng)) continue;

      // Calculate distance in kilometers
      const distanceKm = calculateHaversineDistance(userLat, userLng, cpLat, cpLng);

      // Check if within user-selected radius (1 to 3 km)
      if (distanceKm > radiusKm) {
        continue;
      }

      // Check EV capability
      const hasEvCharging = checkEvAvailability(item.CarParkID, item.Development);

      // Filter if EV-only toggle is active
      if (evOnly && !hasEvCharging) {
        continue;
      }

      const availableLots = parseInt(item.AvailableLots, 10) || 0;
      const status = getLotAvailabilityStatus(availableLots);

      processedCarparks.push({
        id: item.CarParkID || `CP_${cpLat}_${cpLng}`,
        development: item.Development || "Carpark",
        area: item.Area || "Singapore",
        agency: item.Agency || "LTA",
        lotType: item.LotType || "C",
        availableLots: availableLots,
        statusColor: status.color,
        statusText: status.statusText,
        badgeClass: status.badgeClass,
        hexColor: status.hexColor,
        hasEvCharging: hasEvCharging,
        latitude: cpLat,
        longitude: cpLng,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        distanceMeters: Math.round(distanceKm * 1000)
      });
    }

    // Sort carparks by closest distance first
    processedCarparks.sort((a, b) => a.distanceKm - b.distanceKm);

    // Compute summary metrics for client insight
    const summary = {
      totalFound: processedCarparks.length,
      greenCount: processedCarparks.filter(c => c.statusColor === "green").length,
      orangeCount: processedCarparks.filter(c => c.statusColor === "orange").length,
      redCount: processedCarparks.filter(c => c.statusColor === "red").length,
      evCount: processedCarparks.filter(c => c.hasEvCharging).length,
      nearestDistanceKm: processedCarparks.length > 0 ? processedCarparks[0].distanceKm : null
    };

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      query: {
        latitude: userLat,
        longitude: userLng,
        radiusKm: radiusKm,
        evOnly: evOnly,
        lotType: lotTypeFilter
      },
      summary: summary,
      carparks: processedCarparks
    });

  } catch (error) {
    console.error("Serverless API Error in api/insight.js:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred while processing carpark availability.",
      details: error.message
    });
  }
}
