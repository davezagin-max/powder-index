-- One row per resort, element, and forecast period, converted to inches and degrees F.
select
    resort_id,
    grid_id,
    case element
        when 'snowfallAmount' then 'snowfall'
        when 'quantitativePrecipitation' then 'precipitation'
        else element
    end as element,
    valid_start as valid_start_utc,
    valid_start + to_seconds(duration_hours * 3600) as valid_end_utc,
    duration_hours,
    case when element = 'temperature' then value * 9.0 / 5.0 + 32 else value / 25.4 end as value,
    case when element = 'temperature' then 'degF' else 'in' end as unit,
    forecast_updated_at as forecast_updated_at_utc,
    _loaded_at as loaded_at,
    _source as load_source
from {{ source('raw', 'nws_forecast') }}
