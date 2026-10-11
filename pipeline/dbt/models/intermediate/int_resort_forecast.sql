-- The NWS forecast boiled down to one row per resort: totals for the 72 hours after the
-- forecast was fetched. Forecast periods are 1 to 6 hours long and do not line up with
-- our window, so each one is prorated by the share of it that falls inside.
with periods as (

    select * from {{ ref('stg_nws__forecast') }}

),

fetched as (

    select min(loaded_at) as window_start_utc from periods

),

clipped as (

    select
        periods.resort_id,
        periods.element,
        periods.value,
        periods.duration_hours,
        periods.forecast_updated_at_utc,
        periods.load_source,
        fetched.window_start_utc,
        {% for day in range(3) %}
        greatest(
            0,
            date_diff(
                'minute',
                greatest(periods.valid_start_utc, fetched.window_start_utc + interval {{ day * 24 }} hour),
                least(periods.valid_end_utc, fetched.window_start_utc + interval {{ day * 24 + 24 }} hour)
            )
        ) / 60.0 as overlap_hours_day_{{ day + 1 }}{{ "," if not loop.last }}
        {% endfor %}
    from periods
    cross join fetched

),

totals as (

    select
        resort_id,
        -- The site reports in Mountain Standard Time (UTC-7), like SNOTEL's fixed-offset day.
        cast(min(window_start_utc) - interval 7 hour as date) as forecast_date,
        min(window_start_utc) as forecast_fetched_at_utc,
        max(forecast_updated_at_utc) as forecast_updated_at_utc,
        max(load_source) as load_source,
        {% for day in range(1, 4) %}
        sum(case when element = 'snowfall' then value * overlap_hours_day_{{ day }} / duration_hours end)
            as forecast_snow_day_{{ day }}_in,
        {% endfor %}
        sum(
            case when element = 'precipitation'
                then value * (overlap_hours_day_1 + overlap_hours_day_2 + overlap_hours_day_3) / duration_hours
            end
        ) as forecast_precip_72h_in,
        min(
            case when element = 'temperature' and overlap_hours_day_1 + overlap_hours_day_2 + overlap_hours_day_3 > 0
                then value
            end
        ) as forecast_temp_min_72h_f,
        max(
            case when element = 'temperature' and overlap_hours_day_1 + overlap_hours_day_2 + overlap_hours_day_3 > 0
                then value
            end
        ) as forecast_temp_max_72h_f
    from clipped
    group by resort_id

)

select
    resort_id,
    forecast_date,
    forecast_fetched_at_utc,
    forecast_updated_at_utc,
    load_source,
    round(forecast_snow_day_1_in, 1) as forecast_snow_day_1_in,
    round(forecast_snow_day_2_in, 1) as forecast_snow_day_2_in,
    round(forecast_snow_day_3_in, 1) as forecast_snow_day_3_in,
    round(forecast_snow_day_1_in + forecast_snow_day_2_in + forecast_snow_day_3_in, 1) as forecast_snow_72h_in,
    round(forecast_precip_72h_in, 2) as forecast_precip_72h_in,
    round(forecast_temp_min_72h_f, 1) as forecast_temp_min_72h_f,
    round(forecast_temp_max_72h_f, 1) as forecast_temp_max_72h_f
from totals
