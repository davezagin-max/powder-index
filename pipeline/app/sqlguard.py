"""SQL firewall for "Ask the data".

A language model writes the SQL and a visitor's browser runs it, so nothing the model
writes is trusted. `validate_sql` accepts one read-only SELECT over the published tables
and rejects everything else. It works on sqlglot's syntax tree, never on the text:

1. Parse as DuckDB. Exactly one statement, and it must be a SELECT (or a UNION,
   INTERSECT or EXCEPT of SELECTs). ATTACH, COPY, PRAGMA, INSTALL, SET, CREATE and the
   rest are different statement types and fail here.
2. Walk every node. Each must be an allowlisted node type; anything else (lambdas,
   parameters, PIVOT, struct literals, ...) is rejected by default. Unknown syntax is
   denied without anyone having to think of it first.
3. Every function must be allowlisted by name. That is what keeps out `read_csv`,
   `read_parquet`, `read_text`, `glob`, `query`, `getenv` and every other function
   that touches files, the network, or settings.
4. Every table must be one of the published tables or a CTE defined in the query.
   No schema qualifiers, so `information_schema.tables` is out, and CTE names must be
   plain identifiers, so a name can never double as a file path or URL (DuckDB reads
   `FROM "https://host/x.csv"` as a file).
5. The outer query gets a LIMIT: injected if missing, clamped if too large.
6. The SQL that is returned is regenerated from the tree, not copied from the input.
   Comments are gone, strings are re-quoted, and the regenerated text is parsed and
   checked a second time. What the browser runs is exactly what was validated, so a
   difference between how sqlglot and DuckDB read some odd token cannot be exploited.

Column names are deliberately not checked here. A wrong column is a correctness
problem, not a safety problem; DuckDB reports it in the browser and the error is sent
back to the model, which is the self-correction loop the feature exists to show.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Collection
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ErrorLevel, SqlglotError

# sqlglot logs a warning when it falls back to an opaque "Command" node; we reject those.
logging.getLogger("sqlglot").setLevel(logging.ERROR)

DIALECT = "duckdb"
MAX_SQL_CHARS = 4000
MAX_NODES = 2000
MAX_ROWS = 5000
DEFAULT_TABLES = frozenset({"resorts", "resort_daily", "powder_score"})

_PLAIN_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


class SqlRejected(ValueError):
    """The SQL broke a rule. `code` names the rule; the message is written for the model."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ValidatedQuery:
    sql: str  # regenerated from the syntax tree; this is what may be executed
    tables: tuple[str, ...]  # published tables the query reads
    limit: int  # row cap on the outer query
    limit_changed: bool  # True when the cap was injected or clamped
    # Output column names, lower-cased, when they can be read off the SELECT list.
    # None when the list has a star or an unnamed expression, so the names are unknown.
    columns: tuple[str, ...] | None = None


# ---------------------------------------------------------------------------------------
# Function allowlist, written in DuckDB's own names.
#
# sqlglot parses most functions into its own classes (`date_trunc` becomes
# TimestampTrunc, `string_agg` becomes GroupConcat) and leaves the rest as Anonymous
# nodes that carry a name. Rather than hand-maintain a list of sqlglot class names, each
# allowed function comes with an example call; at import time the examples are parsed
# and whatever sqlglot turns them into becomes the allowlist. A sqlglot upgrade that
# remaps a function is picked up automatically, and the list below stays readable.
# ---------------------------------------------------------------------------------------
_FUNCTION_EXAMPLES: dict[str, str] = {
    # aggregates
    "count": "count(a)",
    "count_if": "count_if(a > 1)",
    "sum": "sum(a)",
    "avg": "avg(a)",
    "min": "min(a)",
    "max": "max(a)",
    "median": "median(a)",
    "mode": "mode(a)",
    "stddev": "stddev(a)",
    "stddev_samp": "stddev_samp(a)",
    "stddev_pop": "stddev_pop(a)",
    "variance": "variance(a)",
    "var_samp": "var_samp(a)",
    "var_pop": "var_pop(a)",
    "corr": "corr(a, b)",
    "covar_pop": "covar_pop(a, b)",
    "covar_samp": "covar_samp(a, b)",
    "regr_slope": "regr_slope(a, b)",
    "regr_intercept": "regr_intercept(a, b)",
    "regr_r2": "regr_r2(a, b)",
    "quantile_cont": "quantile_cont(a, 0.5)",
    "quantile_disc": "quantile_disc(a, 0.5)",
    "arg_max": "arg_max(a, b)",
    "arg_min": "arg_min(a, b)",
    "max_by": "max_by(a, b)",
    "min_by": "min_by(a, b)",
    "any_value": "any_value(a)",
    "first": "first(a)",
    "last": "last(a)",
    "bool_and": "bool_and(a)",
    "bool_or": "bool_or(a)",
    "string_agg": "string_agg(a, ', ')",
    # window
    "row_number": "row_number() over (order by a)",
    "rank": "rank() over (order by a)",
    "dense_rank": "dense_rank() over (order by a)",
    "percent_rank": "percent_rank() over (order by a)",
    "cume_dist": "cume_dist() over (order by a)",
    "ntile": "ntile(4) over (order by a)",
    "lag": "lag(a, 1) over (order by a)",
    "lead": "lead(a, 1) over (order by a)",
    "first_value": "first_value(a) over (order by a)",
    "last_value": "last_value(a) over (order by a)",
    "nth_value": "nth_value(a, 2) over (order by a)",
    # numeric
    "round": "round(a, 1)",
    "floor": "floor(a)",
    "ceil": "ceil(a)",
    "ceiling": "ceiling(a)",
    "trunc": "trunc(a)",
    "abs": "abs(a)",
    "sign": "sign(a)",
    "sqrt": "sqrt(a)",
    "power": "power(a, 2)",
    "pow": "pow(a, 2)",
    "exp": "exp(a)",
    "ln": "ln(a)",
    "log": "log(a)",
    "log10": "log10(a)",
    "log2": "log2(a)",
    "greatest": "greatest(a, b)",
    "least": "least(a, b)",
    # conditional and null handling
    "coalesce": "coalesce(a, b)",
    "ifnull": "ifnull(a, b)",
    "nullif": "nullif(a, b)",
    "if": "if(a > 1, b, c)",
    "case": "case when a > 1 then b else c end",
    "cast": "cast(a as integer)",
    "try_cast": "try_cast(a as integer)",
    "and": "a and b",
    "or": "a or b",
    "exists": "exists (select 1)",
    # text
    "lower": "lower(a)",
    "upper": "upper(a)",
    "length": "length(a)",
    "concat": "concat(a, b)",
    "concat_ws": "concat_ws(', ', a, b)",
    "substring": "substring(a, 1, 3)",
    "substr": "substr(a, 1, 3)",
    "left": "left(a, 3)",
    "right": "right(a, 3)",
    "replace": "replace(a, 'x', 'y')",
    "trim": "trim(a)",
    "starts_with": "starts_with(a, 'x')",
    "contains": "contains(a, 'x')",
    # dates
    "date_trunc": "date_trunc('month', a)",
    "date_part": "date_part('year', a)",
    "extract": "extract(year from a)",
    "year": "year(a)",
    "month": "month(a)",
    "day": "day(a)",
    "week": "week(a)",
    "weekofyear": "weekofyear(a)",
    "quarter": "quarter(a)",
    "dayofweek": "dayofweek(a)",
    "dayofyear": "dayofyear(a)",
    "dayname": "dayname(a)",
    "monthname": "monthname(a)",
    "strftime": "strftime(a, '%Y-%m')",
    "date_diff": "date_diff('day', a, b)",
    "datediff": "datediff('day', a, b)",
    "date_add": "date_add(a, interval 1 day)",
    "date_sub": "date_sub('day', a, b)",
    "make_date": "make_date(2026, 1, 1)",
    "last_day": "last_day(a)",
    "current_date": "current_date",
    "today": "today()",
    # table functions (numbers only; nothing that reads a file)
    "generate_series": "generate_series(1, 10)",
    "range": "range(10)",
}


def _derive_function_allowlist() -> tuple[frozenset[type[exp.Expr]], frozenset[str]]:
    classes: set[type[exp.Expr]] = set()
    anonymous: set[str] = set()
    for name, example in _FUNCTION_EXAMPLES.items():
        tree = sqlglot.parse_one(f"SELECT {example}", read=DIALECT)
        found = list(tree.find_all(exp.Func))
        if not found:
            raise RuntimeError(f"Example for {name!r} contains no function call")
        for node in found:
            if isinstance(node, exp.Anonymous):
                anonymous.add(node.name.lower())
            else:
                classes.add(type(node))
    return frozenset(classes), frozenset(anonymous)


_FUNCTION_CLASSES, _ANONYMOUS_FUNCTIONS = _derive_function_allowlist()

# Every non-function node a query may contain. Matched on exact type.
_NODE_TYPES: frozenset[type[exp.Expr]] = frozenset(
    {
        # query structure
        exp.Select, exp.Union, exp.Intersect, exp.Except, exp.Subquery, exp.With, exp.CTE,
        exp.From, exp.Join, exp.Where, exp.Group, exp.Having, exp.Qualify, exp.Order,
        exp.Ordered, exp.Limit, exp.Offset, exp.Distinct, exp.Rollup, exp.Cube, exp.GroupingSets,
        # names and values
        exp.Table, exp.TableAlias, exp.Column, exp.Identifier, exp.Star, exp.Alias, exp.Paren,
        exp.Tuple, exp.Literal, exp.Boolean, exp.Null, exp.Var, exp.DataType, exp.DataTypeParam,
        exp.Interval,
        # comparisons and logic
        exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Is, exp.Not, exp.In, exp.Between,
        exp.Like, exp.ILike, exp.NullSafeEQ, exp.NullSafeNEQ,
        # arithmetic and text operators
        exp.Add, exp.Sub, exp.Mul, exp.Div, exp.IntDiv, exp.Mod, exp.Neg, exp.DPipe,
        # windows and aggregate modifiers
        exp.Window, exp.WindowSpec, exp.Filter, exp.IgnoreNulls, exp.RespectNulls,
    }
)  # fmt: skip

# Clauses each structural node may carry. A populated argument outside its set is refused,
# which is what catches SELECT ... INTO, FOR UPDATE, TABLESAMPLE, table versions, and so on.
_ALLOWED_ARGS: dict[type[exp.Expr], frozenset[str]] = {
    exp.Select: frozenset(
        {"with_", "expressions", "from_", "joins", "where", "group", "having", "qualify",
         "windows", "distinct", "order", "limit", "offset"}
    ),
    exp.Union: frozenset({"with_", "this", "expression", "distinct", "by_name", "order", "limit", "offset"}),
    exp.Table: frozenset({"this", "alias"}),
    exp.Join: frozenset({"this", "on", "using", "side", "kind"}),
    exp.With: frozenset({"expressions"}),
    exp.Limit: frozenset({"expression"}),
    exp.Offset: frozenset({"expression"}),
}  # fmt: skip
_ALLOWED_ARGS[exp.Intersect] = _ALLOWED_ARGS[exp.Union]
_ALLOWED_ARGS[exp.Except] = _ALLOWED_ARGS[exp.Union]

_QUERY_ROOTS = (exp.Select, exp.Union, exp.Intersect, exp.Except)


def allowed_function_names() -> list[str]:
    """The allowlist in DuckDB's names, for the model prompt and the docs."""
    return sorted(_FUNCTION_EXAMPLES)


def _function_name(node: exp.Func) -> str:
    return (node.name if isinstance(node, exp.Anonymous) else node.sql_name()).lower()


def _statement_name(node: exp.Expr) -> str:
    if isinstance(node, exp.Command):
        return str(node.this).upper()
    return type(node).__name__.upper()


def _parse(sql: str) -> exp.Expr:
    try:
        statements = sqlglot.parse(sql, read=DIALECT)
    except SqlglotError as error:
        detail = ""
        errors = getattr(error, "errors", None)
        if errors:
            first = errors[0]
            detail = f"{first.get('description', 'syntax error')} at line {first.get('line')}, column {first.get('col')}"
        raise SqlRejected(
            "parse", f"The SQL did not parse: {detail or _ANSI.sub('', str(error))[:200]}"
        ) from None
    except RecursionError:
        raise SqlRejected("too_complex", "The SQL is nested too deeply.") from None
    # A trailing comment after the final semicolon parses as an empty Semicolon node.
    real = [s for s in statements if s is not None and not isinstance(s, exp.Semicolon)]
    if not real:
        raise SqlRejected("parse", "The SQL is empty.")
    if len(real) > 1:
        raise SqlRejected("multiple_statements", f"Send exactly one statement; found {len(real)}.")
    root = real[0]
    # Allow one pair of wrapping parentheses around the whole query.
    if isinstance(root, exp.Subquery) and not any(
        value for key, value in root.args.items() if key != "this"
    ):
        root = root.this
    if not isinstance(root, _QUERY_ROOTS):
        raise SqlRejected(
            "not_select", f"Only a single SELECT query is allowed, not {_statement_name(root)}."
        )
    return root


def _check_args(node: exp.Expr) -> None:
    allowed = _ALLOWED_ARGS.get(type(node))
    if allowed is None:
        return
    for key, value in node.args.items():
        if key in allowed or value is None or value is False or value == []:
            continue
        if isinstance(node, exp.With) and key == "recursive":
            raise SqlRejected("construct", "Recursive CTEs are not allowed.")
        if isinstance(node, exp.Table) and key in ("db", "catalog"):
            raise SqlRejected(
                "table",
                f"Do not qualify table names with a schema ({node.sql(dialect=DIALECT)}). "
                "Use the bare table name.",
            )
        if isinstance(node, (exp.Limit, exp.Offset)):
            raise SqlRejected("limit", "LIMIT and OFFSET must be plain non-negative integers.")
        clause = key.strip("_").upper()
        raise SqlRejected(
            "construct", f"{clause} is not supported on {type(node).__name__.upper()} here."
        )


def _integer_literal(node: exp.Expr | None) -> int | None:
    if isinstance(node, exp.Literal) and not node.is_string and re.fullmatch(r"\d{1,9}", node.name):
        return int(node.name)
    return None


def _check_tree(root: exp.Expr, tables: Collection[str]) -> tuple[str, ...]:
    """Raise SqlRejected unless every node is allowed. Returns the published tables read."""
    allowed_tables = {name.lower() for name in tables}
    cte_names: set[str] = set()
    for cte in root.find_all(exp.CTE):
        alias = cte.alias
        if not _PLAIN_IDENTIFIER.match(alias):
            raise SqlRejected(
                "construct", "CTE names must be plain identifiers (letters, digits, underscores)."
            )
        cte_names.add(alias.lower())

    used: set[str] = set()
    count = 0
    for node in root.walk():
        count += 1
        if count > MAX_NODES:
            raise SqlRejected("too_complex", "The SQL is too large. Write a simpler query.")
        kind = type(node)

        if isinstance(node, exp.Func):
            if isinstance(node, exp.Anonymous):
                if node.name.lower() not in _ANONYMOUS_FUNCTIONS:
                    raise SqlRejected("function", f"Function {node.name.lower()}() is not allowed.")
            elif kind not in _FUNCTION_CLASSES:
                raise SqlRejected("function", f"Function {_function_name(node)}() is not allowed.")
            continue

        if kind not in _NODE_TYPES:
            raise SqlRejected("construct", f"Unsupported SQL construct: {kind.__name__}.")
        _check_args(node)

        if isinstance(node, exp.Table):
            target = node.this
            if isinstance(target, exp.Func):
                continue  # a table function; the function allowlist decides
            if not isinstance(target, exp.Identifier):
                raise SqlRejected("table", "FROM must name a table.")
            name = target.name.lower()
            if name in cte_names:
                continue
            if name not in allowed_tables:
                raise SqlRejected(
                    "table",
                    f'Unknown table "{target.name}". The only tables are: '
                    f"{', '.join(sorted(allowed_tables))}.",
                )
            used.add(name)
        elif (
            isinstance(node, (exp.Limit, exp.Offset)) and _integer_literal(node.expression) is None
        ):
            raise SqlRejected("limit", "LIMIT and OFFSET must be plain non-negative integers.")
    return tuple(sorted(used))


def _enforce_limit(root: exp.Expr, max_rows: int) -> tuple[int, bool]:
    limit = root.args.get("limit")
    if limit is None:
        root.set("limit", exp.Limit(expression=exp.Literal.number(max_rows)))
        return max_rows, True
    current = _integer_literal(limit.expression) if isinstance(limit, exp.Limit) else None
    if current is None:
        raise SqlRejected("limit", "LIMIT must be a plain non-negative integer.")
    if current > max_rows:
        limit.set("expression", exp.Literal.number(max_rows))
        return max_rows, True
    return current, False


def _output_columns(root: exp.Expr) -> tuple[str, ...] | None:
    select = root
    while isinstance(select, (exp.Union, exp.Intersect, exp.Except)):
        select = select.this  # a set operation takes its column names from the left side
    if isinstance(select, exp.Subquery):
        select = select.this
    if not isinstance(select, exp.Select):
        return None
    names: list[str] = []
    for projection in select.expressions:
        if projection.find(exp.Star) is not None and not isinstance(projection, exp.Alias):
            return None
        name = projection.alias_or_name
        if not name:
            return None
        names.append(name.lower())
    return tuple(names)


def validate_sql(
    sql: str, *, tables: Collection[str] = DEFAULT_TABLES, max_rows: int = MAX_ROWS
) -> ValidatedQuery:
    """Return the safe, regenerated form of `sql`, or raise SqlRejected."""
    if not isinstance(sql, str) or not sql.strip():
        raise SqlRejected("parse", "The SQL is empty.")
    if len(sql) > MAX_SQL_CHARS:
        raise SqlRejected("too_long", f"The SQL is longer than {MAX_SQL_CHARS} characters.")
    if "\x00" in sql:
        raise SqlRejected("parse", "The SQL contains a NUL byte.")

    try:
        root = _parse(sql)
        used = _check_tree(root, tables)
        limit, changed = _enforce_limit(root, max_rows)
        try:
            safe_sql = root.sql(
                dialect=DIALECT, pretty=True, comments=False, unsupported_level=ErrorLevel.RAISE
            )
        except SqlglotError:
            raise SqlRejected("construct", "The SQL uses syntax DuckDB does not support.") from None

        # Second pass, on the text that will actually run.
        again = _parse(safe_sql)
        _check_tree(again, tables)
        final_limit, changed_again = _enforce_limit(again, max_rows)
        if changed_again or final_limit != limit:
            raise SqlRejected("construct", "The SQL did not survive regeneration unchanged.")
    except RecursionError:
        raise SqlRejected("too_complex", "The SQL is nested too deeply.") from None
    return ValidatedQuery(
        sql=safe_sql,
        tables=used,
        limit=limit,
        limit_changed=changed,
        columns=_output_columns(again),
    )
