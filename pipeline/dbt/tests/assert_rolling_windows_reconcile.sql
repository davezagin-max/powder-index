-- Recompute the 72-hour total with a self-join instead of a window function and compare.
with recomputed as (

    select
        today.resort_id,
        today.date,
        today.new_snow_72h_in,
        sum(recent.new_snow_24h_in) as summed
    from {{ ref('resort_daily') }} as today
    inner join {{ ref('int_resort_days') }} as recent
        on today.resort_id = recent.resort_id
        and recent.date between today.date - 2 and today.date
    group by 1, 2, 3

)

select *
from recomputed
-- Each of the three days is rounded to 0.1 before summing here, hence the tolerance.
where abs(new_snow_72h_in - summed) > 0.16
