#include "aster_rt.h"

#include <errno.h>
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

/* The text for a failed I/O call's saved errno. A stream can report an error without setting errno. */
static const char *io_reason(int err) {
    return err != 0 ? strerror(err) : "I/O error";
}

/*
 * Reads `f` to EOF into a buffer that doubles as it fills, so it works whether or not the stream's size is known.
 * Sets *ok to false when the stream reports an error; errno then holds the reason.
 */
static aster_string read_all(FILE *f, bool *ok) {
    int64_t cap = 4096;
    int64_t len = 0;
    char *buf = alloc_bytes(cap);
    for (;;) {
        len += (int64_t)fread(buf + len, 1, (size_t)(cap - len), f);
        if (len < cap) break; /* a short read means EOF or an error */
        /* Doubling past SIZE_MAX would wrap; only reachable where size_t is narrower than 64 bits. */
        if ((uint64_t)cap > SIZE_MAX / 2) aster_rt_panic_cstr("out of memory");
        cap *= 2;
        buf = realloc(buf, (size_t)cap);
        if (buf == NULL) aster_rt_panic_cstr("out of memory");
    }
    *ok = !ferror(f);
    aster_string s = { buf, len };
    return s;
}

void *aster_rt_alloc(int64_t size) {
    void *p = calloc(1, size > 0 ? (size_t)size : 1);
    if (p == NULL) aster_rt_panic_cstr("out of memory");
    return p;
}

aster_array aster_rt_array_new(int64_t elem_size, int64_t len) {
    aster_array a = aster_rt_alloc((int64_t)sizeof *a);
    a->len = len;
    a->cap = len;
    a->elem_size = elem_size;
    a->data = len > 0 ? aster_rt_alloc(len * elem_size) : NULL;
    return a;
}

void *aster_rt_array_at(aster_array a, int64_t i) {
    if (i < 0 || i >= a->len) {
        char buf[160];
        snprintf(buf, sizeof buf, "index out of bounds: index %" PRId64 ", length %" PRId64, i, a->len);
        aster_rt_panic_cstr(buf);
    }
    return a->data + i * a->elem_size;
}

void *aster_rt_array_push_slot(aster_array a) {
    if (a->len == a->cap) {
        int64_t cap = a->cap > 0 ? a->cap * 2 : 4;
        char *data = realloc(a->data, (size_t)(cap * a->elem_size));
        if (data == NULL) aster_rt_panic_cstr("out of memory");
        a->data = data;
        a->cap = cap;
    }
    return a->data + a->len++ * a->elem_size;
}

void *aster_rt_array_pop_slot(aster_array a) {
    if (a->len == 0) aster_rt_panic_cstr("pop from empty array");
    a->len--;
    return a->data + a->len * a->elem_size;
}

void aster_rt_print_int(int64_t n) { printf("%" PRId64 "\n", n); }

void aster_rt_print_bool(bool b) { puts(b ? "true" : "false"); }

void aster_rt_print_string(aster_string s) {
    fwrite(s.ptr, 1, (size_t)s.len, stdout);
    fputc('\n', stdout);
}

void aster_rt_eprint_int(int64_t n) {
    fflush(stdout);
    fprintf(stderr, "%" PRId64 "\n", n);
}

void aster_rt_eprint_bool(bool b) {
    fflush(stdout);
    fputs(b ? "true\n" : "false\n", stderr);
}

void aster_rt_eprint_string(aster_string s) {
    fflush(stdout);
    fwrite(s.ptr, 1, (size_t)s.len, stderr);
    fputc('\n', stderr);
}

_Noreturn void aster_rt_exit(int64_t code) {
    fflush(stdout);
    exit((int)code);
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

aster_array aster_rt_args(int argc, char **argv) {
    int64_t n = argc > 1 ? (int64_t)argc - 1 : 0;
    aster_array a = aster_rt_array_new((int64_t)sizeof(aster_string), n);
    for (int64_t i = 0; i < n; i++) {
        const char *s = argv[i + 1];
        aster_string arg = { s, (int64_t)strlen(s) };
        *(aster_string *)aster_rt_array_at(a, i) = arg;
    }
    return a;
}

aster_string aster_rt_read_stdin(void) {
    bool ok = true;
    errno = 0;
    aster_string s = read_all(stdin, &ok);
    if (!ok) {
        char msg[256];
        snprintf(msg, sizeof msg, "cannot read stdin: %s", io_reason(errno));
        aster_rt_panic_cstr(msg);
    }
    return s;
}

/* "<path>: <reason>", with the path cut at `path_len` bytes. */
static aster_string path_error(aster_string path, int64_t path_len, const char *reason) {
    int64_t reason_len = (int64_t)strlen(reason);
    int64_t len = path_len + 2 + reason_len;
    char *buf = alloc_bytes(len);
    if (path_len > 0) memcpy(buf, path.ptr, (size_t)path_len);
    memcpy(buf + path_len, ": ", 2);
    memcpy(buf + path_len + 2, reason, (size_t)reason_len);
    aster_string s = { buf, len };
    return s;
}

aster_string aster_rt_read_file(aster_string path, bool *ok) {
    const char *nul = path.len > 0 ? memchr(path.ptr, '\0', (size_t)path.len) : NULL;
    if (nul != NULL) {
        *ok = false;
        return path_error(path, (int64_t)(nul - path.ptr), "invalid path");
    }
    char *cpath = alloc_bytes(path.len + 1);
    if (path.len > 0) memcpy(cpath, path.ptr, (size_t)path.len);
    cpath[path.len] = '\0';
    errno = 0;
    FILE *f = fopen(cpath, "rb");
    int open_err = errno; /* before free(), which C11 allows to change errno */
    free(cpath);
    if (f == NULL) {
        *ok = false;
        return path_error(path, path.len, io_reason(open_err));
    }
    errno = 0;
    aster_string contents = read_all(f, ok);
    int err = errno;
    fclose(f);
    if (!*ok) return path_error(path, path.len, io_reason(err));
    return contents;
}
