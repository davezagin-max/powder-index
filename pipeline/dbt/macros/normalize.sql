{#- Linear 0..1 score between two anchors, clamped. `zero_at` may be above `full_at`,
    which inverts the scale (lower is better).

    A null input must stay null. DuckDB's least() and greatest() skip nulls, so without
    the explicit guard a missing value would silently score a perfect 1.0. -#}
{% macro normalize(value, zero_at, full_at) -%}
    case
        when {{ value }} is null then null
        else greatest(0.0, least(1.0, ({{ value }} - {{ zero_at }}) / nullif({{ full_at }} - {{ zero_at }}, 0)))
    end
{%- endmacro %}
