-- Station days blended into resort days, plus the rolling windows the score needs.
--
-- A resort with two stations gets their inverse-distance weighted mean. If one of them
-- has no value that day, the other carries the full weight rather than dragging the
-- mean toward zero.
{% set blend_columns = [
    ('snow_depth_in', 'snow_depth_in'),
    ('swe_in', 'swe_in'),
    ('new_snow_in', 'new_snow_24h_in'),
    ('swe_gain_in', 'swe_gain_24h_in'),
    ('temp_obs_f', 'temp_obs_f'),
    ('temp_avg_24h_f', 'temp_avg_24h_f'),
    ('temp_min_24h_f', 'temp_min_24h_f'),
    ('temp_max_24h_f', 'temp_max_24h_f'),
] %}

with station_days as (

    select * from {{ ref('int_station_new_snow') }}

),

weights as (

    select resort_id, station_triplet, weight from {{ ref('int_resort_station_weights') }}

),

blended as (

    select
        weights.resort_id,
        station_days.obs_date as date,
        {% for source_column, target_column in blend_columns %}
        sum(weights.weight * station_days.{{ source_column }})
            / sum(case when station_days.{{ source_column }} is not null then weights.weight end)
            as {{ target_column }},
        {% endfor %}
        -- Water that arrived as snow: the numerator for storm density.
        sum(weights.weight * station_days.snow_water_in) as snow_water_24h_in,
        count(*) as station_count,
        bool_or(station_days.depth_is_missing or station_days.swe_is_missing) as has_missing_reading
    from weights
    inner join station_days on weights.station_triplet = station_days.station_triplet
    group by 1, 2

),

windowed as (

    select
        *,
        {{ water_year('date') }} as water_year,
        sum(new_snow_24h_in) over last_3_days as new_snow_72h_in,
        sum(new_snow_24h_in) over last_7_days as new_snow_7d_in,
        sum(snow_water_24h_in) over last_3_days as snow_water_72h_in,
        avg(temp_avg_24h_f) over last_3_days as temp_avg_72h_f,
        max(temp_max_24h_f) over last_3_days as temp_max_72h_f,
        last_value(case when new_snow_24h_in >= 1 then date end ignore nulls) over history as last_snow_date,
        min(date) over (partition by resort_id) as first_date
    from blended
    window
        last_3_days as (partition by resort_id order by date rows between 2 preceding and current row),
        last_7_days as (partition by resort_id order by date rows between 6 preceding and current row),
        history as (partition by resort_id order by date rows between unbounded preceding and current row)

)

select
    resort_id,
    date,
    water_year,
    round(snow_depth_in, 1) as snow_depth_in,
    round(swe_in, 2) as swe_in,
    round(new_snow_24h_in, 1) as new_snow_24h_in,
    round(new_snow_72h_in, 1) as new_snow_72h_in,
    round(new_snow_7d_in, 1) as new_snow_7d_in,
    round(swe_gain_24h_in, 2) as swe_gain_24h_in,
    -- Percent water by depth. Undefined below one inch of snow.
    round(case when new_snow_24h_in >= 1 then 100 * snow_water_24h_in / new_snow_24h_in end, 1) as density_24h_pct,
    round(case when new_snow_72h_in >= 1 then 100 * snow_water_72h_in / new_snow_72h_in end, 1) as density_72h_pct,
    round(sum(new_snow_24h_in) over (partition by resort_id, water_year order by date), 1) as season_snowfall_in,
    cast(date_diff('day', last_snow_date, date) as integer) as days_since_snow,
    round(temp_obs_f, 1) as temp_obs_f,
    round(temp_avg_24h_f, 1) as temp_avg_24h_f,
    round(temp_min_24h_f, 1) as temp_min_24h_f,
    round(temp_max_24h_f, 1) as temp_max_24h_f,
    round(temp_avg_72h_f, 1) as temp_avg_72h_f,
    round(temp_max_72h_f, 1) as temp_max_72h_f,
    cast(station_count as integer) as station_count,
    has_missing_reading
from windowed
-- The first days have short rolling windows and no previous reading to difference against.
qualify date >= first_date + {{ var('warmup_days') }}
