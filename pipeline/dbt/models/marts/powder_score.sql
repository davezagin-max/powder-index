-- The powder score: one row per resort per day, 0 to 100.
--
--   score = 100 * sum(weight_i * component_i) / sum(weight_i over known components)
--
-- Each component is a 0..1 linear ramp between two anchors. Weights and anchors come
-- from seeds/powder_score_weights.csv, so the formula has exactly one home. Two gates:
-- lightness is scaled by how much storm snow there is to be light, and cold only counts
-- when there is snow on the ground to preserve. The forecast is unknown for replayed days;
-- it is then left out and the other weights are rescaled.
{% set components = ['fresh_24h', 'fresh_72h', 'density', 'cold', 'base', 'forecast'] %}

with daily as (

    select * from {{ ref('resort_daily') }}

),

weights as (

    select
        {% for component in components %}
        max(case when component = '{{ component }}' then weight end) as w_{{ component }},
        max(case when component = '{{ component }}' then zero_at end) as zero_{{ component }},
        max(case when component = '{{ component }}' then full_at end) as full_{{ component }}{{ "," if not loop.last }}
        {% endfor %}
    from {{ ref('powder_score_weights') }}

),

components as (

    select
        daily.resort_id,
        daily.resort_name,
        daily.date,
        daily.water_year,
        daily.new_snow_72h_in,
        daily.snow_depth_in,
        coalesce({{ normalize('daily.new_snow_24h_in', 'weights.zero_fresh_24h', 'weights.full_fresh_24h') }}, 0)
            as fresh_24h_score,
        coalesce({{ normalize('daily.new_snow_72h_in', 'weights.zero_fresh_72h', 'weights.full_fresh_72h') }}, 0)
            as fresh_72h_score,
        -- Lightness, scaled by how much storm snow there is to be light.
        coalesce({{ normalize('daily.density_72h_pct', 'weights.zero_density', 'weights.full_density') }}, 0)
            * least(daily.new_snow_72h_in / {{ var('density_full_credit_storm_in') }}, 1) as density_score,
        case
            when daily.snow_depth_in > 0
                then coalesce({{ normalize('daily.temp_avg_72h_f', 'weights.zero_cold', 'weights.full_cold') }}, 0)
            else 0
        end as cold_score,
        coalesce({{ normalize('daily.snow_depth_in', 'weights.zero_base', 'weights.full_base') }}, 0) as base_score,
        -- Stays null when there is no forecast for the day.
        {{ normalize('daily.forecast_snow_72h_in', 'weights.zero_forecast', 'weights.full_forecast') }}
            as forecast_score,
        weights.*
    from daily
    cross join weights

),

weighted as (

    select
        *,
        w_fresh_24h + w_fresh_72h + w_density + w_cold + w_base
            + case when forecast_score is not null then w_forecast else 0 end as weight_known
    from components

),

points as (

    select
        resort_id,
        resort_name,
        date,
        water_year,
        new_snow_72h_in,
        snow_depth_in,
        {% for component in components %}
        round({{ component }}_score, 3) as {{ component }}_score,
        round(100 * w_{{ component }} * {{ component }}_score / weight_known, 1) as {{ component }}_points,
        {% endfor %}
        round(weight_known, 2) as weight_known
    from weighted

),

scored as (

    select
        *,
        -- The headline is the sum of the rounded parts, so the breakdown always adds up.
        round(
            fresh_24h_points + fresh_72h_points + density_points + cold_points + base_points
            + coalesce(forecast_points, 0),
            1
        ) as powder_score
    from points

)

select
    scored.resort_id,
    scored.resort_name,
    scored.date,
    scored.water_year,
    scored.powder_score,
    tiers.tier,
    cast(
        row_number() over (
            partition by scored.date
            order by scored.powder_score desc, scored.new_snow_72h_in desc, scored.snow_depth_in desc, scored.resort_name
        ) as integer
    ) as rank,
    scored.fresh_24h_score,
    scored.fresh_72h_score,
    scored.density_score,
    scored.cold_score,
    scored.base_score,
    scored.forecast_score,
    scored.fresh_24h_points,
    scored.fresh_72h_points,
    scored.density_points,
    scored.cold_points,
    scored.base_points,
    scored.forecast_points,
    scored.weight_known
from scored
-- The highest tier whose threshold the score clears.
asof join {{ ref('powder_tiers') }} as tiers on scored.powder_score >= tiers.min_score
