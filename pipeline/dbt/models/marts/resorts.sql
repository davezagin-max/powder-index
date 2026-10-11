-- One row per resort, with the stations that stand in for it.
with stations as (

    select
        resort_id,
        string_agg(station_name, ' + ' order by weight desc) as station_names,
        cast(count(*) as integer) as station_count,
        round(min(distance_km), 1) as nearest_station_km,
        cast(round(sum(weight * station_elev_ft)) as integer) as station_elev_ft
    from {{ ref('int_resort_station_weights') }}
    group by resort_id

)

select
    resorts.resort_id,
    resorts.resort_name,
    resorts.area,
    resorts.latitude,
    resorts.longitude,
    resorts.base_elev_ft,
    resorts.summit_elev_ft,
    stations.station_names,
    stations.station_count,
    stations.nearest_station_km,
    stations.station_elev_ft,
    case
        when stations.nearest_station_km <= 3 then 'on_mountain'
        when stations.nearest_station_km <= 8 then 'nearby'
        else 'regional'
    end as proxy_quality
from {{ ref('resort_list') }} as resorts
inner join stations on resorts.resort_id = stations.resort_id
