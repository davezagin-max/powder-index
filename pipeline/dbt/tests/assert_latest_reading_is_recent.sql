-- Observational freshness, separate from load freshness: the newest station reading
-- should be within two days of when the data was fetched. Warns rather than fails,
-- because a station can drop off telemetry for a few days in a storm.
{{ config(severity='warn') }}

select station_triplet, max(obs_date) as latest_reading, cast(max(loaded_at) as date) as fetched_on
from {{ ref('stg_snotel__daily') }}
where snow_depth_in is not null or swe_in is not null
group by station_triplet
having max(obs_date) < cast(max(loaded_at) as date) - 2
