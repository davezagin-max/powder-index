-- Every resort must have one row for every day between the first and last date, and
-- all resorts must share that range. A hole would silently shorten rolling windows.
with spans as (

    select
        resort_id,
        count(*) as row_count,
        date_diff('day', min(date), max(date)) + 1 as days_spanned,
        min(date) as first_date,
        max(date) as last_date
    from {{ ref('resort_daily') }}
    group by resort_id

)

select *
from spans
where row_count != days_spanned
   or first_date != (select min(first_date) from spans)
   or last_date != (select max(last_date) from spans)
