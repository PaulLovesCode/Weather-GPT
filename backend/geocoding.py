import httpx


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

    # Prefer Indian locations
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