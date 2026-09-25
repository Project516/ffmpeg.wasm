/*
 * Cooperative pthread_* shim for the st core, built on Emscripten fibers.
 *
 * The st core has no SharedArrayBuffer, so there is no real concurrency
 * available. FFmpeg n9's fftools scheduler (fftools/ffmpeg_sched.c) still
 * calls real pthread_create/mutex/cond APIs, so this file gives every
 * "thread" its own cooperatively-scheduled fiber: exactly one fiber's C code
 * runs at a time, and control only passes to another fiber at an explicit
 * blocking point (mutex contention, cond wait, join, sleep).
 *
 * Every symbol here is reached via linker wrapping (`-Wl,--wrap=pthread_create`
 * etc., see build/ffmpeg-wasm.sh), not by FFmpeg including pthread_fiber.h.
 * That keeps this shim from colliding with emscripten's own non-pthread
 * libc stub (system/lib/pthread/library_pthread_stub.c), which defines
 * several of these names as plain strong symbols; wrapping redirects only
 * the symbols we actually replace and leaves the rest of that stub object
 * (pthread_rwlock_*, sem_*, barriers) untouched.
 */

#include <emscripten/fiber.h>
#include <emscripten/emscripten.h>

#include <pthread.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* Temporary: FFmpeg's own av_log output goes through bind.js's Module.logger,
 * which is a no-op unless a caller sets one, so it is invisible to CI's
 * diagnostic capture. EM_JS prints straight to console.error, bypassing
 * that, to find the st core's transcode hang. Remove once root-caused. */
#ifdef PFIBER_DEBUG
EM_JS(void, pf_debug_js, (const char *s), { console.error(UTF8ToString(s)); });
static void pf_debug(const char *fmt, ...)
{
    /* Cap output: a genuine tight-loop deadlock would otherwise print
     * unbounded lines and drown the CI log before anything can read it. */
    static int budget = 200;
    char buf[256];
    va_list ap;
    if (budget <= 0)
        return;
    if (--budget == 0) {
        pf_debug_js("pf_debug: budget exhausted, silencing further output");
        return;
    }
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    pf_debug_js(buf);
}
/* Heartbeat: tells a genuine spin (never yields to the browser at all, so
 * even a JS setInterval callback on this same thread never gets a turn)
 * apart from a fiber that is merely running real, slow work but still
 * occasionally hits a wrapped call. If this stops printing entirely during
 * a hang, nothing is yielding to JS at all -- a true busy loop. */
EM_JS(void, pf_heartbeat_tick_js, (void), {
    globalThis.__pf_swaps = (globalThis.__pf_swaps || 0) + 1;
});
EM_JS(void, pf_heartbeat_start_js, (void), {
    if (globalThis.__pf_heartbeat_started) return;
    globalThis.__pf_heartbeat_started = true;
    globalThis.__pf_swaps = 0;
    var last = 0;
    setInterval(function () {
        var cur = globalThis.__pf_swaps;
        console.error("heartbeat: swaps=" + cur + " (+" + (cur - last) + ") at " + Date.now());
        last = cur;
    }, 2000);
});
#else
static void pf_debug(const char *fmt, ...) { (void)fmt; }
static void pf_heartbeat_tick_js(void) {}
static void pf_heartbeat_start_js(void) {}
#endif

#define PFIBER_MAX 48
/* 2MB per worker fiber's C stack; FFmpeg/libopus can need deep stacks. The
 * project's main stack is 5MB (see build/ffmpeg-wasm.sh); tune this up if a
 * CI run stack-overflows inside a worker fiber. */
#define PFIBER_STACK_SIZE (2 * 1024 * 1024)
#define PFIBER_ASYNCIFY_STACK_SIZE (64 * 1024)
#define PFIBER_MAIN_ASYNCIFY_STACK_SIZE (64 * 1024)

typedef struct pfiber {
    emscripten_fiber_t ctx;
    char *c_stack;
    char *asyncify_stack;
    size_t c_stack_size;
    size_t asyncify_stack_size;
    enum { PF_FREE, PF_RUNNABLE, PF_BLOCKED, PF_DONE } state;
    void *(*start_routine)(void *);
    void *arg;
    void *retval;
    int detached;
    struct pfiber *join_waiter;  /* fiber blocked in pthread_join on this one */
    void *wait_on;               /* mutex/cond pointer this fiber is blocked on */
    int has_deadline;            /* set while blocked in pthread_cond_timedwait */
    double deadline_ms;          /* pf_now_ms() value this fiber's wait expires at */
    int woke_by_timeout;         /* set by the scheduler when it expires a deadline */
} pfiber_t;

static pfiber_t g_table[PFIBER_MAX];
static pfiber_t g_main;
static pfiber_t *g_current = NULL;
static int g_initialized = 0;

/* Backing struct for a pthread_mutex_t. The opaque musl struct is treated as
 * a lazily-allocated pointer to one of these, stored in its first
 * sizeof(void*) bytes (a zero-initialized PTHREAD_MUTEX_INITIALIZER mutex
 * therefore reliably means "not yet allocated"). */
typedef struct {
    pfiber_t *owner;
} pf_mutex_t;

/* Same idea for pthread_cond_t; the struct itself carries no state beyond
 * existing, since which fibers are waiting lives in pfiber_t.wait_on. */
typedef struct {
    int allocated;
} pf_cond_t;

static pfiber_t *pfiber_at(int idx)
{
    return idx < 0 ? &g_main : &g_table[idx];
}

static int pfiber_index_of(pfiber_t *f)
{
    return (f == &g_main) ? -1 : (int)(f - g_table);
}

/* Wall-clock milliseconds, matching av_gettime()'s gettimeofday() basis:
 * fftools builds pthread_cond_timedwait's abstime from av_gettime(), so this
 * needs to be comparable to that, not CLOCK_MONOTONIC. */
static double pf_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

static void pfiber_ensure_main(void)
{
    if (g_initialized)
        return;
    g_initialized = 1;
    memset(&g_main, 0, sizeof(g_main));
    g_main.state = PF_RUNNABLE;
    g_main.asyncify_stack = malloc(PFIBER_MAIN_ASYNCIFY_STACK_SIZE);
    g_main.asyncify_stack_size = PFIBER_MAIN_ASYNCIFY_STACK_SIZE;
    emscripten_fiber_init_from_current_context(&g_main.ctx, g_main.asyncify_stack,
                                                g_main.asyncify_stack_size);
    g_current = &g_main;
    pf_heartbeat_start_js();
}

/* Wake every fiber blocked on the given mutex/cond pointer. Waking more than
 * the eventual winner (for a mutex) is harmless: the loser just re-blocks on
 * its next check. A cond_signal that wakes every waiter instead of exactly
 * one is a deliberate simplification: FFmpeg's callers already loop on their
 * own predicate, so an extra spurious wakeup is legal pthread_cond_wait
 * behavior, not a bug. */
static void pf_wake_waiters_on(void *ptr)
{
    for (int i = -1; i < PFIBER_MAX; i++) {
        pfiber_t *f = pfiber_at(i);
        if (f->state == PF_BLOCKED && f->wait_on == ptr) {
            f->wait_on = NULL;
            f->state = PF_RUNNABLE;
        }
    }
}

/*
 * The scheduler. Called from every blocking point. On each pass:
 *  1. Free the stacks of any finished, detached fiber (must happen here,
 *     never inside the exiting fiber itself, since a fiber must not free
 *     its own currently-in-use stack).
 *  2. Round-robin to the next PF_RUNNABLE fiber other than the current one.
 *  3. If one exists, swap to it.
 *  4. If none exists and the caller was only voluntarily yielding (still
 *     PF_RUNNABLE), just return.
 *  5. If none exists and the caller is genuinely blocked, yield to the
 *     browser event loop for ~1ms (emscripten_sleep, needs ASYNCIFY) so
 *     real-time waits (timedwait, usleep) can make progress, then retry.
 *     A true deadlock (nothing ever becomes runnable) spins here forever
 *     rather than crashing; that is a known limitation, not fixed here.
 */
static void pfiber_reschedule(void)
{
    for (;;) {
        for (int i = 0; i < PFIBER_MAX; i++) {
            pfiber_t *f = &g_table[i];
            if (f->state == PF_DONE && f->detached &&
                (f->c_stack || f->asyncify_stack)) {
                free(f->c_stack);
                free(f->asyncify_stack);
                f->c_stack = NULL;
                f->asyncify_stack = NULL;
                f->state = PF_FREE;
            }
        }

        /*
         * Expire any pthread_cond_timedwait whose deadline has passed. This
         * must happen here, in the scheduler itself, not just as a check in
         * cond_timedwait's own retry loop: that loop only gets control back
         * via this function returning, and the loop below only returns
         * control to a fiber by finding it PF_RUNNABLE. A fiber that put
         * itself to sleep as PF_BLOCKED with a deadline would otherwise
         * never be picked again once no *other* fiber is runnable either,
         * since nothing marks it runnable on its behalf -- that was the
         * st core's transcode hang: main's sch_wait() timedwait parked
         * forever once every worker fiber was also blocked, because nobody
         * ever declared the deadline itself as a reason to run again.
         */
        for (int i = -1; i < PFIBER_MAX; i++) {
            pfiber_t *f = pfiber_at(i);
            if (f->state == PF_BLOCKED && f->has_deadline && pf_now_ms() >= f->deadline_ms) {
                f->wait_on = NULL;
                f->has_deadline = 0;
                f->woke_by_timeout = 1;
                f->state = PF_RUNNABLE;
            }
        }

        int total = PFIBER_MAX + 1; /* +1 for g_main */
        int start_lin = pfiber_index_of(g_current) + 1;
        pfiber_t *next = NULL;
        int lin = start_lin;
        for (int step = 0; step < total; step++) {
            lin = (lin + 1) % total;
            if (lin == start_lin)
                break;
            pfiber_t *cand = pfiber_at(lin - 1);
            if (cand->state == PF_RUNNABLE) {
                next = cand;
                break;
            }
        }

        if (next) {
            pfiber_t *prev = g_current;
            pf_debug("reschedule: %d -> %d", pfiber_index_of(prev), pfiber_index_of(next));
            pf_heartbeat_tick_js();
            g_current = next;
            emscripten_fiber_swap(&prev->ctx, &next->ctx);
            return;
        }

        if (g_current->state == PF_RUNNABLE)
            return;

        pf_debug("reschedule: nothing runnable, current=%d blocked on %p, sleeping",
                 pfiber_index_of(g_current), g_current->wait_on);
        emscripten_sleep(1);
    }
}

/* Entry point for every worker fiber. Never returns: once a fiber's
 * start_routine finishes there is nothing left to return to, so it just
 * parks itself by looping on the scheduler forever. state == PF_DONE keeps
 * the scheduler from ever selecting it again. This looks like a bug at a
 * glance; it is not. */
static void pfiber_trampoline(void *arg)
{
    pfiber_t *f = (pfiber_t *)arg;

    f->retval = f->start_routine(f->arg);
    f->state = PF_DONE;
    if (f->join_waiter) {
        f->join_waiter->state = PF_RUNNABLE;
        f->join_waiter = NULL;
    }

    for (;;)
        pfiber_reschedule();
}

int __wrap_pthread_create(pthread_t *thread, const pthread_attr_t *attr,
                           void *(*start_routine)(void *), void *arg)
{
    (void)attr;
    pfiber_ensure_main();

    pfiber_t *f = NULL;
    for (int i = 0; i < PFIBER_MAX; i++) {
        if (g_table[i].state == PF_FREE) {
            f = &g_table[i];
            break;
        }
    }
    if (!f)
        return EAGAIN;

    char *c_stack = malloc(PFIBER_STACK_SIZE);
    char *asyncify_stack = malloc(PFIBER_ASYNCIFY_STACK_SIZE);
    if (!c_stack || !asyncify_stack) {
        free(c_stack);
        free(asyncify_stack);
        return EAGAIN;
    }

    memset(f, 0, sizeof(*f));
    f->c_stack = c_stack;
    f->asyncify_stack = asyncify_stack;
    f->c_stack_size = PFIBER_STACK_SIZE;
    f->asyncify_stack_size = PFIBER_ASYNCIFY_STACK_SIZE;
    f->start_routine = start_routine;
    f->arg = arg;

    emscripten_fiber_init(&f->ctx, pfiber_trampoline, f, c_stack, PFIBER_STACK_SIZE,
                           asyncify_stack, PFIBER_ASYNCIFY_STACK_SIZE);
    f->state = PF_RUNNABLE;

    /* Do not swap to it now; the caller (fftools sets up all its threads up
     * front, then immediately blocks) will hand it a turn on its own next
     * blocking point. */
    *thread = (pthread_t)(uintptr_t)f;
    pf_debug("pthread_create: idx=%d fn=%p", pfiber_index_of(f), (void *)start_routine);
    return 0;
}

int __wrap_pthread_join(pthread_t thread, void **retval)
{
    pfiber_ensure_main();
    pfiber_t *f = (pfiber_t *)(uintptr_t)thread;

    pf_debug("pthread_join: enter idx=%d state=%d", pfiber_index_of(f), f->state);
    f->join_waiter = g_current;
    g_current->state = PF_BLOCKED;
    while (f->state != PF_DONE)
        pfiber_reschedule();
    g_current->state = PF_RUNNABLE;
    pf_debug("pthread_join: done idx=%d", pfiber_index_of(f));

    if (retval)
        *retval = f->retval;

    /* Safe here: we are not running on f's stack, we are the joiner. */
    free(f->c_stack);
    free(f->asyncify_stack);
    f->c_stack = NULL;
    f->asyncify_stack = NULL;
    f->state = PF_FREE;
    return 0;
}

int __wrap_pthread_detach(pthread_t thread)
{
    pfiber_t *f = (pfiber_t *)(uintptr_t)thread;
    f->detached = 1;
    if (f->state == PF_DONE) {
        free(f->c_stack);
        free(f->asyncify_stack);
        f->c_stack = NULL;
        f->asyncify_stack = NULL;
        f->state = PF_FREE;
    }
    return 0;
}

pthread_t __wrap_pthread_self(void)
{
    pfiber_ensure_main();
    return (pthread_t)(uintptr_t)g_current;
}

int __wrap_pthread_equal(pthread_t a, pthread_t b)
{
    return a == b;
}

int __wrap_pthread_once(pthread_once_t *once_control, void (*init_routine)(void))
{
    /* Only one fiber's C code ever executes at a time, so there is no real
     * concurrency to guard against here. */
    if (*once_control == 0) {
        *once_control = 1;
        init_routine();
    }
    return 0;
}

static pf_mutex_t *pf_mutex_ensure(pthread_mutex_t *mutex)
{
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    if (!*slot)
        *slot = calloc(1, sizeof(pf_mutex_t));
    return *slot;
}

int __wrap_pthread_mutex_init(pthread_mutex_t *mutex, const pthread_mutexattr_t *attr)
{
    /* attr (e.g. PTHREAD_MUTEX_ERRORCHECK) is ignored: not needed for this
     * shim, and FFmpeg only relies on it when ASSERT_LEVEL is enabled, which
     * it is not by default here. */
    (void)attr;
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    free(*slot);
    *slot = calloc(1, sizeof(pf_mutex_t));
    return 0;
}

int __wrap_pthread_mutex_destroy(pthread_mutex_t *mutex)
{
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    free(*slot);
    *slot = NULL;
    return 0;
}

int __wrap_pthread_mutex_lock(pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    if (m->owner != NULL)
        pf_debug("mutex_lock: %p contended, owner=%d, waiter=%d",
                 (void *)mutex, pfiber_index_of(m->owner), pfiber_index_of(g_current));
    while (m->owner != NULL) {
        g_current->wait_on = (void *)mutex;
        g_current->state = PF_BLOCKED;
        pfiber_reschedule();
        g_current->wait_on = NULL;
        g_current->state = PF_RUNNABLE;
    }
    m->owner = g_current;
    return 0;
}

int __wrap_pthread_mutex_trylock(pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    /* Non-recursive: FFmpeg does not rely on relocking here. A re-lock by
     * the current owner behaves like any other contended lock (EBUSY). */
    if (m->owner != NULL)
        return EBUSY;
    m->owner = g_current;
    return 0;
}

int __wrap_pthread_mutex_unlock(pthread_mutex_t *mutex)
{
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    m->owner = NULL;
    pf_wake_waiters_on((void *)mutex);
    return 0;
}

static pf_cond_t *pf_cond_ensure(pthread_cond_t *cond)
{
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    if (!*slot)
        *slot = calloc(1, sizeof(pf_cond_t));
    return *slot;
}

int __wrap_pthread_cond_init(pthread_cond_t *cond, const pthread_condattr_t *attr)
{
    (void)attr;
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    free(*slot);
    *slot = calloc(1, sizeof(pf_cond_t));
    return 0;
}

int __wrap_pthread_cond_destroy(pthread_cond_t *cond)
{
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    free(*slot);
    *slot = NULL;
    return 0;
}

int __wrap_pthread_cond_wait(pthread_cond_t *cond, pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_cond_ensure(cond);
    void *cond_ptr = (void *)cond;

    pf_debug("cond_wait: enter cond=%p fiber=%d", cond_ptr, pfiber_index_of(g_current));
    __wrap_pthread_mutex_unlock(mutex);
    g_current->wait_on = cond_ptr;
    g_current->state = PF_BLOCKED;
    while (g_current->wait_on == cond_ptr)
        pfiber_reschedule();

    __wrap_pthread_mutex_lock(mutex);
    pf_debug("cond_wait: woke cond=%p fiber=%d", cond_ptr, pfiber_index_of(g_current));
    return 0;
}

int __wrap_pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
                                   const struct timespec *abstime)
{
    pfiber_ensure_main();
    pf_cond_ensure(cond);
    void *cond_ptr = (void *)cond;
    double now0 = pf_now_ms();
    double deadline = (double)abstime->tv_sec * 1000.0 + (double)abstime->tv_nsec / 1e6;
    int loops = 0;

    pf_debug("cond_timedwait: enter cond=%p fiber=%d now=%.0f deadline=%.0f (delta=%.0f)",
             cond_ptr, pfiber_index_of(g_current), now0, deadline, deadline - now0);
    __wrap_pthread_mutex_unlock(mutex);
    g_current->wait_on = cond_ptr;
    g_current->has_deadline = 1;
    g_current->deadline_ms = deadline;
    g_current->woke_by_timeout = 0;
    g_current->state = PF_BLOCKED;
    /* The scheduler (pfiber_reschedule's deadline sweep) is what actually
     * flips wait_on/state once `deadline` passes, even if no other fiber
     * ever becomes runnable in the meantime -- see the comment there. */
    while (g_current->wait_on == cond_ptr) {
        loops++;
        pfiber_reschedule();
    }
    g_current->has_deadline = 0;

    __wrap_pthread_mutex_lock(mutex);
    pf_debug("cond_timedwait: exit cond=%p fiber=%d timed_out=%d loops=%d",
             cond_ptr, pfiber_index_of(g_current), g_current->woke_by_timeout, loops);
    return g_current->woke_by_timeout ? ETIMEDOUT : 0;
}

int __wrap_pthread_cond_signal(pthread_cond_t *cond)
{
    pf_debug("cond_signal: cond=%p from fiber=%d", (void *)cond, pfiber_index_of(g_current));
    pf_wake_waiters_on((void *)cond);
    return 0;
}

int __wrap_pthread_cond_broadcast(pthread_cond_t *cond)
{
    pf_debug("cond_broadcast: cond=%p from fiber=%d", (void *)cond, pfiber_index_of(g_current));
    pf_wake_waiters_on((void *)cond);
    return 0;
}

int __wrap_usleep(unsigned usec)
{
    pfiber_ensure_main();
    double deadline = emscripten_get_now() + (double)usec / 1000.0;
    while (emscripten_get_now() < deadline) {
        pfiber_reschedule();
        if (emscripten_get_now() < deadline)
            emscripten_sleep(1);
    }
    return 0;
}

int __wrap_nanosleep(const struct timespec *req, struct timespec *rem)
{
    pfiber_ensure_main();
    double deadline = emscripten_get_now() + (double)req->tv_sec * 1000.0 +
                       (double)req->tv_nsec / 1e6;
    while (emscripten_get_now() < deadline) {
        pfiber_reschedule();
        if (emscripten_get_now() < deadline)
            emscripten_sleep(1);
    }
    if (rem) {
        rem->tv_sec = 0;
        rem->tv_nsec = 0;
    }
    return 0;
}
