#ifndef ASTER_RT_H
#define ASTER_RT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* An immutable byte string. Not NUL-terminated. */
typedef struct {
    const char *ptr;
    int64_t len;
} aster_string;

/* A growable array of fixed-size elements. Arrays are shared by reference and never freed in v0.1. */
typedef struct aster_array_data {
    int64_t len;
    int64_t cap;
    int64_t elem_size;
    char *data;
} *aster_array;

_Noreturn void aster_rt_panic(aster_string msg);
_Noreturn void aster_rt_panic_cstr(const char *msg);
_Noreturn void aster_rt_unreachable(void);

/* Zeroed heap memory for structs and arrays. Never freed in v0.1; panics with "out of memory" on failure. */
void *aster_rt_alloc(int64_t size);

/* A new array of `len` zeroed elements. */
aster_array aster_rt_array_new(int64_t elem_size, int64_t len);
/* Pointer to element i; panics with "index out of bounds: ..." outside [0, len). */
void *aster_rt_array_at(aster_array a, int64_t i);
/* Grows the array by one element and returns a pointer to the new slot. */
void *aster_rt_array_push_slot(aster_array a);
/* Shrinks the array by one element and returns a pointer to the removed slot, which stays readable until the next push. */
void *aster_rt_array_pop_slot(aster_array a);

/*
 * An insertion-ordered hash table. Keys are int64 (ASTER_KEY_INT, passed in ikey) or strings
 * (ASTER_KEY_STRING, passed in skey, compared by content); the unused key argument is ignored.
 * Values are value_size bytes (0 for sets). Never freed.
 */
#define ASTER_KEY_INT 0
#define ASTER_KEY_STRING 1
typedef struct aster_map_obj *aster_map;
aster_map aster_rt_map_new(int64_t key_kind, int64_t value_size);
/* Pointer to the key's value bytes, or NULL if absent and !create. A created slot is zeroed and appended to the key order. */
void *aster_rt_map_slot(aster_map m, int64_t ikey, aster_string skey, int64_t create);
/* Adds the key if absent; returns 1 if it was added, 0 if already present. */
int64_t aster_rt_map_insert(aster_map m, int64_t ikey, aster_string skey);
/* Removes the key; returns 1 if it was present, 0 otherwise. */
int64_t aster_rt_map_remove(aster_map m, int64_t ikey, aster_string skey);
int64_t aster_rt_map_len(aster_map m);
/* A fresh array of the live keys in insertion order (int64 or aster_string elements). */
aster_array aster_rt_map_keys(aster_map m);

/*
 * Integer arithmetic wraps: compute in uint64_t (where overflow is defined) and
 * convert back. The conversion is implementation-defined in C11; gcc and clang
 * define it as two's-complement wraparound.
 */
static inline int64_t aster_rt_add(int64_t a, int64_t b) { return (int64_t)((uint64_t)a + (uint64_t)b); }
static inline int64_t aster_rt_sub(int64_t a, int64_t b) { return (int64_t)((uint64_t)a - (uint64_t)b); }
static inline int64_t aster_rt_mul(int64_t a, int64_t b) { return (int64_t)((uint64_t)a * (uint64_t)b); }
static inline int64_t aster_rt_neg(int64_t a) { return (int64_t)((uint64_t)0 - (uint64_t)a); }

/*
 * Comparisons go through functions rather than raw operators so that comparing a
 * value with itself (`x == x`) can't trip gcc's -Wtautological-compare.
 */
static inline bool aster_rt_lt(int64_t a, int64_t b) { return a < b; }
static inline bool aster_rt_le(int64_t a, int64_t b) { return a <= b; }
static inline bool aster_rt_gt(int64_t a, int64_t b) { return a > b; }
static inline bool aster_rt_ge(int64_t a, int64_t b) { return a >= b; }
static inline bool aster_rt_eq(int64_t a, int64_t b) { return a == b; }
static inline bool aster_rt_ne(int64_t a, int64_t b) { return a != b; }

static inline int64_t aster_rt_div(int64_t a, int64_t b) {
    if (b == 0) aster_rt_panic_cstr("division by zero");
    if (b == -1) return aster_rt_neg(a); /* INT64_MIN / -1 would trap */
    return a / b;
}

static inline int64_t aster_rt_mod(int64_t a, int64_t b) {
    if (b == 0) aster_rt_panic_cstr("division by zero");
    if (b == -1) return 0; /* INT64_MIN % -1 would trap */
    return a % b;
}

void aster_rt_print_int(int64_t n);
void aster_rt_print_bool(bool b);
void aster_rt_print_string(aster_string s);
void aster_rt_eprint_int(int64_t n);
void aster_rt_eprint_bool(bool b);
void aster_rt_eprint_string(aster_string s);
_Noreturn void aster_rt_exit(int64_t code);

int64_t aster_rt_len(aster_string s);
int64_t aster_rt_byte_at(aster_string s, int64_t i);
aster_string aster_rt_substring(aster_string s, int64_t start, int64_t end);
aster_string aster_rt_int_to_string(int64_t n);
aster_string aster_rt_concat(aster_string a, aster_string b);
bool aster_rt_str_eq(aster_string a, aster_string b);

/* The program's arguments argv[1..argc) as a [string]. The strings point into argv. */
aster_array aster_rt_args(int argc, char **argv);

/* Reads stdin to EOF. Panics with "cannot read stdin: <reason>" on a read error. */
aster_string aster_rt_read_stdin(void);

/*
 * Reads the whole file at `path`. On success sets *ok and returns the contents; on failure clears *ok and returns
 * "<path>: <reason>". A path containing a NUL byte fails with the reason "invalid path".
 */
aster_string aster_rt_read_file(aster_string path, bool *ok);

/*
 * The POSIX builtins. Each returns whether it succeeded: on success *value is set, on failure *err is set to
 * "<subject>: <reason>". A path or argument containing a NUL byte fails with the reason "invalid path".
 */

/* Creates or truncates `path` and writes `contents`; *value is the byte count. */
bool aster_rt_write_file(aster_string path, aster_string contents, int64_t *value, aster_string *err);

/* Makes a directory "$TMPDIR/<prefix>XXXXXX" (/tmp when TMPDIR is unset or empty); *value is its path. */
bool aster_rt_make_temp_dir(aster_string prefix, aster_string *value, aster_string *err);

/* Removes a file or an empty directory; *value is 0. */
bool aster_rt_remove_path(aster_string path, int64_t *value, aster_string *err);

/* Runs argv[0] with PATH lookup and waits; *value is the exit status, or 128 + the signal. Empty argv fails. */
bool aster_rt_run_process(aster_array argv, int64_t *value, aster_string *err);

#endif
