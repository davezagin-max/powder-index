{#- A water year runs 1 October to 30 September and is named for the year it ends in. -#}
{% macro water_year(date_column) -%}
    cast(year({{ date_column }}) + case when month({{ date_column }}) >= 10 then 1 else 0 end as integer)
{%- endmacro %}
