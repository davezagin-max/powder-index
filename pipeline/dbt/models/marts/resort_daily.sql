-- The morning snow report: one row per resort per day.
-- Everything dated D describes the state at 00:00 on D and the hours leading up to it.
with days as (

    select * from {{ ref('int_resort_days') }}

),

forecast as (

    select * from {{ ref('int_resort_forecast') }}

)

select
    days.resort_id,
    resorts.resort_name,
    days.date,
    days.water_year,
    days.snow_depth_in,
    days.swe_in,
    days.new_snow_24h_in,
    days.new_snow_72h_in,
    days.new_snow_7d_in,
    days.season_snowfall_in,
    days.days_since_snow,
    days.swe_gain_24h_in,
    days.density_24h_pct,
    days.density_72h_pct,
    days.temp_obs_f,
    days.temp_avg_24h_f,
    days.temp_min_24h_f,
    days.temp_max_24h_f,
    days.temp_avg_72h_f,
    -- A forecast only exists for the day it was fetched. Replayed days have none.
    forecast.forecast_snow_72h_in,
    forecast.forecast_snow_day_1_in,
    forecast.forecast_snow_day_2_in,
    forecast.forecast_snow_day_3_in,
    forecast.forecast_precip_72h_in,
    forecast.forecast_temp_min_72h_f,
    days.has_missing_reading
from days
inner join {{ ref('resort_list') }} as resorts on days.resort_id = resorts.resort_id
left join forecast
    on days.resort_id = forecast.resort_id
    and days.date = forecast.forecast_date
