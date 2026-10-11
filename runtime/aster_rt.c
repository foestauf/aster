#define _POSIX_C_SOURCE 200809L
#include "aster_rt.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <spawn.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

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

typedef struct {
    uint64_t hash;
    int64_t live;
    int64_t ikey;
    aster_string skey;
} aster_map_entry; /* followed by value_size bytes, rounded up to 8 */

struct aster_map_obj {
    int64_t key_kind, value_size, stride;
    int64_t count; /* live entries */
    int64_t used;  /* entries appended since the last rebuild, live or dead */
    int64_t cap;   /* index slots (power of two); entries hold up to cap */
    char *entries;
    int32_t *index; /* -1 = empty, else an entry number */
};

#define MAP_ENTRY(m, i) ((aster_map_entry *)((m)->entries + (i) * (m)->stride))
#define MAP_VALUE(e) ((void *)((char *)(e) + sizeof(aster_map_entry)))

static uint64_t map_hash(const struct aster_map_obj *m, int64_t ikey, aster_string skey) {
    if (m->key_kind == ASTER_KEY_STRING) {
        uint64_t h = 1469598103934665603ULL;
        for (int64_t i = 0; i < skey.len; i++) {
            h ^= (unsigned char)skey.ptr[i];
            h *= 1099511628211ULL;
        }
        return h;
    }
    uint64_t x = (uint64_t)ikey + 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}

static int map_key_eq(const struct aster_map_obj *m, const aster_map_entry *e, int64_t ikey, aster_string skey) {
    if (m->key_kind == ASTER_KEY_STRING)
        return e->skey.len == skey.len && (skey.len == 0 || memcmp(e->skey.ptr, skey.ptr, (size_t)skey.len) == 0);
    return e->ikey == ikey;
}

/* The entry number for the key, or -1; *slot gets the index slot where it is or would go. */
static int64_t map_find(const struct aster_map_obj *m, uint64_t h, int64_t ikey, aster_string skey, uint64_t *slot) {
    uint64_t mask = (uint64_t)m->cap - 1;
    for (uint64_t s = h & mask;; s = (s + 1) & mask) {
        int32_t n = m->index[s];
        if (n < 0) {
            *slot = s;
            return -1;
        }
        aster_map_entry *e = MAP_ENTRY(m, n);
        if (e->live && e->hash == h && map_key_eq(m, e, ikey, skey)) {
            *slot = s;
            return n;
        }
    }
}

/* Copies the live entries, in order, into a table of new_cap slots and rebuilds the index. */
static void map_rebuild(struct aster_map_obj *m, int64_t new_cap) {
    char *entries = aster_rt_alloc(new_cap * m->stride);
    int64_t w = 0;
    for (int64_t r = 0; r < m->used; r++) {
        aster_map_entry *e = MAP_ENTRY(m, r);
        if (e->live) {
            memcpy(entries + w * m->stride, e, (size_t)m->stride);
            w++;
        }
    }
    /* Nothing holds a slot pointer across map calls, so the old tables can go now.
     * map_new's calloc leaves them NULL before the first rebuild. */
    free(m->entries);
    free(m->index);
    m->entries = entries;
    m->used = w;
    m->cap = new_cap;
    m->index = aster_rt_alloc(new_cap * (int64_t)sizeof(int32_t));
    memset(m->index, 0xff, (size_t)new_cap * sizeof(int32_t));
    uint64_t mask = (uint64_t)new_cap - 1;
    for (int64_t i = 0; i < w; i++) {
        uint64_t s = MAP_ENTRY(m, i)->hash & mask;
        while (m->index[s] >= 0) s = (s + 1) & mask;
        m->index[s] = (int32_t)i;
    }
}

aster_map aster_rt_map_new(int64_t key_kind, int64_t value_size) {
    struct aster_map_obj *m = aster_rt_alloc((int64_t)sizeof(struct aster_map_obj));
    m->key_kind = key_kind;
    m->value_size = value_size;
    m->stride = (int64_t)sizeof(aster_map_entry) + ((value_size + 7) & ~(int64_t)7);
    m->used = 0;
    map_rebuild(m, 8);
    return m;
}

void *aster_rt_map_slot(aster_map m, int64_t ikey, aster_string skey, int64_t create) {
    uint64_t h = map_hash(m, ikey, skey), s;
    int64_t n = map_find(m, h, ikey, skey, &s);
    if (n >= 0) return MAP_VALUE(MAP_ENTRY(m, n));
    if (!create) return NULL;
    if ((m->used + 1) * 3 > m->cap * 2) {
        /* Grow only if the live entries need it; otherwise the rebuild just drops tombstones. */
        map_rebuild(m, (m->count + 1) * 3 > m->cap ? m->cap * 2 : m->cap);
        map_find(m, h, ikey, skey, &s);
    }
    aster_map_entry *e = MAP_ENTRY(m, m->used);
    e->hash = h;
    e->live = 1;
    e->ikey = ikey;
    e->skey = skey;
    memset(MAP_VALUE(e), 0, (size_t)(m->stride - (int64_t)sizeof(aster_map_entry)));
    m->index[s] = (int32_t)m->used;
    m->used++;
    m->count++;
    return MAP_VALUE(e);
}

int64_t aster_rt_map_insert(aster_map m, int64_t ikey, aster_string skey) {
    int64_t before = m->count;
    aster_rt_map_slot(m, ikey, skey, 1);
    return m->count != before;
}

int64_t aster_rt_map_remove(aster_map m, int64_t ikey, aster_string skey) {
    uint64_t s;
    int64_t n = map_find(m, map_hash(m, ikey, skey), ikey, skey, &s);
    if (n < 0) return 0;
    MAP_ENTRY(m, n)->live = 0;
    m->count--;
    return 1;
}

int64_t aster_rt_map_len(aster_map m) { return m->count; }

aster_array aster_rt_map_keys(aster_map m) {
    int64_t size = m->key_kind == ASTER_KEY_STRING ? (int64_t)sizeof(aster_string) : (int64_t)sizeof(int64_t);
    aster_array a = aster_rt_array_new(size, m->count);
    int64_t w = 0;
    for (int64_t r = 0; r < m->used; r++) {
        aster_map_entry *e = MAP_ENTRY(m, r);
        if (!e->live) continue;
        if (m->key_kind == ASTER_KEY_STRING)
            *(aster_string *)aster_rt_array_at(a, w) = e->skey;
        else
            *(int64_t *)aster_rt_array_at(a, w) = e->ikey;
        w++;
    }
    return a;
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

/*
 * Concatenations come from a bump arena: [cat_start, cat_top) is used, [cat_top, cat_end) is free. Strings are
 * immutable views, so when `a` ends exactly at cat_top, `a + b` can write b's bytes after it and return a longer view
 * of the same memory: `a` itself still sees its old bytes. That makes `out += piece` loops linear instead of quadratic
 * (issue #71). A full arena is abandoned, never freed, like every other string.
 */
static char *cat_start;
static char *cat_top;
static char *cat_end;

aster_string aster_rt_concat(aster_string a, aster_string b) {
    if (b.len == 0) return a;
    if (a.len == 0) return b;
    int64_t len = a.len + b.len;
    if (a.ptr >= cat_start && a.ptr + a.len == cat_top && cat_end - cat_top >= b.len) {
        memcpy(cat_top, b.ptr, (size_t)b.len);
        cat_top += b.len;
        aster_string r = { a.ptr, len };
        return r;
    }
    if (cat_end - cat_top < len) {
        /* Twice the result, so a string that keeps growing past arenas still copies a linear number of bytes. */
        if (len > INT64_MAX / 2) aster_rt_panic_cstr("out of memory");
        int64_t cap = len * 2 > ((int64_t)1 << 20) ? len * 2 : ((int64_t)1 << 20);
        cat_start = alloc_bytes(cap);
        cat_top = cat_start;
        cat_end = cat_start + cap;
    }
    char *p = cat_top;
    memcpy(p, a.ptr, (size_t)a.len);
    memcpy(p + a.len, b.ptr, (size_t)b.len);
    cat_top += len;
    aster_string r = { p, len };
    return r;
}

/* SHA-256 (FIPS 180-4). */
static const uint32_t sha256_k[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

static uint32_t rotr32(uint32_t x, int n) {
    return (x >> n) | (x << (32 - n));
}

static void sha256_block(uint32_t h[8], const unsigned char *block) {
    uint32_t w[64];
    for (int t = 0; t < 16; t++) {
        w[t] = (uint32_t)block[t * 4] << 24 | (uint32_t)block[t * 4 + 1] << 16 | (uint32_t)block[t * 4 + 2] << 8
            | (uint32_t)block[t * 4 + 3];
    }
    for (int t = 16; t < 64; t++) {
        uint32_t s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >> 3);
        uint32_t s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int t = 0; t < 64; t++) {
        uint32_t t1 = hh + (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) + ((e & f) ^ (~e & g)) + sha256_k[t] + w[t];
        uint32_t t2 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
        hh = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
}

aster_string aster_rt_sha256_hex(aster_string s) {
    uint32_t h[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
    const unsigned char *bytes = (const unsigned char *)s.ptr;
    int64_t full = s.len / 64;
    for (int64_t i = 0; i < full; i++) sha256_block(h, bytes + i * 64);
    /* The tail, 0x80, zeros and the bit length fill one or two final blocks. */
    unsigned char tail[128] = { 0 };
    int64_t rest = s.len - full * 64;
    if (rest > 0) memcpy(tail, bytes + full * 64, (size_t)rest);
    tail[rest] = 0x80;
    int64_t tail_len = rest < 56 ? 64 : 128;
    uint64_t bits = (uint64_t)s.len * 8;
    for (int i = 0; i < 8; i++) tail[tail_len - 1 - i] = (unsigned char)(bits >> (i * 8));
    for (int64_t at = 0; at < tail_len; at += 64) sha256_block(h, tail + at);
    static const char digits[] = "0123456789abcdef";
    char *out = alloc_bytes(64);
    for (int i = 0; i < 64; i++) out[i] = digits[(h[i / 8] >> (28 - (i % 8) * 4)) & 15];
    aster_string r = { out, 64 };
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

/* Copies `s` into a NUL-terminated buffer, or reports "<s up to the NUL>: invalid path" and returns NULL. */
static char *cstr_or_error(aster_string s, aster_string *err) {
    const char *nul = s.len > 0 ? memchr(s.ptr, '\0', (size_t)s.len) : NULL;
    if (nul != NULL) {
        *err = path_error(s, (int64_t)(nul - s.ptr), "invalid path");
        return NULL;
    }
    char *c = alloc_bytes(s.len + 1);
    if (s.len > 0) memcpy(c, s.ptr, (size_t)s.len);
    c[s.len] = '\0';
    return c;
}

aster_string aster_rt_read_file(aster_string path, bool *ok) {
    aster_string bad;
    char *cpath = cstr_or_error(path, &bad);
    if (cpath == NULL) {
        *ok = false;
        return bad;
    }
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

bool aster_rt_write_file(aster_string path, aster_string contents, int64_t *value, aster_string *err) {
    char *cpath = cstr_or_error(path, err);
    if (cpath == NULL) return false;
    errno = 0;
    FILE *f = fopen(cpath, "wb");
    int e = errno;
    free(cpath);
    if (f == NULL) {
        *err = path_error(path, path.len, io_reason(e));
        return false;
    }
    size_t n = contents.len > 0 ? fwrite(contents.ptr, 1, (size_t)contents.len, f) : 0;
    e = errno;
    if (fclose(f) != 0 && (int64_t)n == contents.len) e = errno;
    else if ((int64_t)n == contents.len) e = 0;
    if (e != 0 || (int64_t)n != contents.len) {
        *err = path_error(path, path.len, io_reason(e));
        return false;
    }
    *value = contents.len;
    return true;
}

bool aster_rt_make_temp_dir(aster_string prefix, aster_string *value, aster_string *err) {
    const char *tmp = getenv("TMPDIR");
    if (tmp == NULL || tmp[0] == '\0') tmp = "/tmp";
    int64_t dir_len = (int64_t)strlen(tmp);
    int64_t len = dir_len + 1 + prefix.len + 6;
    char *buf = alloc_bytes(len + 1);
    memcpy(buf, tmp, (size_t)dir_len);
    buf[dir_len] = '/';
    if (prefix.len > 0) memcpy(buf + dir_len + 1, prefix.ptr, (size_t)prefix.len);
    memcpy(buf + dir_len + 1 + prefix.len, "XXXXXX", 6);
    buf[len] = '\0';
    aster_string tmpl = { buf, len };
    /* The NUL check covers the whole template; it can only fire inside the prefix. */
    if (memchr(buf, '\0', (size_t)len) != NULL) {
        *err = path_error(tmpl, (int64_t)strlen(buf), "invalid path");
        free(buf);
        return false;
    }
    errno = 0;
    char *made = mkdtemp(buf); /* fills the X's in place */
    int e = errno;
    if (made == NULL) {
        memcpy(buf + len - 6, "XXXXXX", 6); /* the failed call may have touched them */
        *err = path_error(tmpl, tmpl.len, io_reason(e));
        free(buf);
        return false;
    }
    value->ptr = buf; /* never freed, like every string */
    value->len = len;
    return true;
}

bool aster_rt_remove_path(aster_string path, int64_t *value, aster_string *err) {
    char *cpath = cstr_or_error(path, err);
    if (cpath == NULL) return false;
    errno = 0;
    int rc = remove(cpath);
    int e = errno;
    free(cpath);
    if (rc != 0) {
        *err = path_error(path, path.len, io_reason(e));
        return false;
    }
    *value = 0;
    return true;
}

bool aster_rt_run_process(aster_array argv, int64_t *value, aster_string *err) {
    if (argv->len == 0) {
        static const char msg[] = "empty argv";
        aster_string s = { msg, (int64_t)(sizeof msg - 1) };
        *err = s;
        return false;
    }
    char **cargv = (char **)alloc_bytes((argv->len + 1) * (int64_t)sizeof(char *));
    for (int64_t i = 0; i < argv->len; i++) {
        cargv[i] = cstr_or_error(*(aster_string *)aster_rt_array_at(argv, i), err);
        if (cargv[i] == NULL) {
            for (int64_t j = 0; j < i; j++) free(cargv[j]);
            free(cargv);
            return false;
        }
    }
    cargv[argv->len] = NULL;
    aster_string argv0 = *(aster_string *)aster_rt_array_at(argv, 0);
    fflush(NULL); /* the child's output must not overtake ours */
    pid_t pid;
    int rc = posix_spawnp(&pid, cargv[0], NULL, NULL, cargv, environ);
    bool ok = false;
    if (rc != 0) {
        *err = path_error(argv0, argv0.len, io_reason(rc));
    } else {
        int status = 0;
        pid_t w;
        do {
            w = waitpid(pid, &status, 0);
        } while (w == -1 && errno == EINTR);
        if (w == -1) {
            *err = path_error(argv0, argv0.len, io_reason(errno));
        } else {
            *value = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
            ok = true;
        }
    }
    for (int64_t i = 0; i < argv->len; i++) free(cargv[i]);
    free(cargv);
    return ok;
}
