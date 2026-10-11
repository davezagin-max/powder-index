-- A complete calendar for every station: one row per station per day, with no holes.
--
-- A missing reading is carried forward for a few days (and flagged), because a later
-- model takes day-over-day differences and a hole would either hide a storm or stack
-- several days of snow onto one. The catch-up difference lands on the first good day.
with readings as (

    select * from {{ ref('stg_snotel__daily') }}

),

calendar as (

    select cast(unnest(generate_series(min(obs_date), max(obs_date), interval 1 day)) as date) as obs_date
    from readings

),

spine as (

    select stations.station_triplet, calendar.obs_date
    from (select distinct station_triplet from readings) as stations
    cross join calendar

),

joined as (

    select
        spine.station_triplet,
        spine.obs_date,
        readings.snow_depth_in as depth_reading,
        readings.swe_in as swe_reading,
        readings.temp_obs_f,
        readings.temp_avg_f,
        readings.temp_min_f,
        readings.temp_max_f
    from spine
    left join readings
        on spine.station_triplet = readings.station_triplet
        and spine.obs_date = readings.obs_date

),

carried as (

    select
        *,
        last_value(depth_reading ignore nulls) over history as depth_last,
        last_value(case when depth_reading is not null then obs_date end ignore nulls) over history
            as depth_last_date,
        last_value(swe_reading ignore nulls) over history as swe_last,
        last_value(case when swe_reading is not null then obs_date end ignore nulls) over history
            as swe_last_date
    from joined
    window history as (
        partition by station_triplet order by obs_date
        rows between unbounded preceding and current row
    )

)

select
    station_triplet,
    obs_date,
    case
        when date_diff('day', depth_last_date, obs_date) <= {{ var('max_gap_fill_days') }} then depth_last
    end as snow_depth_in,
    case
        when date_diff('day', swe_last_date, obs_date) <= {{ var('max_gap_fill_days') }} then swe_last
    end as swe_in,
    depth_reading is null as depth_is_missing,
    swe_reading is null as swe_is_missing,
    temp_obs_f,
    -- The reading dated D is taken at 00:00 on D, so "the last 24 hours" is calendar
    -- day D-1 and its temperature statistics are the previous row's.
    lag(temp_avg_f) over days as temp_avg_24h_f,
    lag(temp_min_f) over days as temp_min_24h_f,
    lag(temp_max_f) over days as temp_max_24h_f
from carried
window days as (partition by station_triplet order by obs_date)
