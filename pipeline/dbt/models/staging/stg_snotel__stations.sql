select
    station_triplet,
    station_name,
    latitude,
    longitude,
    cast(round(elevation_ft) as integer) as elevation_ft,
    county
from {{ source('raw', 'snotel_stations') }}
