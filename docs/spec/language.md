# Aster v0.3 Language Reference

Aster is a small, statically typed, compiled language. It compiles to C and then to a native executable.

```
enum Shape { Circle(int), Rect(int, int), Dot }

fn area(s: Shape): int {
    return match s {
        Shape::Circle(r) => 3 * r * r,
        Shape::Rect(w, h) => w * h,
        Shape::Dot => 0,
    };
}

fn main(): int {
    let shapes: [Shape] = [Shape::Rect(2, 3), Shape::Circle(1), Shape::Dot];
    var total: int = 0;
    for s in shapes {
        total += area(s);
    }
    print(total);   // 9
    return 0;
}
```

Run it with `pnpm build && pnpm aster run example.aster`.

## Lexical structure

- Comments: `//` to end of line. No block comments.
- Whitespace is insignificant except as a separator.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`, excluding keywords.
- Keywords: `fn let var if else while for in break continue return true false struct enum match`.
- Type names `int bool string void` are ordinary identifiers resolved as types in type position. They are not keywords.
- Integer literals: decimal digits only. A literal that does not fit in a signed 64-bit integer is a compile error. A negative number is unary minus applied to a literal. As a special case, `-9223372036854775808` is accepted.
- String literals: `"..."` with escapes `\n \t \\ \" \0`. Any other escape is a compile error. Raw newlines inside a string literal are a compile error.
- Punctuation: `( ) { } [ ] , : ; . .. = + - * / % ! < <= > >= == != && || += -= *= /= %= :: =>`.
- `_` on its own is the wildcard token, not an identifier. Names that merely start with `_` (`_x`) are ordinary identifiers.

## Types

| Type     | Meaning |
|----------|---------|
| `int`    | 64-bit signed integer. Arithmetic wraps (two's complement) on overflow. |
| `bool`   | `true` / `false`. |
| `string` | Immutable sequence of bytes (UTF-8 by convention). |
| `void`   | Return type only. Not usable as a variable, parameter, field or element type. |
| `Name`   | A struct or an enum named `Name`. |
| `[T]`    | A reference to a growable array of `T`. `T` may be any type except `void`, including another array. |

There are no implicit conversions. Array types are equal when their element types are equal, and struct types are equal when their names are equal.

Structs and arrays are heap-allocated **references**. Assigning one, passing it to a function or returning it shares the same object, so a change made through one reference is visible through every other. There is no null: every struct literal sets every field. Nothing is freed; memory is reclaimed when the process exits.

An **enum** declares variants, each with zero or more positional payload values: `enum Expr { Num(int), Add(Expr, Expr) }`. If no variant has a payload, the enum is *payload-free*: its values are plain tags that can be compared with `==`. Otherwise its values are heap-allocated references like structs, and a payload struct or array is shared, not copied. Enum types are equal when their names are equal.

`ReadResult` is a predeclared enum, as if every program declared `enum ReadResult { Ok(string), Err(string) }`. It is what `read_file` returns, and it can be used like any other enum.

## Grammar

```
program     = { item } EOF ;
item        = function | structDecl | enumDecl ;
function    = "fn" IDENT "(" [ param { "," param } ] ")" [ ":" type ] block ;
param       = IDENT ":" type ;
structDecl  = "struct" IDENT "{" [ fieldDecl { "," fieldDecl } [ "," ] ] "}" ;
fieldDecl   = IDENT ":" type ;
enumDecl    = "enum" IDENT "{" variant { "," variant } [ "," ] "}" ;
variant     = IDENT [ "(" type { "," type } ")" ] ;
type        = IDENT | "[" type "]" ;

block       = "{" { statement } "}" ;
statement   = "let" IDENT ":" type "=" expr ";"
            | "var" IDENT ":" type "=" expr ";"
            | ifStmt
            | "while" expr block
            | forStmt
            | "break" ";"
            | "continue" ";"
            | "return" [ expr ] ";"
            | matchStmt
            | block
            | expr [ assignOp expr ] ";" ;
assignOp    = "=" | "+=" | "-=" | "*=" | "/=" | "%=" ;
ifStmt      = "if" expr block [ "else" ( ifStmt | block ) ] ;
forStmt     = "for" IDENT "in" expr [ ".." expr ] block ;
matchStmt   = "match" expr "{" { pattern "=>" ( block [ "," ] | expr "," ) } "}" ;

expr        = or ;
or          = and { "||" and } ;
and         = equality { "&&" equality } ;
equality    = comparison { ( "==" | "!=" ) comparison } ;
comparison  = additive { ( "<" | "<=" | ">" | ">=" ) additive } ;
additive    = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "!" ) unary | postfix ;
postfix     = primary { "(" [ expr { "," expr } ] ")" | "." IDENT | "[" expr "]" } ;
primary     = INT | STRING | "true" | "false" | IDENT
            | "(" expr ")"
            | ifExpr
            | structLit
            | arrayLit
            | variantExpr
            | matchExpr ;
structLit   = IDENT "{" [ fieldInit { "," fieldInit } [ "," ] ] "}" ;
fieldInit   = IDENT ":" expr ;
arrayLit    = "[" [ expr { "," expr } [ "," ] ] "]" ;
ifExpr      = "if" expr exprBlock "else" ( ifExpr | exprBlock ) ;
exprBlock   = "{" expr "}" ;
variantExpr = IDENT "::" IDENT [ "(" expr { "," expr } ")" ] ;
matchExpr   = "match" expr "{" pattern "=>" expr { "," pattern "=>" expr } [ "," ] "}" ;
pattern     = "_" | IDENT "::" IDENT [ "(" binder { "," binder } ")" ] ;
binder      = IDENT | "_" ;
```

Notes:
- All binary operators are left-associative. Comparison and equality operators are non-associative: `a < b < c` is a parse error.
- A statement beginning with `if` is always parsed as `ifStmt`. An `if` in expression position (after `=`, as an argument, as an operand, after `return`) is parsed as `ifExpr`.
- **Struct literals in headers.** In the condition of an `if` or `while`, and in a `for` header, `Name {` starts the body rather than a struct literal. To use a struct literal there, wrap it in parentheses: `if (Point { x: 1, y: 2 }).x == p.x { ... }`. Inside `( )`, `[ ]`, call arguments, struct literal fields, variant arguments and `match` arms (expression arms and block arms alike), struct literals are allowed again.
- In an assignment, the left-hand side must be a place: a variable, a field `e.f` or an element `e[i]`, nested as deep as needed (`a[i].kids[j] = n;`). Anything else is the error `invalid assignment target`.
- `..` appears only in `for` headers.
- Omitting `: type` on a function means `void`.
- Only a plain identifier can be called. Calling any other expression (`a.f()`, `a[0]()`) is a type error.
- The parser is hand-written: recursive descent for statements, precedence climbing (Pratt) for expressions.
- A statement beginning with `match` is always a `matchStmt`; a `match` anywhere else is a `matchExpr`. In a `matchStmt`, an expression arm needs a trailing `,` unless it is the last arm. The scrutinee follows the struct-literal rule for headers.
- An enum needs at least one variant. `V()` with empty parentheses is a syntax error, in a declaration, a value or a pattern.
- Trailing commas are allowed in struct declarations, struct literals, array literals, enum variant lists and `match` arms (in both forms). They remain disallowed in parameter lists, call arguments, payload type lists, variant argument lists and binder lists.

## Semantics and type rules

**Functions, structs and enums**
- Functions and structs are top-level and may be declared in any order. Functions may recurse directly or mutually, and structs and enums may refer to themselves and to each other.
- Function names must be unique and must not collide with builtin names. Struct and enum names share the type namespace. They must not be `int`, `bool`, `string` or `void`, and must not duplicate another struct, enum, function or builtin. `ReadResult` is a builtin type and cannot be redefined.
- Struct and enum names live in the type namespace. A local variable may share a struct's or enum's name.
- Field names must be unique within a struct. Any identifier is allowed, including `len` or `int`. An empty struct `struct Unit {}` is allowed.
- `main` must exist with the signature `fn main(): int` or `fn main(args: [string]): int` (any parameter name). `args` holds the command-line arguments without the program name, as a fresh array. The return value is the process exit code (truncated to the platform's exit-status range by the OS).
- Parameters are immutable bindings.
- A non-`void` function in which any control path can reach the end of the body without `return` is a compile error. A `while true` loop with no `break` counts as non-terminating, and the code after it is unreachable. Every other `while` condition is treated as possibly false, and every `for` loop as possibly running zero times. An expression statement that calls `panic` ends its path, and a `match` statement ends a path when all of its arms do.
- `return e;` in a `void` function and `return;` in a non-`void` function are errors. `return e;` requires `e` to match the declared return type.
- Calls are checked for argument count and argument types.

**Variables and assignment**
- `let` declares an immutable binding and `var` a mutable one. An initializer is required and must match the declared type.
- `x = e;` requires `x` to be a `var`, and `e` must have the type of `x`; the same holds for assignment to a field or element. Writing through a field or element (`p.x = 1;`, `a[i] = 2;`) is always allowed: `let` fixes the binding, not the object it refers to.
- Compound assignment `p op= e` is allowed when `p op e` is well typed with the type of `p`. `+=` works on `int` and `string` (concatenation); `-= *= /= %=` work on `int` only.
- Order of evaluation:
  - `o.f = v` evaluates `o`, then `v`.
  - `a[i] = v` evaluates `a`, then `i`, then `v`, then checks bounds and stores.
  - In compound assignment, the object and index are evaluated once, the old value is loaded, then the right-hand side is evaluated.
- Redeclaring a name in the same scope is an error. Shadowing a name from an enclosing scope (including parameters) is allowed.

**Structs and arrays**
- A struct literal `Name { f: e, ... }` must set every field exactly once, in any order. Initialisers run in the order written. Mistakes are reported as `missing field '<f>' in '<Name>'`, `duplicate field '<f>'` and `unknown field '<f>' on '<Name>'`.
- `e.f` reads a field. `e[i]` reads an element, where `i` must be an `int`. Indexing outside `[0, len)` panics. Strings cannot be indexed; use `byte_at`.
- An array literal `[e1, e2]` takes its element type from the context it appears in, or else from its first element. An empty `[]` needs that context: a `let`/`var` type, an assignment target, a parameter, a return type, a field, a variant payload value (`Opt::Some([])`), `push`'s second argument, an enclosing array literal, or an `if`-expression or `match`-expression arm in one of those positions. Anywhere else, `[]` is the error `cannot infer type of empty array`.
- `==` and `!=` are not defined on structs or arrays (`cannot compare '<T>' values`). `print` accepts only `int`, `bool` and `string`.

**Enums and match**
- `E::V` / `E::V(e1, …)` builds a variant. The number of values must equal the variant's payload count (`variant 'E::V' expects N values, got M`). Values are evaluated left to right, and each takes its slot type as context (so `Opt::Some([])` works). Errors: `unknown enum 'E'`, `'E' is not an enum`, `unknown variant 'V' on 'E'`.
- `match e { … }` requires an enum scrutinee (`cannot match on 'T' values`), evaluates it once, and runs the first arm whose pattern matches. A pattern is `_` or `E::V(b1, …)` with one binder per payload slot. A binder is a new immutable name scoped to its arm, or `_` to ignore that slot. Patterns must name variants of the scrutinee's enum (`pattern type 'F' does not match 'E'`), and binder names must be distinct (`duplicate binding 'x'`).
- Matches are exhaustive. Every variant needs an arm unless there is a `_` arm, or it is a compile error (`non-exhaustive match: missing 'E::A', …`). An arm that can never run is also an error (`unreachable match arm`): a repeated variant, any arm after `_`, or `_` after every variant is covered.
- In a `match` expression, all arms must have the same type, which must not be `void` (`match arms have different types: A and B`, `match expression cannot have type void`).
- `==` and `!=` work on payload-free enums. On other enums they are `cannot compare 'E' values`. `print` does not accept enums.

**Control flow**
- Conditions of `if`/`while` must be `bool`.
- An expression statement may be any expression. Its value is discarded.
- `for i in a..b { }` runs `i` over `a, a+1, …, b-1`. Both bounds must be `int`, and they are evaluated once, `a` first, before the first iteration. When `a >= b`, the body doesn't run.
- `for x in arr { }` evaluates `arr` once, then runs `x` over its elements by index. The length is re-checked before every iteration, so `push` inside the loop extends it and `pop` shortens it. Rebinding the variable `arr` came from has no effect on the loop.
- The loop variable of a `for` is an immutable binding scoped to the body.
- `break` and `continue` work in `while` and `for`. Outside a loop they are errors.
- In an `if` expression, the `else` is mandatory and all branches must have the same type, which is the expression's type. That type must not be `void`.

**Operators**

| Operator | Operands | Result |
|----------|----------|--------|
| unary `-` | int | int (wrapping) |
| `!` | bool | bool |
| `+` | int, int / string, string | int (wrapping) / string (concatenation) |
| `- *` | int, int | int (wrapping) |
| `/ %` | int, int | int; truncates toward zero; panics on zero divisor; `MIN / -1` wraps to `MIN` and `MIN % -1` is `0` |
| `< <= > >=` | int, int | bool |
| `== !=` | same type (int, bool, string, payload-free enum) | bool; string equality compares bytes |
| `&& \|\|` | bool, bool | bool; short-circuiting |

Evaluation order: operands left to right, arguments left to right.

## Builtins

Builtins are special-cased in the checker. There is no overloading or generics in user code.

| Builtin | Signature | Behaviour |
|---------|-----------|-----------|
| `print` | `(x: int \| bool \| string): void` | Writes `x` and a newline to stdout. bools print as `true`/`false`. |
| `len` | `(s: string): int` / `(a: [T]): int` | Byte length of a string, or element count of an array. |
| `push` | `(a: [T], x: T): void` | Appends `x` to `a`. |
| `pop` | `(a: [T]): T` | Removes and returns the last element. Panics if `a` is empty. |
| `byte_at` | `(s: string, i: int): int` | Byte value 0–255 at index `i`. Panics if `i < 0` or `i >= len(s)`. |
| `substring` | `(s: string, start: int, end: int): string` | Bytes `[start, end)`. Panics unless `0 <= start <= end <= len(s)`. |
| `int_to_string` | `(n: int): string` | Decimal representation. |
| `read_file` | `(path: string): ReadResult` | Reads the whole file as raw bytes. `Ok(contents)` on success; `Err("<path>: <reason>")` on failure, with the OS's reason (`No such file or directory`, `Is a directory`, …) or `invalid path` for a path containing `\0`. A relative path resolves against the working directory. |
| `read_stdin` | `(): string` | Reads stdin to EOF. Later calls return `""`. |
| `panic` | `(msg: string): void` | Writes `panic: <msg>` to stderr and exits with code 101. |

## Runtime panics

A runtime panic writes `panic: <message>` plus a newline to stderr and exits with code 101. Panics are triggered by:
- Division or modulo by zero, including `/=` and `%=` (`division by zero`).
- An out-of-range `byte_at`, array read or array write (`index out of bounds: index <i>, length <n>`).
- An invalid `substring` range (`substring out of bounds: <start>..<end>, length <n>`).
- `pop` on an empty array (`pop from empty array`).
- Running out of memory (`out of memory`).
- A read error on stdin (`cannot read stdin: <reason>`).
- `panic(msg)`.

## Not in v0.3

Writing files, writing to stderr or stdout without a newline, line-at-a-time stdin, environment variables, nested patterns, matching on `int`/`bool`/`string` values, match guards, generics, methods, null, equality on structs, arrays or enums with payloads, printing structs, arrays or enums, modules, freeing memory, and C-style `for` loops.
