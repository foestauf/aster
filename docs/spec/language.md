# Aster v0.7 Language Reference

Aster is a small, statically typed, compiled language. It compiles to C and then to a native executable.

```aster
enum Tree[T] { Node(Tree[T], T, Tree[T]), Leaf }

fn parse_digit(s: string, i: int): Option[int] {
    if i >= len(s) {
        return Option::None;
    }
    let b: int = byte_at(s, i);
    if b < '0' || b > '9' {
        return Option::None;
    }
    return Option::Some(b - '0');
}

fn sum2(s: string): Option[int] {
    return Option::Some(parse_digit(s, 0)? + parse_digit(s, 1)?);
}

fn load(path: string): Result[int, string] {
    let text: string = read_file(path)?;
    return Result::Ok(len(text));
}

fn total(t: Tree[int]): int {
    return match t {
        Tree::Node(l, v, r) => total(l) + v + total(r),
        Tree::Leaf => 0,
    };
}

fn main(): int {
    match sum2("42") {
        Option::Some(n) => print(n),   // 6
        Option::None => print("bad"),
    }
    let leaf: Tree[int] = Tree::Leaf;
    print(total(Tree::Node(leaf, 5, Tree::Node(leaf, 7, leaf))));   // 12
    match load("/nonexistent") {
        Result::Ok(n) => print(n),
        Result::Err(e) => eprint(e),
    }
    return 0;
}
```

Run it with `pnpm build && pnpm aster run example.aster`. It prints `6` and `12`, then the read error on stderr.

`let … else`, `if let` and the `never` type unwrap an `Option` without `?`:

```aster
fn die(msg: string): never {
    eprint(msg);
    exit(1);
}

fn first_digit(s: string): int {
    let Option::Some(d) = parse_digit(s, 0) else {
        return -1;
    };
    return d;
}

fn main(): int {
    if let Option::Some(n) = parse_digit("7", 0) {
        print(n);   // 7
    } else {
        die("no digit");
    }
    print(first_digit("x"));   // -1
    return 0;
}
```

A program may span several files. This one is two, `main.aster` and `geometry.aster` in the same directory:

```aster
// main.aster
import "geometry.aster";

fn main(): int {
    let p: Point = Point { x: 3, y: 4 };
    print(norm2(p));   // 25
    return 0;
}
```

```aster
// geometry.aster
struct Point { x: int, y: int }

fn norm2(p: Point): int {
    return p.x * p.x + p.y * p.y;
}
```

`pnpm aster run main.aster` prints `25`.

## Lexical structure

- Source encoding: every source file, the root and each import, must be well-formed UTF-8 (Unicode Table 3-7). A leading byte order mark is ignored. Anything else is a compile error at the first byte of the first ill-formed sequence: `<file>: error: invalid UTF-8 at line <L>, byte <B>` for the root, and `cannot import '<path>': invalid UTF-8 at line <L>, byte <B>` at the import of any other file. `L` is 1-based; `B` is the 0-based byte offset into the file as stored, BOM included. String values stay byte sequences at run time; this rule only covers source text.
- Comments: `//` to end of line. No block comments.
- Whitespace is insignificant except as a separator.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`, excluding keywords.
- Keywords: `fn let var if else while for in break continue return true false struct enum match import`. `Option` and `Result` are predeclared type names, not keywords.
- Type names `int bool string void never` are ordinary identifiers resolved as types in type position. They are not keywords.
- Integer literals: decimal digits only. A literal that does not fit in a signed 64-bit integer is a compile error. A negative number is unary minus applied to a literal. As a special case, `-9223372036854775808` is accepted.
- String literals: `"..."` with escapes `\n \t \r \\ \" \' \0`. Any other escape is a compile error. Raw newlines inside a string literal are a compile error.
- Character literals: `'a'`. The body is exactly one printable ASCII byte (0x20 to 0x7E) other than `'` and `\`, or one escape from the set above (`\n \t \r \\ \" \' \0`, the same set strings use). The value is the byte's value, so `'a'` is `97`, `' '` is `32`, `'\n'` is `10` and `'\''` is `39`. Errors, each reported once per literal:
  - `empty character literal` for `''`.
  - `unterminated character literal` when there is no closing `'` on the same line.
  - `character literal must be a single ASCII character` for two or more characters, or a non-ASCII or control character.
  - `invalid escape sequence '<text>'` for an unknown escape.

  An erroneous literal that is properly closed (for example an empty or multi-character one) still produces a token (with value 0), so it doesn't cause follow-on parse errors; an unterminated literal consumes the rest of the line, including any `;`, so a follow-on parse error may appear. A `'` inside a comment or a string literal does not start a character literal.
- Punctuation: `( ) { } [ ] , : ; . .. = + - * / % ! < <= > >= == != && || | += -= *= /= %= :: => ?`. `||` is one token, so `a || b` is unchanged and `|` appears only in patterns.
- `_` on its own is the wildcard token, not an identifier. Names that merely start with `_` (`_x`) are ordinary identifiers.

## Types

| Type     | Meaning |
|----------|---------|
| `int`    | 64-bit signed integer. Arithmetic wraps (two's complement) on overflow. A character literal is an `int`; there is no separate character type. |
| `bool`   | `true` / `false`. |
| `string` | Immutable sequence of bytes (UTF-8 by convention). |
| `void`   | Return type only. Not usable as a variable, parameter, field or element type. |
| `never`  | The type of an expression that does not finish, such as `panic("x")`. Valid only as a function's declared return type. See [The `never` type](#the-never-type). |
| `Name`   | A struct or a non-generic enum named `Name`. |
| `Name[T1, …]` | An instantiation of a generic enum, such as `Option[int]` or `Result[[string], string]`. Arguments may be any type except `void`. |
| `[T]`    | A reference to a growable array of `T`. `T` may be any type except `void`, including another array. |

There are no implicit conversions. Array types are equal when their element types are equal, and struct types are equal when their names are equal.

Structs and arrays are heap-allocated **references**. Assigning one, passing it to a function or returning it shares the same object, so a change made through one reference is visible through every other. There is no null: every struct literal sets every field. Nothing is freed; memory is reclaimed when the process exits.

An **enum** declares variants, each with zero or more positional payload values: `enum Expr { Num(int), Add(Expr, Expr) }`. If no variant has a payload, the enum is *payload-free*: its values are plain tags that can be compared with `==`. Otherwise its values are heap-allocated references like structs, and a payload struct or array is shared, not copied. Enum types are equal when their names are equal. Two instantiations are equal when their enum names are equal and their arguments are pairwise equal.

`Option` and `Result` are predeclared generic enums, as if every program declared `enum Option[T] { Some(T), None }` and `enum Result[T, E] { Ok(T), Err(E) }`. They can be used like any other generic enum. `read_file`, `write_file`, `make_temp_dir`, `remove_path` and `run_process` return `Result`s (see [Builtins](#builtins)).

**Generic enums.** An enum may declare type parameters: `enum Tree[T] { Node(Tree[T], T, Tree[T]), Leaf }`. Structs and functions cannot. `Name[T1, …]` names an instantiation, which behaves like a non-generic enum with the arguments substituted into its payloads. Because every parameter must appear in a payload, an instantiation always has a payload, so it is a heap-allocated reference and is not payload-free. Diagnostics write instantiations as `Option[int]` and `Result[[string], string]`, with `, ` between arguments. Each instantiation is compiled only if the program uses it.

## Grammar

```
program     = { item } EOF ;
item        = function | structDecl | enumDecl | importDecl ;
importDecl  = "import" STRING ";" ;
function    = "fn" IDENT "(" [ param { "," param } ] ")" [ ":" type ] block ;
param       = IDENT ":" type ;
structDecl  = "struct" IDENT "{" [ fieldDecl { "," fieldDecl } [ "," ] ] "}" ;
fieldDecl   = IDENT ":" type ;
enumDecl    = "enum" IDENT [ typeParams ] "{" variant { "," variant } [ "," ] "}" ;
variant     = IDENT [ "(" type { "," type } ")" ] ;
typeParams  = "[" IDENT { "," IDENT } "]" ;
type        = IDENT [ "[" type { "," type } "]" ] | "[" type "]" ;

block       = "{" { statement } "}" ;
statement   = "let" IDENT ":" type "=" expr ";"
            | "var" IDENT ":" type "=" expr ";"
            | "let" pattern "=" expr "else" block ";"
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
ifStmt      = "if" ( expr | "let" pattern "=" expr ) block [ "else" ( ifStmt | block ) ] ;
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
postfix     = primary { "(" [ expr { "," expr } ] ")" | "." IDENT | "[" expr "]" | "?" } ;
primary     = INT | CHAR | STRING | "true" | "false" | IDENT
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
matchExpr   = "match" expr "{" matchExprArm { "," matchExprArm } [ "," ] "}" ;
matchExprArm = pattern "=>" ( expr | block ) ;
pattern     = "_" | alternative { "|" alternative } ;
alternative = literal | IDENT "::" IDENT [ "(" binder { "," binder } ")" ] ;
literal     = [ "-" ] INT | CHAR | STRING | "true" | "false" ;
binder      = IDENT | "_" ;
```

Notes:
- A type parameter list or type argument list has at least one entry: `enum E[] { … }` and `Option[]` are both `expected identifier, found ']'`. Trailing commas are not allowed in either. In type position `Name[` always starts a type argument list, so it never conflicts with array types.
- `?` binds like the other postfix operators: `-x?` is `-(x?)`, `a.b?` is `(a.b)?`, and `f(x)?.y` and `xs[0]?` work. It may repeat (`x??`). `?` at the start of an expression is `expected expression, found '?'`.
- `_` must stand alone as a whole pattern. `_ | 1` is the parse error `expected '=>', found '|'`, and `1 | _` is `expected pattern, found '_'`. A token that cannot start an alternative is `expected pattern, found <token>`.
- In a pattern, `-` applies only to an `INT`. An int pattern is range-checked like an int expression, and `-9223372036854775808` is accepted.
- All binary operators are left-associative. Comparison and equality operators are non-associative: `a < b < c` is a parse error.
- **Telling the two `let` forms apart.** After `let`, an identifier followed by `::`, or a literal token (an int, a `-` before an int, a char, a string, `true` or `false`), starts a pattern. Anything else is the typed form, so `let _ = …` is still `expected identifier, found '_'`. In `let … else` the scrutinee follows the struct-literal rule for headers, `else` is required (`expected 'else', found …`), and the block is followed by `;`. The scrutinee of `if let` follows the same header rule.
- A match-expression arm whose body starts with `{` is a block arm. The `,` after a block arm is optional, as in a match statement. An expression arm still needs its `,` unless it is the last arm.
- If-expression branches are still `{ expr }`. A `{ stmts }` branch is not allowed, but a branch can diverge through a `never` call.
- A statement beginning with `if` is always parsed as `ifStmt`. An `if` in expression position (after `=`, as an argument, as an operand, after `return`) is parsed as `ifExpr`.
- **Struct literals in headers.** In the condition of an `if` or `while`, and in a `for` header, `Name {` starts the body rather than a struct literal. To use a struct literal there, wrap it in parentheses: `if (Point { x: 1, y: 2 }).x == p.x { ... }`. Inside `( )`, `[ ]`, call arguments, struct literal fields, variant arguments and `match` arms (expression arms and block arms alike), struct literals are allowed again.
- In an assignment, the left-hand side must be a place: a variable, a field `e.f` or an element `e[i]`, nested as deep as needed (`a[i].kids[j] = n;`). Anything else is the error `invalid assignment target`.
- `..` appears only in `for` headers.
- Omitting `: type` on a function means `void`.
- Only a plain identifier can be called. Calling any other expression (`a.f()`, `a[0]()`) is a type error.
- The parser is hand-written: recursive descent for statements, precedence climbing (Pratt) for expressions.
- A statement beginning with `match` is always a `matchStmt`; a `match` anywhere else is a `matchExpr`. In a `matchStmt`, an expression arm needs a trailing `,` unless it is the last arm. The scrutinee follows the struct-literal rule for headers.
- An enum needs at least one variant. `V()` with empty parentheses is a syntax error, in a declaration, a value or a pattern.
- Trailing commas are allowed in struct declarations, struct literals, array literals, enum variant lists and `match` arms (in both forms). They remain disallowed in parameter lists, call arguments, payload type lists, variant argument lists, binder lists, type parameter lists and type argument lists.

## Semantics and type rules

**Functions, structs and enums**
- Functions and structs are top-level and may be declared in any order. Functions may recurse directly or mutually, and structs and enums may refer to themselves and to each other.
- Function names must be unique and must not collide with builtin names. Struct and enum names share the type namespace. They must not be `int`, `bool`, `string`, `void` or `never`, and must not duplicate another struct, enum, function or builtin. `Option` and `Result` are builtin types and cannot be redefined (`'Option' is a builtin type and cannot be redefined`).
- Struct and enum names live in the type namespace. A local variable may share a struct's or enum's name.
- Field names must be unique within a struct. Any identifier is allowed, including `len` or `int`. An empty struct `struct Unit {}` is allowed.
- `main` must exist with the signature `fn main(): int` or `fn main(args: [string]): int` (any parameter name). `args` holds the command-line arguments without the program name, as a fresh array. The return value is the process exit code (truncated to the platform's exit-status range by the OS).
- Parameters are immutable bindings.
- A non-`void` function in which any control path can reach the end of the body without `return` is a compile error. A `while true` loop with no `break` counts as non-terminating, and the code after it is unreachable. Every other `while` condition is treated as possibly false, and every `for` loop as possibly running zero times. An expression statement whose type is `never` (a call to `panic`, `exit` or a user function that returns `never`) ends its path, and a `match` statement ends a path when all of its arms do.
- `return e;` in a `void` function and `return;` in a non-`void` function are errors. A `never` function cannot return at all (see below). `return e;` requires `e` to match the declared return type.
- Calls are checked for argument count and argument types.

**Imports and multi-file programs**
- `import "path";` is a top-level item and may appear anywhere among the items of a file. `import` is a keyword. The grammar is `importDecl = "import" STRING ";"`. A missing string or `;` is an ordinary syntax error, and an item that starts with any other token is `expected 'fn', 'struct', 'enum' or 'import', found <token>`.
- **Loading.** The *root file* is the file given to the compiler, and loading starts there. A relative path resolves against the directory of the file that contains the import, and an absolute path is used as is. Any file name is allowed, since `.aster` is a convention and not a rule. Files are identified by their real path, with symlinks resolved, and each is loaded once. A file that imports itself, two files that import each other and two imports of a shared file are all fine.
- **Load order** is the root first, then each import depth first, in the order the imports appear: a pre-order walk that skips files already loaded.
- **One flat namespace.** The items of every loaded file form one program, in load order, and the checker sees them as if they had been written in one file in that order. There are no qualified names and no visibility: every function, struct and enum is visible everywhere, whatever the import structure, and an import may follow the code that uses it. Name rules apply across files with their existing messages (`duplicate function 'f'`, `duplicate struct 'S'`, `'X' is already declared as a struct`, and so on). A collision is reported at the declaration that comes later in load order, except that a function colliding with a struct or enum name is always reported at the function, as it is in a single file.
- **`main`** belongs to the root file. A function named `main` in any other file is the error `'main' must be declared in the root file`, at its name, and that declaration is otherwise ignored. A missing `main` in the root is reported as for a single file, even when another file declared one.
- A file that can't be read is the error `cannot import '<path>': <reason>`, at the import's string literal. `<path>` is the literal's value as written. `<reason>` is `No such file or directory`, `Is a directory`, `Permission denied`, `Not a directory`, `Too many levels of symbolic links`, `File name too long`, or `invalid path` for a path containing `\0`, and otherwise the OS's message.
- Every loaded file is lexed and parsed. If any file has lexical or syntax errors, compilation stops after loading, with every file's syntax errors (and `cannot import` errors) reported, and nothing is checked.
- An import has no other meaning, and an unused import is not an error.
- **Diagnostics** belong to the file that contains them. The CLI prints the path of that file as the compiler reached it: the root path as given on the command line, and an imported path appended to its importer's directory as written, with `.` and `..` kept so they resolve physically through symlinks (`programs/lexer.aster:12:5: error: …`). Diagnostics are sorted by load order, then by position within a file.
- **CLI.** `check`, `build` and `run` load the whole program. `--emit=tokens` and `--emit=ast` show the root file only and don't follow imports (the root's imports appear in the AST as items). `--emit=ir` and `--emit=c` show the whole program.

**Generic enum declarations**
- Type parameter names must be distinct (`duplicate type parameter 'T'`). A parameter must not be named `int`, `bool`, `string` or `void`, or share a name with a struct, an enum (including `Option` and `Result`) or a builtin function: `type parameter 'T' conflicts with a type of the same name`, reported once per offending parameter.
- Inside its enum's variant list, a type parameter can be used wherever a type can: alone, as an array element or as a type argument. Outside its enum it is `unknown type 'T'`. A type parameter cannot take arguments (`'T' is not generic`).
- Every type parameter must appear in at least one payload type: `type parameter 'T' is never used`.
- **Infinite expansion.** A set of generic enums that would need infinitely many instantiations is rejected at the declaration, used or not: `generic enum 'E' expands infinitely`. Build a graph whose nodes are (enum, parameter) pairs. For each type argument `A` passed to parameter `Q` of enum `F` inside a payload of enum `E`, and each parameter `P` of `E` that occurs in `A`, add an edge `(E, P) → (F, Q)`. The edge is *expanding* when `A` is not exactly `P`. Each enum with a parameter on a cycle that contains an expanding edge is reported once, at its name. `enum List[T] { Cons(T, List[T]), Nil }` is fine, and `enum Bad[T] { B(Bad[[T]]) }` is rejected.
- Errors in a generic enum's declaration (unknown types, `void` payloads, arity mistakes) are reported once, at the declaration, whether or not the enum is used.

**Type arguments**
- The argument count must equal the parameter count: `'Option' expects 1 type argument, got 2` and `'Result' expects 2 type arguments, got 1`. A generic enum written with no arguments is the same error with `got 0`. Arguments on a non-generic type are `'Point' is not generic`, and also for `int` and the other primitives.
- A `void` argument is `type argument cannot be void`.

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
- `==` and `!=` are not defined on structs or arrays (`cannot compare '<T>' values`). `print` and `eprint` accept only `int`, `bool` and `string`.

**Enums**
- `E::V` / `E::V(e1, …)` builds a variant. The number of values must equal the variant's payload count (`variant 'E::V' expects N values, got M`). Values are evaluated left to right, and each takes its slot type as context (so `Opt::Some([])` works). Errors that don't involve generics are unchanged: `unknown enum 'E'`, `'E' is not an enum`, `unknown variant 'V' on 'E'`.
- `==` and `!=` work on payload-free enums. On other enums, including every instantiation, they are `cannot compare 'E' values`. `print` and `eprint` do not accept enums.
- **Inference.** `E::V(e1, …)` where `E` is generic infers `E`'s type arguments. Type arguments are never written in expressions or patterns, and there is no turbofish.
  1. *From context.* If the expression appears where a type is expected, and that type is an instantiation of `E`, its arguments are used. The contexts are the ones that type an empty `[]`: a `let`/`var` type, an assignment target, a function argument, a `return` value, a struct literal field, a variant payload value, `push`'s second argument, an array literal element, and an `if`-expression or `match`-expression arm in one of those positions. An expected type that is not an instantiation of `E` is ignored here and reported as an ordinary mismatch afterwards.
  2. *From payload values.* Otherwise the values are checked left to right. Each value takes its slot type as context if the parameters it mentions are already known. Then its type is matched against the slot type, which fixes any parameter still unknown. A later value whose slot mentions a parameter fixed earlier is checked against that type, so `Pair::P(1, true)` with `P(T, T)` is `type mismatch: expected int, found bool`. A `void` value never fixes a parameter.
  3. If a parameter is still unknown, the error is `cannot infer type arguments for 'E'`, at the variant expression, and the expression has the error type. It is not reported when a payload value or the expected type already has the error type.

  So `Option::Some(5)` works anywhere, `Option::None` and `Result::Ok(1)` need context, and `let x: Option[[int]] = Option::Some([]);` works because the context fixes `T` before the payload is checked. Inference is left to right only: `[Option::None, Option::Some(1)]` with no outer context is `cannot infer type arguments for 'Option'` on the first element.

**Match**
- `match e { … }` accepts an `int`, `bool`, `string` or enum scrutinee. Any other type is `cannot match on 'T' values`. The scrutinee is evaluated once, and the first arm with a matching pattern runs. Strings compare by bytes, as `==` does.
- A pattern is `_`, or one or more alternatives separated by `|` (an *or-pattern*). The arm runs if any alternative matches. An alternative is a literal or a variant pattern `E::V(b1, …)`. A variant pattern has one binder per payload slot. A binder is a new immutable name scoped to its arm, or `_` to ignore that slot. Binder names must be distinct (`duplicate binding 'x'`).
- Each alternative must fit the scrutinee, or the error is `pattern type 'T' does not match 'S'`, where `T` is the alternative's type and `S` the scrutinee's:

  | Scrutinee | Alternatives allowed |
  |-----------|----------------------|
  | `int` | int literals (`5`, `-5`) and character literals (`'a'`) |
  | `bool` | `true`, `false` |
  | `string` | string literals |
  | enum `E` | `E::V…` naming variants of `E` |

A variant pattern never carries type arguments: `Option::Some(x)` matches any `Option` instantiation, and its binders have the scrutinee instantiation's payload types. A pattern naming a different enum than the scrutinee writes its type as the bare enum name: `pattern type 'Result' does not match 'Option[int]'`.

- Alternatives in an or-pattern of two or more cannot bind names: `E::A(_) | E::B` is fine, `E::A(x) | E::B` is `or-pattern alternatives cannot bind names`. A pattern with a single alternative binds as usual.
- **Reachability.** An alternative whose value an earlier arm, or an earlier alternative of the same arm, already covers is `duplicate pattern alternative`. If every alternative of an arm is already covered, the whole arm is `unreachable match arm` instead. Any arm after `_` is `unreachable match arm`, as is `_` once every value is covered. Only `bool` and enum matches can be fully covered by values.
- **Exhaustiveness.** Matches must be exhaustive:
  - enum: every variant needs an arm unless there is a `_` arm (`non-exhaustive match: missing 'E::A', …`).
  - `bool`: both `true` and `false`, or a `_` arm (`non-exhaustive match: missing 'true'` or `missing 'false'`).
  - `int` and `string`: a `_` arm is required (`non-exhaustive match: add a '_' arm`).
- In a `match` expression, all arms must have the same type, which must not be `void` (`match arms have different types: A and B`, `match expression cannot have type void`).

**`let … else`**

```aster
let Option::Some(si) = find_struct(ctx.env, name.name) else {
    report(ctx.env, "unknown struct '" + name.name + "'", name.start, name.end);
    return Type::Error;
};
```

- The pattern is anything a `match` arm accepts except `_`: a variant pattern with binders, an int, char, string or bool literal, or an or-pattern. The same rules apply as in a match arm (unknown enums and variants, payload arity, `or-pattern alternatives cannot bind names`, `duplicate binding 'x'`, `cannot match on 'T' values`, `pattern type 'T' does not match 'S'`). Binder types come from the scrutinee's payload types, so no annotation is written. Binders are immutable.
- If the pattern matches, the binders are in scope for the rest of the enclosing block and the statement falls through. If it doesn't, the `else` block runs.
- Order: the scrutinee is checked, then the pattern, then the `else` block. The binders enter scope only after the `else` block, so the block cannot see them. They then behave like other `let`s: a binder that repeats a name already declared in the same scope is `'x' is already declared in this scope`, and one may shadow a name from an enclosing scope.
- The `else` block must diverge, in the sense the missing-return analysis uses: `return`, `break`, `continue`, an infinite `while`, an `if` or `match` whose branches all diverge, or a statement whose expression has type `never`. Otherwise the error is `'else' block of 'let' must diverge`, at the `else` keyword. The statement itself never diverges.
- In a loop the binders are assigned again each time the statement runs, and code after the statement sees the current iteration's values.

**`if let`**

```aster
if let Option::Some(local) = find_local(ctx, name.name) {
    return local.ty;
} else if let Option::Some(si) = find_struct(ctx.env, name.name) {
    …
}
```

- `if let P = e { … }` runs the block when `P` matches `e`, with the binders in scope in that block only. An optional `else` branch runs otherwise. The pattern rules are those of `let … else`.
- Order: the scrutinee, then the pattern, then the then-block, then the else branch.
- It diverges when it has an `else` branch and both branches diverge, as `if` does. `else` may chain into a plain `if` or another `if let`, and the reverse.
- It is a statement, not an expression. There is no `while let`, no `if let … && cond`, and no negated pattern.

**Irrefutable patterns.** A pattern in `let … else` or `if let` that covers every value of the scrutinee's type is the error `pattern always matches`, at the pattern's span. Examples are `Wrapper::W(x)` on a single-variant enum and `true | false` on a `bool`. Int and string scrutinees are never irrefutable. It is not reported when the scrutinee has the error type, or when the pattern itself produced any diagnostic, binder errors such as `duplicate binding 'x'` and `or-pattern alternatives cannot bind names` included.

<a id="the-never-type"></a>
**The `never` type**

- `never` is a built-in type name, as `void` is: declaring a struct or enum with that name is `'never' is a built-in type and cannot be redefined`. A type parameter named `never` is `type parameter 'never' conflicts with a type of the same name`.
- It is valid only as a function's declared return type. In any other position (a variable, parameter, field, payload, array element or type argument) the error is `'never' is only allowed as a return type`, at the type's span.
- `panic(msg)` and `exit(code)` return `never`.
- **Compatibility.** An expression of type `never` fits any expected type: a `let` initialiser, an assignment, an argument, a `return` value, a struct field, a payload, an array element, `push`'s value. `let x: int = panic("unreachable");` type-checks. Where the rules ask for a specific type without an expected type, `never` is rejected like any other wrong type: an operator operand (`==` and `!=` included, with the usual `operator '<op>' cannot be applied to …` message), a condition, `print`'s argument, `len`'s argument, a `match` scrutinee. `never` is equal only to `never`.
- `never` never fixes an inferred type. An array literal whose elements are all `never` and which has no expected type is `cannot infer type of empty array`, and `Option::Some(panic("x"))` without context is `cannot infer type arguments for 'Option'`.
- **Divergence.** An expression statement or a `let` initialiser whose type is `never` ends its control path.
- **User functions.** `fn die(msg: string): never { eprint(msg); exit(1); }` declares a function that never returns.
  - Its body must diverge on every path, or the error is `function 'die' returns 'never' but can reach its end`, at the function's name. This replaces the missing-return error.
  - Every `return` in it is `cannot return from a function that returns 'never'`, at the `return`. The returned value, if any, is still checked, against no expected type.
  - `main` cannot return `never`: the usual `'main' must have signature …` error applies.
- **Unification.** In an `if` or `match` expression, branches or arms of type `never` do not take part in the "same type" rule. The expression's type is the common type of the others, or `never` if all of them are `never`. The existing `… cannot have type void` rules apply to that type.

**Diverging match-expression arms**

```aster
let ty: Type = match find_struct(env, name) {
    Option::Some(i) => env.structs[i].ty,
    Option::None => {
        report(env, "unknown struct '" + name + "'", start, end);
        return Type::Error;
    },
};
```

- A block arm is checked as a block in the arm's scope, so the arm's binders are visible. It must diverge, or the error is `match arm block must diverge`, at the arm's pattern span. Its type is `never`.
- An expression arm may be a `never` expression: `Option::None => panic("internal")`.
- If-expression branches cannot be blocks (only `{ expr }`). They diverge through a `never` value: `let x: int = if c { 1 } else { die("x") };`.

**The `?` operator**

`e?` evaluates `e` once. It unwraps a success or returns the failure from the enclosing function:

| `e`'s type | The function must return | Value of `e?` | When `e` is the failure variant |
|------------|--------------------------|---------------|---------------------------------|
| `Option[T]` | `Option[U]` for any `U` | the `Some` payload, of type `T` | returns `Option::None` |
| `Result[T, E]` | `Result[U, E]` for any `U`, with the same `E` | the `Ok` payload, of type `T` | returns `Result::Err(x)`, where `x` is the `Err` payload |

Errors, reported at the `?` expression:
- `'?' applies to Option or Result, not 'X'` for any other operand type.
- `'?' needs the function to return an Option, but it returns 'X'` (or `a Result`) when the return type is the wrong kind. `void` and `int` count, so `?` cannot be used in `main`.
- `'?' error type 'E1' does not match the function's error type 'E2'` when both are `Result` with different error types. There is no conversion.

If `e` has the error type, no further error is reported and `e?` has the error type. `?` does not end a control path for the missing-return analysis.

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

Builtins are special-cased in the checker. There is no overloading in user code, and generics exist only for enums.

| Builtin | Signature | Behaviour |
|---------|-----------|-----------|
| `print` | `(x: int \| bool \| string): void` | Writes `x` and a newline to stdout. bools print as `true`/`false`. |
| `eprint` | `(x: int \| bool \| string): void` | Flushes stdout, then writes `x` and a newline to stderr. Typed exactly like `print`. |
| `exit` | `(code: int): never` | Flushes stdout and ends the process with exit code `code` (truncated to the platform's exit-status range by the OS). Does not return. |
| `len` | `(s: string): int` / `(a: [T]): int` | Byte length of a string, or element count of an array. |
| `push` | `(a: [T], x: T): void` | Appends `x` to `a`. |
| `pop` | `(a: [T]): T` | Removes and returns the last element. Panics if `a` is empty. |
| `byte_at` | `(s: string, i: int): int` | Byte value 0–255 at index `i`. Panics if `i < 0` or `i >= len(s)`. |
| `substring` | `(s: string, start: int, end: int): string` | Bytes `[start, end)`. Panics unless `0 <= start <= end <= len(s)`. |
| `int_to_string` | `(n: int): string` | Decimal representation. |
| `read_file` | `(path: string): Result[string, string]` | Reads the whole file as raw bytes. `Ok(contents)` on success; `Err("<path>: <reason>")` on failure, with the OS's reason (`No such file or directory`, `Is a directory`, …) or `invalid path` for a path containing `\0`. A relative path resolves against the working directory. |
| `write_file` | `(path: string, contents: string): Result[int, string]` | Creates or truncates the file and writes `contents` as raw bytes. `Ok(len(contents))` on success; `Err("<path>: <reason>")` on failure, with `invalid path` for a path containing `\0`. |
| `make_temp_dir` | `(prefix: string): Result[string, string]` | Creates a new directory named `<prefix>XXXXXX` under `$TMPDIR` (or `/tmp` if it is unset or empty) and returns `Ok(path)`. On failure `Err("<template>: <reason>")`, where the template is the full path pattern, or `invalid path` if `prefix` contains `\0`. |
| `remove_path` | `(path: string): Result[int, string]` | Removes a file or an empty directory. `Ok(0)` on success; `Err("<path>: <reason>")` on failure, with `invalid path` for a path containing `\0`. |
| `run_process` | `(argv: [string]): Result[int, string]` | Runs `argv[0]` (searched on `PATH`) with the remaining elements as arguments, sharing the caller's stdin, stdout and stderr; the caller's buffered output is flushed first. `Ok(status)` is the exit status, or `Ok(128 + signal)` if the child was killed by a signal. `Err("<argv[0]>: <reason>")` if it cannot be started, `Err("<argument>: invalid path")` for an argument containing `\0` (shown up to the NUL), and `Err("empty argv")` for an empty array. |
| `read_stdin` | `(): string` | Reads stdin to EOF. Later calls return `""`. |
| `panic` | `(msg: string): never` | Writes `panic: <msg>` to stderr and exits with code 101. |

## Runtime panics

A runtime panic writes `panic: <message>` plus a newline to stderr and exits with code 101. Panics are triggered by:
- Division or modulo by zero, including `/=` and `%=` (`division by zero`).
- An out-of-range `byte_at`, array read or array write (`index out of bounds: index <i>, length <n>`).
- An invalid `substring` range (`substring out of bounds: <start>..<end>, length <n>`).
- `pop` on an empty array (`pop from empty array`).
- Running out of memory (`out of memory`).
- A read error on stdin (`cannot read stdin: <reason>`).
- `panic(msg)`.

## Not in v0.7

Writing files, writing to stdout or stderr without a newline, line-at-a-time stdin, environment variables, nested patterns, range patterns (`'0'..='9'`), binding inside or-patterns, `while let`, `if let` as an expression, guards or chains in `let … else` and `if let`, negated patterns, a `let … else` whose `else` block sees the failure's payload, blocks as if-expression branches, multi-byte or Unicode character literals, matching on structs or arrays, match guards, generic structs and functions, explicit type arguments in expressions, error-type conversion in `?`, `?` on anything but `Option` and `Result`, methods (`unwrap_or` and the like), type aliases, null, equality on structs, arrays or enums with payloads (including `Option` and `Result`), printing structs, arrays or enums, qualified names (`lexer::Token`), visibility (`pub`), selective imports, search paths or packages, separate compilation, `defer`, freeing memory, and C-style `for` loops.
