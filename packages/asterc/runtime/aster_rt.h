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

int64_t aster_rt_len(aster_string s);
int64_t aster_rt_byte_at(aster_string s, int64_t i);
aster_string aster_rt_substring(aster_string s, int64_t start, int64_t end);
aster_string aster_rt_int_to_string(int64_t n);
aster_string aster_rt_concat(aster_string a, aster_string b);
bool aster_rt_str_eq(aster_string a, aster_string b);

/* The program's arguments argv[1..argc) as a [string]. The strings point into argv. */
aster_array aster_rt_args(int argc, char **argv);

#endif
