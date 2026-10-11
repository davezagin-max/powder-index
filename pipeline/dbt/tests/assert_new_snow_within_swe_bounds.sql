-- The estimator's promise: new snow never exceeds what the SWE gain allows, and on a
-- day the pillow saw nothing and the depth sensor barely moved, there is none.
select station_triplet, obs_date, new_snow_in, swe_cap_in, swe_gain_in, depth_change_in
from {{ ref('int_station_new_snow') }}
where (swe_cap_in is not null and new_snow_in > swe_cap_in + 0.05)
   or (new_snow_in > 0 and swe_gain_in = 0 and coalesce(depth_change_in, 0) < {{ var('depth_noise_floor_in') }})
