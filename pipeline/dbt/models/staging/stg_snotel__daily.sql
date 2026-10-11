-- One row per station and date, typed and renamed. A reading outside physical bounds
-- becomes null here so every later model can treat "missing" in one way.
with source as (

    select * from {{ source('raw', 'snotel_daily') }}

)

select
    station_triplet,
    cast(date as date) as obs_date,
    case when snwd_in between 0 and {{ var('max_plausible_depth_in') }} then snwd_in end as snow_depth_in,
    case when wteq_in between 0 and {{ var('max_plausible_swe_in') }} then wteq_in end as swe_in,
    case when tobs_f between -60 and 120 then tobs_f end as temp_obs_f,
    case when tavg_f between -60 and 120 then tavg_f end as temp_avg_f,
    case when tmin_f between -60 and 120 then tmin_f end as temp_min_f,
    case when tmax_f between -60 and 120 then tmax_f end as temp_max_f,
    _loaded_at as loaded_at,
    _source as load_source
from source
