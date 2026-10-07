# Compiler inspection

## Diagnostic codes

Every diagnostic the compiler emits carries a stable code. The message column is the human message, with placeholders in angle brackets.

| Code | Message |
| --- | --- |
| `io.root-unreadable` | cannot read '<path>' |
| `source.invalid-utf8` | invalid UTF-8 at line <L>, byte <B> |
| `lex.invalid-escape` | invalid escape sequence '<text>' |
| `lex.unterminated-string` | unterminated string literal |
| `lex.unterminated-char` | unterminated character literal |
| `lex.empty-char` | empty character literal |
| `lex.invalid-char` | character literal must be a single ASCII character |
| `lex.unexpected-character` | unexpected character '<c>' |
| `syntax.expected` | expected <what>, found <token> |
| `syntax.chained-comparison` | comparison operators cannot be chained |
| `syntax.if-without-else` | if expression requires an else branch |
| `syntax.int-out-of-range` | integer literal out of range |
| `import.invalid-path` | cannot import '<literal>': invalid path |
| `import.unreadable` | cannot import '<literal>': <reason> |
| `import.invalid-utf8` | cannot import '<literal>': invalid UTF-8 at line <L>, byte <B> |
| `decl.builtin-type-redefined` | '<name>' is a built-in type and cannot be redefined |
| `decl.builtin-fn-redefined` | '<name>' is a builtin function and cannot be redefined |
| `decl.duplicate` | duplicate <struct|enum|function> '<name>' |
| `decl.kind-conflict` | '<name>' is already declared as <a struct|an enum> |
| `decl.duplicate-field` | duplicate field '<name>' |
| `decl.duplicate-variant` | duplicate variant '<v>' in '<enum>' |
| `decl.void-field` | field cannot have type void |
| `decl.void-payload` | payload cannot have type void |
| `decl.void-param` | parameter cannot have type void |
| `decl.void-variable` | variable cannot have type void |
| `generic.duplicate-param` | duplicate type parameter '<name>' |
| `generic.param-conflict` | type parameter '<name>' conflicts with a type of the same name |
| `generic.unused-param` | type parameter '<name>' is never used |
| `generic.infinite-expansion` | generic enum '<name>' expands infinitely |
| `generic.cannot-infer` | cannot infer type arguments for '<name>' |
| `typeref.unknown` | unknown type '<name>' |
| `typeref.not-generic` | '<name>' is not generic |
| `typeref.arity` | '<name>' expects <n> type <argument|arguments>, got <m> |
| `typeref.void-argument` | type argument cannot be void |
| `typeref.void-element` | array element type cannot be void |
| `typeref.never-position` | 'never' is only allowed as a return type |
| `typeref.map-key` | map key must be int or string, found <type> |
| `typeref.map-void-value` | map value cannot be void |
| `main.not-in-root` | 'main' must be declared in the root file |
| `main.bad-signature` | 'main' must have signature 'fn main(): int' or 'fn main(args: [string]): int' |
| `main.missing` | missing 'fn main(): int' |
| `flow.never-reaches-end` | function '<name>' returns 'never' but can reach its end |
| `flow.missing-return` | function '<name>' is missing a return on some paths |
| `flow.return-in-never` | cannot return from a function that returns 'never' |
| `flow.missing-return-value` | missing return value: expected <type> |
| `flow.void-return-value` | void function cannot return a value |
| `flow.outside-loop` | '<break|continue>' outside of loop |
| `flow.let-else-not-diverging` | 'else' block of 'let' must diverge |
| `flow.arm-not-diverging` | match arm block must diverge |
| `name.duplicate-local` | '<name>' is already declared in this scope |
| `name.undefined` | undefined name '<name>' |
| `name.function-as-value` | '<name>' is a function, not a value |
| `name.unknown-enum` | unknown enum '<name>' |
| `name.not-an-enum` | '<name>' is not an enum |
| `name.unknown-variant` | unknown variant '<v>' on '<enum>' |
| `name.unknown-struct` | unknown struct '<name>' |
| `name.unknown-field` | unknown field '<name>' on '<type>' |
| `type.mismatch` | type mismatch: expected <type>, found <type> |
| `type.condition` | condition must be bool, found <type> |
| `type.not-iterable` | cannot iterate over a value of type <type> |
| `type.range-bound` | range bound must be int, found <type> |
| `type.unary-operand` | operator '<op>' cannot be applied to <type> |
| `type.binary-operands` | operator '<op>' cannot be applied to <type> and <type> |
| `type.not-comparable` | cannot compare '<type>' values |
| `type.if-branches` | if branches have different types: <type> and <type> |
| `type.void-if` | if expression cannot have type void |
| `type.index` | array index must be int, found <type> |
| `type.not-indexable` | cannot index a value of type <type> |
| `type.missing-field` | missing field '<name>' in '<struct>' |
| `type.duplicate-field-init` | duplicate field '<name>' |
| `type.empty-array` | cannot infer type of empty array |
| `type.void-element` | array element cannot have type void |
| `type.empty-map` | cannot infer type of empty map or set |
| `type.empty-map-mismatch` | type mismatch: expected <type>, found empty map or set |
| `type.variant-arity` | variant '<enum>::<v>' expects <n> <value|values>, got <m> |
| `try.operand` | '?' applies to Option or Result, not '<type>' |
| `try.return-type` | '?' needs the function to return <kind>, but it returns '<type>' |
| `try.error-type` | '?' error type '<a>' does not match the function's error type '<b>' |
| `match.scrutinee` | cannot match on '<type>' values |
| `match.unreachable-arm` | unreachable match arm |
| `match.irrefutable` | pattern always matches |
| `match.non-exhaustive` | non-exhaustive match: add a '_' arm, or non-exhaustive match: missing <list> |
| `match.arm-types` | match arms have different types: <type> and <type> |
| `match.void` | match expression cannot have type void |
| `pattern.type` | pattern type '<a>' does not match '<b>' |
| `pattern.duplicate-alternative` | duplicate pattern alternative |
| `pattern.or-binding` | or-pattern alternatives cannot bind names |
| `pattern.duplicate-binding` | duplicate binding '<name>' |
| `assign.immutable` | cannot assign to immutable variable '<name>' |
| `assign.function` | cannot assign to function '<name>' |
| `assign.invalid-target` | invalid assignment target |
| `call.not-named` | only named functions can be called |
| `call.not-function` | '<name>' is not a function |
| `call.undefined` | undefined function '<name>' |
| `call.arity` | function '<name>' expects <n> <argument|arguments>, found <m> |
| `call.print-type` | cannot print a value of type <type> |
| `call.argument-type` | function '<name>' expects <what>, found <type> |
