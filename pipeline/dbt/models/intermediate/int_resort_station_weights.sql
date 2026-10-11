-- Which stations stand in for each resort, and how much each one counts.
-- Weights are inverse-distance, so the nearer of two stations dominates.
with pairs as (

    select
        mapping.resort_id,
        mapping.station_triplet,
        mapping.rationale,
        stations.station_name,
        stations.elevation_ft as station_elev_ft,
        stations.latitude as station_latitude,
        stations.longitude as station_longitude,
        {{ haversine_km('resorts.latitude', 'resorts.longitude', 'stations.latitude', 'stations.longitude') }}
            as distance_km
    from {{ ref('resort_stations') }} as mapping
    inner join {{ ref('resort_list') }} as resorts on mapping.resort_id = resorts.resort_id
    inner join {{ ref('stg_snotel__stations') }} as stations
        on mapping.station_triplet = stations.station_triplet

)

select
    resort_id,
    station_triplet,
    station_name,
    station_elev_ft,
    station_latitude,
    station_longitude,
    rationale,
    round(distance_km, 2) as distance_km,
    -- A floor of 100 m keeps a station sitting on the resort pin from dividing by zero.
    (1 / greatest(distance_km, 0.1))
        / sum(1 / greatest(distance_km, 0.1)) over (partition by resort_id) as weight
from pairs
