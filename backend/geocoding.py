import httpx
import time
from functools import wraps


def ttl_cache(ttl_seconds: int):
    def decorator(func):
        cache = {}
        @wraps(func)
        async def wrapper(latitude: float, longitude: float):
            key = (round(latitude, 3), round(longitude, 3))
            now = time.monotonic()
            hit = cache.get(key)
            if hit is not None and now - hit[0] < ttl_seconds:
                return hit[1]
            result = await func(latitude, longitude)
            cache[key] = (now, result)
            return result
        return wrapper
    return decorator


async def search_locations(city: str):
    url = "https://geocoding-api.open-meteo.com/v1/search"

    params = {
        "name": city,
        "count": 5,
        "language": "en",
        "format": "json",
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    data = response.json()

    if "results" not in data or not data["results"]:
        return []

    locations = []

    for location in data["results"]:
        locations.append({
            "name": location["name"],
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "country": location.get("country"),
            "admin1": location.get("admin1"),
        })

    # Prefer Indian locations if ambiguity exists
    locations.sort(
        key=lambda location: (
            location.get("country") != "India",
            location.get("name", "")
        )
    )

    return locations


async def get_coordinates(city: str):
    locations = await search_locations(city)

    if not locations:
        return None

    return locations[0]


@ttl_cache(1800)
async def reverse_geocode(latitude: float, longitude: float):
    """Reverse geocode latitude & longitude to obtain exact town/city/suburb/locality name."""
    headers = {"User-Agent": "WeatherGPT/1.0 (contact@weathergpt.local)"}

    # 1. OpenStreetMap Nominatim for fine-grained town/suburb/county names
    nom_url = f"https://nominatim.openstreetmap.org/reverse?lat={latitude}&lon={longitude}&format=json"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=4.0) as client:
            response = await client.get(nom_url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                addr = data.get("address", {})
                location_name = (
                    addr.get("city")
                    or addr.get("town")
                    or addr.get("suburb")
                    or addr.get("village")
                    or addr.get("municipality")
                    or addr.get("county")
                    or addr.get("state_district")
                )
                country = addr.get("country", "")

                if location_name:
                    # Strip "- II", "- I" or "Division" suffixes if any
                    clean_name = location_name.split("-")[0].strip()
                    return {
                        "name": clean_name,
                        "country": country,
                        "latitude": latitude,
                        "longitude": longitude,
                    }
    except Exception as exc:
        print(f"Nominatim reverse geocode error: {exc}")

    # 2. BigDataCloud Fallback
    bdc_url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={latitude}&longitude={longitude}&localityLanguage=en"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=4.0) as client:
            response = await client.get(bdc_url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                city_name = (
                    data.get("city")
                    or data.get("locality")
                    or data.get("principalSubdivision")
                    or data.get("countryName")
                )
                country = data.get("countryName", "")
                if city_name:
                    return {
                        "name": city_name,
                        "country": country,
                        "latitude": latitude,
                        "longitude": longitude,
                    }
    except Exception as exc:
        print(f"BigDataCloud reverse geocode error: {exc}")

    return {
        "name": "Nearest Location",
        "latitude": latitude,
        "longitude": longitude,
    }