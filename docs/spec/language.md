# Aster v0 Language Reference

Aster is a small, statically typed, compiled language. v0 compiles to C and then to a native executable.

```
fn main(): int {
    let x: int = 10;
    let y: int = 20;

    print(x + y);

    return 0;
}
```

Run it with `pnpm build && pnpm aster run hello.aster`.

## Lexical structure

- Comments: `//` to end of line. No block comments.
- Whitespace is insignificant except as a separator.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`, excluding keywords.
- Keywords: `fn let var if else while break continue return true false`.
- Type names `int bool string void` are ordinary identifiers resolved as types in type position. They are not keywords.
- Integer literals: decimal digits only. A literal that does not fit in a signed 64-bit integer is a compile error. A negative number is unary minus applied to a literal. As a special case, `-9223372036854775808` is accepted.
- String literals: `"..."` with escapes `\n \t \\ \" \0`. Any other escape is a compile error. Raw newlines inside a string literal are a compile error.
- Punctuation: `( ) { } , : ; = + - * / % ! < <= > >= == != && ||`.

## Types

| Type     | Meaning |
|----------|---------|
| `int`    | 64-bit signed integer. Arithmetic wraps (two's complement) on overflow. |
| `bool`   | `true` / `false`. |
| `string` | Immutable sequence of bytes (UTF-8 by convention). Never freed in v0; memory is reclaimed at process exit. |
| `void`   | Return type only. Not usable as a variable or parameter type. |

There are no implicit conversions.

## Grammar

```
program     = { function } EOF ;
function    = "fn" IDENT "(" [ param { "," param } ] ")" [ ":" type ] block ;
param       = IDENT ":" type ;
type        = IDENT ;                       (* int | bool | string | void *)

block       = "{" { statement } "}" ;
statement   = "let" IDENT ":" type "=" expr ";"
            | "var" IDENT ":" type "=" expr ";"
            | IDENT "=" expr ";"
            | ifStmt
            | "while" expr block
            | "break" ";"
            | "continue" ";"
            | "return" [ expr ] ";"
            | block
            | expr ";" ;
ifStmt      = "if" expr block [ "else" ( ifStmt | block ) ] ;

expr        = or ;
or          = and { "||" and } ;
and         = equality { "&&" equality } ;
equality    = comparison { ( "==" | "!=" ) comparison } ;
comparison  = additive { ( "<" | "<=" | ">" | ">=" ) additive } ;
additive    = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "!" ) unary | postfix ;
postfix     = primary { "(" [ expr { "," expr } ] ")" } ;
primary     = INT | STRING | "true" | "false" | IDENT
            | "(" expr ")"
            | ifExpr ;
ifExpr      = "if" expr exprBlock "else" ( ifExpr | exprBlock ) ;
exprBlock   = "{" expr "}" ;
```

Notes:
- All binary operators are left-associative. Comparison and equality operators are non-associative: `a < b < c` is a parse error.
- A statement beginning with `if` is always parsed as `ifStmt`. An `if` in expression position (after `=`, as an argument, as an operand, after `return`) is parsed as `ifExpr`.
- Omitting `: type` on a function means `void`.
- Only a plain identifier can be called; calling any other expression is a type error.
- The parser is hand-written: recursive descent for statements, precedence climbing (Pratt) for expressions.

## Semantics and type rules

**Functions**
- Functions are top-level and may be declared in any order. Mutual and direct recursion are allowed.
- Function names must be unique and must not collide with builtin names.
- `fn main(): int` with no parameters must exist. Its return value is the process exit code (truncated to the platform's exit-status range by the OS).
- Parameters are immutable.
- A non-`void` function in which any control path can reach the end of the body without `return` is a compile error. A `while true` loop with no `break` counts as non-terminating, and the code after it is unreachable. Every other `while` condition is treated as possibly false. An expression statement that calls `panic` also ends its path.
- `return e;` in a `void` function and `return;` in a non-`void` function are errors. Arguments are checked for count and type.

**Variables**
- `let` declares an immutable binding and `var` a mutable one. An initializer is required and must match the declared type.
- Assignment `x = e;` requires `x` to be a `var` and `e` to have the same type as `x`.
- Redeclaring a name in the same scope is an error. Shadowing a name from an enclosing scope (including parameters) is allowed.
- Variables of type `void` are an error.

**Control flow**
- Conditions of `if`/`while` must be `bool`.
- `break` and `continue` outside a loop are errors.
- In an `if` expression, the `else` is mandatory and all branches must have the same type, which is the expression's type. That type must not be `void`.
- An expression statement may be any expression. Its value is discarded.

**Operators**

| Operator | Operands | Result |
|----------|----------|--------|
| unary `-` | int | int (wrapping) |
| `!` | bool | bool |
| `+` | int, int / string, string | int (wrapping) / string (concatenation) |
| `- *` | int, int | int (wrapping) |
| `/ %` | int, int | int; truncates toward zero; panics on zero divisor; `MIN / -1` wraps to `MIN` and `MIN % -1` is `0` |
| `< <= > >=` | int, int | bool |
| `== !=` | same type (int, bool, string) | bool; string equality compares bytes |
| `&& \|\|` | bool, bool | bool; short-circuiting |

Evaluation order: operands left to right, arguments left to right.

## Builtins

Builtins are special-cased in the checker (there is no overloading or generics in user code).

| Builtin | Signature | Behaviour |
|---------|-----------|-----------|
| `print` | `(x: int \| bool \| string): void` | Writes `x` and a newline to stdout. bools print as `true`/`false`. |
| `len` | `(s: string): int` | Byte length. |
| `byte_at` | `(s: string, i: int): int` | Byte value 0–255 at index `i`. Panics if `i < 0` or `i >= len(s)`. |
| `substring` | `(s: string, start: int, end: int): string` | Bytes `[start, end)`. Panics unless `0 <= start <= end <= len(s)`. |
| `int_to_string` | `(n: int): string` | Decimal representation. |
| `panic` | `(msg: string): void` | Writes `panic: <msg>` to stderr and exits with code 101. |

## Runtime panics

A runtime panic writes `panic: <message>` plus a newline to stderr and exits with code 101. Panics are triggered by:
- Division or modulo by zero (`division by zero`).
- An out-of-range `byte_at` (`index out of bounds: index <i>, length <n>`).
- An invalid `substring` range (`substring out of bounds: <start>..<end>, length <n>`).
- `panic(msg)`.

## Not in v0

Structs, arrays, pointers, generics, classes, modules, garbage collection, async, input, compound assignment (`+=`) and `for` loops.
