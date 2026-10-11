-- New snow per station per day, estimated from two imperfect sensors.
--
--   Depth sensor: measures what a skier cares about, but reports whole inches, flickers
--     by an inch, occasionally spikes, and reads low during storms because the pack
--     settles under the new load.
--   Snow pillow (SWE): steady and immune to settling, but cannot tell 3 in of cold smoke
--     from 1 in of slush, and resolves only 0.1 in of water.
--
-- So the depth gain is the estimate, and the SWE gain fences it in:
--   cap   = (swe_gain + pillow resolution) / lightest plausible density
--           The most snow the pillow reading allows. Stops a depth spike with no water
--           behind it from becoming a powder day.
--   floor = swe_gain / heaviest plausible density, only when the day was cold enough
--           to snow. Recovers snow that settling hid from the depth sensor, without
--           assuming it was light.
--   new_snow = least(greatest(depth_signal, floor), cap)
--
-- Density is then snow water / new snow, where snow water is the SWE gain, limited to
-- what the heaviest plausible snow could hold (the rest was rain).
--
-- The estimate is conservative on purpose: it is settled snow at midnight, so a
-- resort's cleared-board total for the same storm will read higher.
with days as (

    select * from {{ ref('int_station_days') }}

),

changes as (

    select
        *,
        -- Rounded because 10.1 - 10.0 is 0.0999... in floating point, which would fail
        -- the ">= 0.1 in" comparisons below for the most common SWE step there is.
        round(snow_depth_in - lag(snow_depth_in) over station, 2) as depth_change_in,
        round(swe_in - lag(swe_in) over station, 2) as swe_change_in
    from days
    window station as (partition by station_triplet order by obs_date)

),

signals as (

    select
        *,
        greatest(coalesce(swe_change_in, 0), 0) as swe_gain_in,
        -- Noise gate: a one-inch rise needs a SWE gain to back it up.
        case
            when depth_change_in >= {{ var('depth_noise_floor_in') }} then depth_change_in
            when depth_change_in >= 1 and swe_change_in >= {{ var('swe_resolution_in') }} then depth_change_in
            else 0
        end as depth_signal_in
    from changes

),

bounds as (

    select
        *,
        -- Null when SWE is missing: with no pillow reading there is nothing to cap with.
        case
            when swe_change_in is not null
                then (swe_gain_in + {{ var('swe_resolution_in') }}) / {{ var('min_new_snow_density') }}
        end as swe_cap_in,
        case
            when swe_gain_in >= {{ var('swe_only_min_gain_in') }}
                and coalesce(temp_avg_24h_f, temp_obs_f) <= {{ var('snow_phase_max_temp_f') }}
                then swe_gain_in / {{ var('max_new_snow_density') }}
            else 0
        end as swe_floor_in
    from signals

),

estimated as (

    select
        *,
        round(least(greatest(depth_signal_in, swe_floor_in), coalesce(swe_cap_in, 1e9)), 1) as new_snow_in
    from bounds

)

select
    station_triplet,
    obs_date,
    snow_depth_in,
    swe_in,
    depth_is_missing,
    swe_is_missing,
    depth_change_in,
    swe_change_in,
    swe_gain_in,
    depth_signal_in,
    swe_floor_in,
    swe_cap_in,
    new_snow_in,
    case
        when new_snow_in <= 0 then 'none'
        when swe_cap_in is null then 'depth_only'
        when depth_signal_in > swe_cap_in then 'capped_by_swe'
        when swe_floor_in > depth_signal_in then 'raised_by_swe'
        else 'depth'
    end as new_snow_method,
    -- Water that arrived as snow. On a warm day part of a SWE gain is rain soaking into
    -- the pack, so the snow is credited with no more than the heaviest plausible density.
    least(swe_gain_in, new_snow_in * {{ var('max_new_snow_density') }}) as snow_water_in,
    -- Water content of the day's new snow, as a fraction. Undefined below one inch.
    case
        when new_snow_in >= 1
            then least(swe_gain_in, new_snow_in * {{ var('max_new_snow_density') }}) / new_snow_in
    end as new_snow_density,
    temp_obs_f,
    temp_avg_24h_f,
    temp_min_24h_f,
    temp_max_24h_f
from estimated
