#define _POSIX_C_SOURCE 200809L
#include "aster_rt.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

#define CHECK(cond) do { if (!(cond)) { printf("FAIL %d\n", __LINE__); exit(1); } } while (0)

static const aster_string NOSTR = { "", 0 };

/* Peak resident set size so far, in kilobytes (Linux reports ru_maxrss in KB). */
static long peak_rss_kb(void) {
    struct rusage ru;
    if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
    return ru.ru_maxrss;
}

static aster_string str(const char *s) {
    aster_string r = { s, (int64_t)strlen(s) };
    return r;
}

static void check_keys(aster_map m, const int64_t *want, int64_t n, int line) {
    aster_array k = aster_rt_map_keys(m);
    if (k->len != n) { printf("FAIL %d\n", line); exit(1); }
    for (int64_t i = 0; i < n; i++) {
        if (*(int64_t *)aster_rt_array_at(k, i) != want[i]) { printf("FAIL %d\n", line); exit(1); }
    }
}
#define CHECK_KEYS(m, ...) do { int64_t w_[] = { __VA_ARGS__ }; check_keys(m, w_, (int64_t)(sizeof w_ / sizeof w_[0]), __LINE__); } while (0)

int main(void) {
    /* int map: bulk insert and read back */
    aster_map m = aster_rt_map_new(ASTER_KEY_INT, 8);
    for (int64_t i = 0; i < 10000; i++) {
        int64_t *p = aster_rt_map_slot(m, i, NOSTR, 1);
        CHECK(p != NULL);
        CHECK(*p == 0); /* a new slot reads as zero bytes */
        *p = i * 2;
    }
    CHECK(aster_rt_map_len(m) == 10000);
    for (int64_t i = 0; i < 10000; i++) {
        int64_t *p = aster_rt_map_slot(m, i, NOSTR, 0);
        CHECK(p != NULL && *p == i * 2);
    }
    CHECK(aster_rt_map_slot(m, 10000, NOSTR, 0) == NULL);
    CHECK(aster_rt_map_slot(m, -1, NOSTR, 0) == NULL);

    /* overwrite keeps order; remove and re-add moves to the end */
    aster_map o = aster_rt_map_new(ASTER_KEY_INT, 8);
    *(int64_t *)aster_rt_map_slot(o, 3, NOSTR, 1) = 30;
    *(int64_t *)aster_rt_map_slot(o, 1, NOSTR, 1) = 10;
    *(int64_t *)aster_rt_map_slot(o, 2, NOSTR, 1) = 20;
    *(int64_t *)aster_rt_map_slot(o, 3, NOSTR, 1) = 33;
    CHECK(aster_rt_map_len(o) == 3);
    CHECK(*(int64_t *)aster_rt_map_slot(o, 3, NOSTR, 0) == 33);
    CHECK_KEYS(o, 3, 1, 2);
    CHECK(aster_rt_map_remove(o, 1, NOSTR) == 1);
    CHECK(aster_rt_map_remove(o, 1, NOSTR) == 0);
    CHECK(aster_rt_map_remove(o, 99, NOSTR) == 0);
    CHECK(aster_rt_map_slot(o, 1, NOSTR, 0) == NULL);
    CHECK(aster_rt_map_len(o) == 2);
    *(int64_t *)aster_rt_map_slot(o, 1, NOSTR, 1) = 11;
    CHECK_KEYS(o, 3, 2, 1);

    /* string map: lookup by content */
    aster_map s = aster_rt_map_new(ASTER_KEY_STRING, 8);
    char big[1000], big2[1000];
    memset(big, 'x', sizeof big);
    memset(big2, 'x', sizeof big2);
    aster_string kbig = { big, 1000 }, kbig2 = { big2, 1000 };
    aster_string keys[] = { str(""), str("a"), str("b"), kbig, str("abc"), str("abd") };
    for (int64_t i = 0; i < 6; i++) *(int64_t *)aster_rt_map_slot(s, 0, keys[i], 1) = i + 100;
    CHECK(aster_rt_map_len(s) == 6);
    char abuf[2] = { 'a', 0 }, ebuf[1] = { 0 }, cbuf[3] = { 'a', 'b', 'd' };
    aster_string ka = { abuf, 1 }, ke = { ebuf, 0 }, kd = { cbuf, 3 };
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, ke, 0) == 100);
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, ka, 0) == 101);
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, str("b"), 0) == 102);
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, kbig2, 0) == 103);
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, str("abc"), 0) == 104);
    CHECK(*(int64_t *)aster_rt_map_slot(s, 0, kd, 0) == 105);
    CHECK(aster_rt_map_slot(s, 0, str("abe"), 0) == NULL);
    CHECK(aster_rt_map_slot(s, 0, str("c"), 0) == NULL);
    aster_array sk = aster_rt_map_keys(s);
    CHECK(sk->len == 6);
    CHECK(((aster_string *)aster_rt_array_at(sk, 1))->len == 1);
    CHECK(((aster_string *)aster_rt_array_at(sk, 3))->len == 1000);
    CHECK(aster_rt_map_remove(s, 0, kbig2) == 1);
    CHECK(aster_rt_map_len(s) == 5);

    /* collisions and tombstones */
    aster_map t = aster_rt_map_new(ASTER_KEY_INT, 8);
    for (int64_t i = 0; i < 8; i++) *(int64_t *)aster_rt_map_slot(t, i, NOSTR, 1) = i;
    for (int64_t i = 0; i < 7; i++) CHECK(aster_rt_map_remove(t, i, NOSTR) == 1);
    CHECK(*(int64_t *)aster_rt_map_slot(t, 7, NOSTR, 0) == 7);
    for (int64_t i = 100; i < 10100; i++) *(int64_t *)aster_rt_map_slot(t, i, NOSTR, 1) = i;
    CHECK(aster_rt_map_len(t) == 10001);
    for (int64_t i = 100; i < 10100; i++) {
        if (i - 100 >= 4) CHECK(aster_rt_map_remove(t, i, NOSTR) == 1);
    }
    CHECK(aster_rt_map_len(t) == 5);
    CHECK_KEYS(t, 7, 100, 101, 102, 103);
    CHECK(*(int64_t *)aster_rt_map_slot(t, 102, NOSTR, 0) == 102);
    CHECK(aster_rt_map_slot(t, 5000, NOSTR, 0) == NULL);

    /* churn: repeated insert/remove must not grow without bound or lose keys */
    aster_map c = aster_rt_map_new(ASTER_KEY_INT, 8);
    for (int64_t i = 0; i < 50000; i++) {
        *(int64_t *)aster_rt_map_slot(c, i, NOSTR, 1) = i;
        if (i >= 2) CHECK(aster_rt_map_remove(c, i - 2, NOSTR) == 1);
    }
    CHECK(aster_rt_map_len(c) == 2);
    CHECK_KEYS(c, 49998, 49999);

    /* single-key churn: rebuilds that only drop tombstones must free the old tables */
    aster_map one = aster_rt_map_new(ASTER_KEY_INT, 0);
    long rss_before = peak_rss_kb();
    for (int64_t i = 0; i < 5000000; i++) {
        CHECK(aster_rt_map_insert(one, i, NOSTR) == 1);
        CHECK(aster_rt_map_remove(one, i, NOSTR) == 1);
    }
    CHECK(aster_rt_map_len(one) == 0);
    long rss_growth = peak_rss_kb() - rss_before;
    if (rss_growth > 16 * 1024) {
        printf("FAIL %d: peak RSS grew %ld KB during churn\n", __LINE__, rss_growth);
        exit(1);
    }

    /* sets: value_size 0 */
    aster_map set = aster_rt_map_new(ASTER_KEY_INT, 0);
    CHECK(aster_rt_map_insert(set, 5, NOSTR) == 1);
    CHECK(aster_rt_map_insert(set, 5, NOSTR) == 0);
    CHECK(aster_rt_map_insert(set, 6, NOSTR) == 1);
    CHECK(aster_rt_map_slot(set, 5, NOSTR, 0) != NULL);
    CHECK(aster_rt_map_slot(set, 7, NOSTR, 0) == NULL);
    CHECK(aster_rt_map_len(set) == 2);
    CHECK(aster_rt_map_remove(set, 5, NOSTR) == 1);
    CHECK(aster_rt_map_slot(set, 5, NOSTR, 0) == NULL);
    CHECK(aster_rt_map_insert(set, 5, NOSTR) == 1);
    CHECK_KEYS(set, 6, 5);
    aster_map sset = aster_rt_map_new(ASTER_KEY_STRING, 0);
    CHECK(aster_rt_map_insert(sset, 0, str("hi")) == 1);
    CHECK(aster_rt_map_insert(sset, 0, str("hi")) == 0);

    printf("ok\n");
    return 0;
}
