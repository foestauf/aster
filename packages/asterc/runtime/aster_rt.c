#include "aster_rt.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Noreturn void aster_rt_panic(aster_string msg) {
    fflush(stdout);
    fputs("panic: ", stderr);
    fwrite(msg.ptr, 1, (size_t)msg.len, stderr);
    fputc('\n', stderr);
    exit(101);
}

_Noreturn void aster_rt_panic_cstr(const char *msg) {
    aster_string s = { msg, (int64_t)strlen(msg) };
    aster_rt_panic(s);
}

_Noreturn void aster_rt_unreachable(void) {
    aster_rt_panic_cstr("internal error: reached unreachable code");
}

/* Strings are never freed in v0; memory is reclaimed at exit. */
static char *alloc_bytes(int64_t n) {
    char *p = malloc(n > 0 ? (size_t)n : 1);
    if (p == NULL) aster_rt_panic_cstr("out of memory");
    return p;
}

void aster_rt_print_int(int64_t n) { printf("%" PRId64 "\n", n); }

void aster_rt_print_bool(bool b) { puts(b ? "true" : "false"); }

void aster_rt_print_string(aster_string s) {
    fwrite(s.ptr, 1, (size_t)s.len, stdout);
    fputc('\n', stdout);
}

int64_t aster_rt_len(aster_string s) { return s.len; }

int64_t aster_rt_byte_at(aster_string s, int64_t i) {
    if (i < 0 || i >= s.len) {
        char buf[160];
        snprintf(buf, sizeof buf, "index out of bounds: index %" PRId64 ", length %" PRId64, i, s.len);
        aster_rt_panic_cstr(buf);
    }
    return (unsigned char)s.ptr[i];
}

aster_string aster_rt_substring(aster_string s, int64_t start, int64_t end) {
    if (start < 0 || start > end || end > s.len) {
        char buf[160];
        snprintf(buf, sizeof buf, "substring out of bounds: %" PRId64 "..%" PRId64 ", length %" PRId64, start, end, s.len);
        aster_rt_panic_cstr(buf);
    }
    /* Strings are immutable, so a substring can share the original bytes. */
    aster_string r = { s.ptr + start, end - start };
    return r;
}

aster_string aster_rt_int_to_string(int64_t n) {
    char buf[32];
    int len = snprintf(buf, sizeof buf, "%" PRId64, n);
    char *p = alloc_bytes(len);
    memcpy(p, buf, (size_t)len);
    aster_string r = { p, len };
    return r;
}

aster_string aster_rt_concat(aster_string a, aster_string b) {
    int64_t len = a.len + b.len;
    char *p = alloc_bytes(len);
    if (a.len > 0) memcpy(p, a.ptr, (size_t)a.len);
    if (b.len > 0) memcpy(p + a.len, b.ptr, (size_t)b.len);
    aster_string r = { p, len };
    return r;
}

bool aster_rt_str_eq(aster_string a, aster_string b) {
    return a.len == b.len && (a.len == 0 || memcmp(a.ptr, b.ptr, (size_t)a.len) == 0);
}
