/**
 * Client-side location resolution helpers.
 *
 * These are deliberately pure and network-free so the UI can render something
 * immediately: when the browser denies geolocation we fall back to the IANA
 * time zone, which the browser already knows, before ever waiting on a lookup.
 */

export type LocationSource = "gps" | "ip" | "timezone" | "default";

/**
 * Relative trust ordering for automatic location sources. An applied result
 * blocks any later result of *lower* priority, which is what stops a slow IP
 * response from clobbering precise GPS, or a late timezone load from undoing a
 * better answer.
 */
export const LOCATION_SOURCE_PRIORITY: Record<LocationSource, number> = {
  default: 0,
  timezone: 1,
  ip: 2,
  gps: 3,
};

/** Shown when nothing better can be determined. */
export const FALLBACK_CITY = "London";

/**
 * Zones whose final segment is not the city people would search for, plus the
 * deprecated aliases some platforms still report.
 */
const TIMEZONE_CITY_OVERRIDES: Record<string, string> = {
  "Asia/Calcutta": "Kolkata",
  "Asia/Kolkata": "Kolkata",
  "Asia/Saigon": "Ho Chi Minh City",
  "Asia/Ho_Chi_Minh": "Ho Chi Minh City",
  "Asia/Rangoon": "Yangon",
  "Asia/Yangon": "Yangon",
  "Asia/Katmandu": "Kathmandu",
  "Asia/Kathmandu": "Kathmandu",
  "Asia/Thimbu": "Thimphu",
  "Asia/Thimphu": "Thimphu",
  "Asia/Urumqi": "Urumqi",
  "Asia/Chongqing": "Chongqing",
  "Asia/Harbin": "Harbin",
  "Asia/Macao": "Macau",
  "Asia/Macau": "Macau",
  "America/Buenos_Aires": "Buenos Aires",
  "America/Godthab": "Nuuk",
  "America/Nuuk": "Nuuk",
  "Europe/Kiev": "Kyiv",
  "Europe/Kyiv": "Kyiv",
  "Europe/Nicosia": "Nicosia",
  "Europe/Uzhgorod": "Uzhhorod",
  "Europe/Zaporozhye": "Zaporizhzhia",
  "Pacific/Ponape": "Pohnpei",
  "Pacific/Pohnpei": "Pohnpei",
  "Pacific/Truk": "Chuuk",
  "Pacific/Chuuk": "Chuuk",
  "Atlantic/Faeroe": "Torshavn",
  "Atlantic/Faroe": "Torshavn",
  "Antarctica/McMurdo": "McMurdo Station",
  "America/Indianapolis": "Indianapolis",
  "Asia/Dacca": "Dhaka",
  "Asia/Dhaka": "Dhaka",
  "Australia/Canberra": "Canberra",
  "Australia/NSW": "Sydney",
  "Australia/Victoria": "Melbourne",
  "Australia/Queensland": "Brisbane",
  "America/Puerto_Rico": "San Juan",
};

/** Words that are region names rather than cities when used as a zone tail. */
const NON_CITY_TAILS = new Set([
  "east",
  "west",
  "north",
  "south",
  "central",
  "midwest",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "standard",
  "time",
  "zone",
  "gmt",
  "utc",
]);

/** Convert an IANA segment such as `kolkata` or `new_york` to `Kolkata`. */
function titleCaseSegment(segment: string): string | null {
  const cleaned = segment.replace(/_/g, " ").trim().toLowerCase();
  if (!cleaned || NON_CITY_TAILS.has(cleaned.replace(/\s+/g, ""))) return null;

  // Strip a trailing "(city)" style annotation defensively.
  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  const result = words.join(" ").trim();
  return result.length >= 3 ? result : null;
}

/**
 * Best-effort representative city for the browser's IANA time zone.
 *
 * Most zone tails *are* city names (`Europe/Amsterdam` -> Amsterdam), so the
 * generic tail heuristic covers most of the world without an exhaustive table.
 * Returns `null` when the zone is absent or unusable, which is the signal to
 * fall through to the next source rather than guess.
 */
export function deriveCityFromTimezone(): string | null {
  if (typeof Intl === "undefined") return null;

  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (!timeZone) return null;

  // `Etc/*` and `SystemV/*` are fixed-offset zones named after the offset, not
  // after a place, so their tails must never be mistaken for a city name.
  const area = timeZone.split("/")[0];
  if (area === "Etc" || area === "SystemV") return null;

  const override = TIMEZONE_CITY_OVERRIDES[timeZone];
  if (override) return override;

  const segments = timeZone.split("/");
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  // Tails containing digits are offset labels (e.g. `GMT+5`, `EST5EDT`).
  if (/\d/.test(tail)) return null;

  return titleCaseSegment(tail);
}

/** `PERMISSION_DENIED` and friends, in words a user can act on. */
export function describeGeolocationError(
  error: GeolocationPositionError | { code?: number; message?: string } | null
): string {
  if (!error) return "Location unavailable";

  const message = error.message?.trim();

  switch (error.code) {
    case 1:
      // Re-prompting is impossible once the site is blocked, so say so.
      return "Location permission denied. Allow it for this site in your browser's address bar to use your exact position.";
    case 2:
      return "Your device could not determine a position.";
    case 3:
      return "Locating you took too long. Check that location services are enabled.";
    default:
      return message || "Location unavailable";
  }
}

/**
 * Whether the browser will even be allowed to geolocate.
 *
 * `navigator.geolocation` exists in insecure contexts but every call fails
 * there, so checking only for its presence is not enough to explain the error.
 */
export function geolocationUnavailableReason(): string | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "This browser does not support location services.";
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Location access requires HTTPS. Open the app over https or on localhost.";
  }
  return null;
}

/** True for the code meaning the user (or the browser) refused the request. */
export function isPermissionDenied(
  error: GeolocationPositionError | { code?: number } | null
): boolean {
  return error?.code === 1;
}
