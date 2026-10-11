-- A forecast belongs to the day it was fetched and to no other, and the score must
-- treat a missing forecast as unknown rather than as zero or as a perfect 1.
select daily.resort_id, daily.date, daily.forecast_snow_72h_in, score.forecast_score, score.weight_known
from {{ ref('resort_daily') }} as daily
inner join {{ ref('powder_score') }} as score
    on daily.resort_id = score.resort_id and daily.date = score.date
left join {{ ref('int_resort_forecast') }} as forecast
    on daily.resort_id = forecast.resort_id and daily.date = forecast.forecast_date
where (daily.forecast_snow_72h_in is not null and forecast.resort_id is null)
   or (daily.forecast_snow_72h_in is null) != (score.forecast_score is null)
   or (daily.forecast_snow_72h_in is null) != (score.forecast_points is null)
   or (daily.forecast_snow_72h_in is null and abs(score.weight_known - 0.9) > 1e-9)
   or (daily.forecast_snow_72h_in is not null and abs(score.weight_known - 1.0) > 1e-9)
