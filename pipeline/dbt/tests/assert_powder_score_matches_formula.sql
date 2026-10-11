-- Recompute the score from resort_daily and the weights seed with the arithmetic
-- written out longhand (no shared macro), and compare with the mart.
with weights as (

    select
        max(case when component = 'fresh_24h' then weight end) as w24,
        max(case when component = 'fresh_72h' then weight end) as w72,
        max(case when component = 'density' then weight end) as wd,
        max(case when component = 'cold' then weight end) as wc,
        max(case when component = 'base' then weight end) as wb,
        max(case when component = 'forecast' then weight end) as wf
    from {{ ref('powder_score_weights') }}

),

parts as (

    select
        daily.resort_id,
        daily.date,
        least(daily.new_snow_24h_in / 12.0, 1) as s24,
        least(daily.new_snow_72h_in / 24.0, 1) as s72,
        case
            when daily.density_72h_pct is null then 0
            when daily.density_72h_pct <= 8 then 1
            when daily.density_72h_pct >= 18 then 0
            else (18 - daily.density_72h_pct) / 10.0
        end * least(daily.new_snow_72h_in / 6.0, 1) as sd,
        case
            when coalesce(daily.snow_depth_in, 0) <= 0 or daily.temp_avg_72h_f is null then 0
            when daily.temp_avg_72h_f <= 18 then 1
            when daily.temp_avg_72h_f >= 36 then 0
            else (36 - daily.temp_avg_72h_f) / 18.0
        end as sc,
        least(coalesce(daily.snow_depth_in, 0) / 60.0, 1) as sb,
        case when daily.forecast_snow_72h_in is not null then least(daily.forecast_snow_72h_in / 12.0, 1) end as sf
    from {{ ref('resort_daily') }} as daily

),

expected as (

    select
        parts.resort_id,
        parts.date,
        100 * (w24 * s24 + w72 * s72 + wd * sd + wc * sc + wb * sb + wf * coalesce(sf, 0))
            / (w24 + w72 + wd + wc + wb + case when sf is not null then wf else 0 end) as expected_score
    from parts
    cross join weights

)

select score.resort_id, score.date, score.powder_score, expected.expected_score
from {{ ref('powder_score') }} as score
inner join expected on score.resort_id = expected.resort_id and score.date = expected.date
-- The mart sums six parts each rounded to 0.1, so it can differ by up to 0.3.
where abs(score.powder_score - expected.expected_score) > 0.31
   or abs(
        score.powder_score
        - (score.fresh_24h_points + score.fresh_72h_points + score.density_points
           + score.cold_points + score.base_points + coalesce(score.forecast_points, 0))
      ) > 0.001
