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
