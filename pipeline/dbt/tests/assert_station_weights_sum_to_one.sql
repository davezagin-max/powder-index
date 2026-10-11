-- Every resort's station weights must sum to 1, or blended values would be scaled.
select resort_id, sum(weight) as total_weight
from {{ ref('int_resort_station_weights') }}
group by resort_id
having abs(sum(weight) - 1) > 1e-9
