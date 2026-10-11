-- The score is a weighted mean, so the weights must sum to exactly 1.
select sum(weight) as total_weight
from {{ ref('powder_score_weights') }}
having abs(sum(weight) - 1) > 1e-9
